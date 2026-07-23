#!/usr/bin/env node

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.FIGMA_ENHANCER_PORT || 8787);
const TIMEOUT_MS = Number(process.env.FIGMA_ENHANCER_TIMEOUT_MS || 30000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function output(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function fail(message, exitCode = 1) {
  output({ ok: false, error: message }, exitCode);
}

function request(method, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? "" : JSON.stringify(payload);
    const req = http.request(`${BASE_URL}${pathname}`, {
      method,
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
      timeout: TIMEOUT_MS + 2000
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        let data = {};
        try { data = responseBody ? JSON.parse(responseBody) : {}; }
        catch (error) { reject(new Error(`Bridge returned invalid JSON: ${error.message}`)); return; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data.error || `Bridge returned HTTP ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("Bridge request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

function parseArgs(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) { values._.push(value); continue; }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next != null && !next.startsWith("--")) { values[key] = next; index += 1; }
    else values[key] = true;
  }
  return values;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function runTemporaryBridge(command, params) {
  return new Promise((resolve, reject) => {
    const id = `cli-${process.pid}-${Date.now()}`;
    let delivered = false;
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for the Figma plugin. Open the plugin and keep its window visible.")), TIMEOUT_MS);
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === "OPTIONS") { sendJson(res, 204, {}); return; }
        const url = new URL(req.url, BASE_URL);
        if (req.method === "GET" && url.pathname === "/health") {
          sendJson(res, 200, { ok: true, pluginConnected: delivered, mode: "cli" }); return;
        }
        if (req.method === "GET" && url.pathname === "/plugin/poll") {
          if (!delivered) { delivered = true; sendJson(res, 200, { id, command, params }); }
          else { res.writeHead(204, { "Access-Control-Allow-Origin": "*" }); res.end(); }
          return;
        }
        if (req.method === "POST" && url.pathname === "/plugin/result") {
          const body = await readBody(req);
          sendJson(res, 200, { ok: true });
          if (body.id === id) finish(body.ok ? null : new Error(body.error || "Plugin command failed"), body.result);
          return;
        }
        if (url.pathname === "/ui/state") {
          sendJson(res, req.method === "GET" ? 200 : 200, req.method === "GET" ? { ok: true, state: {} } : { ok: true });
          return;
        }
        sendJson(res, 404, { ok: false, error: "Not found" });
      } catch (error) { sendJson(res, 500, { ok: false, error: error.message }); }
    });

    function finish(error, result) {
      clearTimeout(timeout);
      server.close(() => error ? reject(error) : resolve(result));
    }

    server.once("error", async (error) => {
      if (error.code !== "EADDRINUSE") { clearTimeout(timeout); reject(error); return; }
      clearTimeout(timeout);
      try {
        const response = await request("POST", "/mcp/call", { command, params });
        resolve(response.result);
      } catch (bridgeError) { reject(new Error(`Port ${PORT} is occupied but no compatible bridge responded: ${bridgeError.message}`)); }
    });
    server.listen(PORT, "127.0.0.1");
  });
}

function usage() {
  return [
    "figma-enhancer health",
    "figma-enhancer frames [--scope queue|currentPage|selection] [--depth outermost|direct|recursive] [--no-sections] [--count-only]",
    "figma-enhancer select --node-id <id>",
    "figma-enhancer select --next|--previous [--node-ids <id,id,...>]"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help" || args.help) { output({ ok: true, usage: usage() }); return; }
  if (command === "health") {
    try { output(await request("GET", "/health")); }
    catch (_) { output({ ok: true, bridgeRunning: false, pluginConnected: false, message: "No bridge is running. Run a frames or select command while the Figma plugin is open." }); }
    return;
  }
  if (command === "frames") {
    const scope = args.scope || "queue";
    const depth = args.depth || "outermost";
    const result = await runTemporaryBridge("findAllFrames", { scope, depth, includeSections: !args["no-sections"] });
    if (args["count-only"]) {
      output({ ok: true, scope: result.scope, depth: result.depth, pageName: result.pageName, count: result.count });
    } else {
      output({ ok: true, ...result });
    }
    return;
  }
  if (command === "select") {
    const mode = args["node-id"] ? "nodeId" : args.previous ? "previous" : "next";
    const params = { mode };
    if (args["node-id"]) params.nodeId = args["node-id"];
    if (args["node-ids"]) params.nodeIds = String(args["node-ids"]).split(",").filter(Boolean);
    const result = await runTemporaryBridge("selectFrame", params);
    output({ ok: true, ...result }); return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main().catch((error) => fail(error.message || String(error)));
