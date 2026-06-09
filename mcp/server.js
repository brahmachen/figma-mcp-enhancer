#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");
const readline = require("readline");

const PORT = Number(process.env.FIGMA_ENHANCER_PORT || 8787);
const REQUEST_TIMEOUT_MS = Number(process.env.FIGMA_ENHANCER_TIMEOUT_MS || 30000);
const STATE_FILE = process.env.FIGMA_ENHANCER_STATE_FILE || path.join(os.tmpdir(), "figma-mcp-enhancer-state.json");

let nextCommandId = 1;
const commandQueue = [];
const pollWaiters = [];
const resultWaiters = new Map();
let pluginLastSeenAt = 0;
let uiState = {
  frames: [],
  selectedNodeIds: [],
  queueIndex: -1,
  updatedAt: null
};

function normalizeUiState(state) {
  return {
    frames: Array.isArray(state && state.frames) ? state.frames : [],
    selectedNodeIds: Array.isArray(state && state.selectedNodeIds) ? state.selectedNodeIds : [],
    queueIndex: Number.isFinite(state && state.queueIndex) ? state.queueIndex : -1,
    updatedAt: state && typeof state.updatedAt === "string" ? state.updatedAt : null
  };
}

function loadUiState() {
  try {
    uiState = normalizeUiState(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
  } catch (_) {
    uiState = normalizeUiState(uiState);
  }
}

function saveUiState(nextState) {
  uiState = normalizeUiState({
    ...nextState,
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(STATE_FILE, JSON.stringify(uiState, null, 2));
  return uiState;
}

loadUiState();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function dispatchCommand(command) {
  const waiter = pollWaiters.shift();

  if (waiter) {
    clearTimeout(waiter.timeout);
    sendJson(waiter.res, 200, command);
    return;
  }

  commandQueue.push(command);
}

function requestPlugin(command, params) {
  const id = String(nextCommandId++);
  const payload = { id, command, params: params || {} };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resultWaiters.delete(id);
      reject(new Error("Timed out waiting for the Figma plugin. Make sure the plugin UI is open and connected."));
    }, REQUEST_TIMEOUT_MS);

    resultWaiters.set(id, { resolve, reject, timeout });
    dispatchCommand(payload);
  });
}

const bridgeServer = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      loadUiState();
      sendJson(res, 200, {
        ok: true,
        pluginConnected: Date.now() - pluginLastSeenAt < 10000,
        queuedCommands: commandQueue.length,
        stateFile: STATE_FILE,
        stateFrameCount: uiState.frames.length,
        stateSelectedCount: uiState.selectedNodeIds.length
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/ui/state") {
      loadUiState();
      sendJson(res, 200, {
        ok: true,
        state: uiState
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/ui/state") {
      const body = await readJsonBody(req);
      const incomingFrames = Array.isArray(body.frames) ? body.frames : [];
      const frames = incomingFrames.length === 0 && uiState.frames.length > 0 && body.allowEmptyFrames !== true
        ? uiState.frames
        : incomingFrames;
      const state = saveUiState({
        frames,
        selectedNodeIds: Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds : [],
        queueIndex: Number.isFinite(body.queueIndex) ? body.queueIndex : -1
      });
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "GET" && url.pathname === "/plugin/poll") {
      pluginLastSeenAt = Date.now();

      const command = commandQueue.shift();
      if (command) {
        sendJson(res, 200, command);
        return;
      }

      const timeout = setTimeout(() => {
        const index = pollWaiters.findIndex((waiter) => waiter.res === res);
        if (index >= 0) {
          pollWaiters.splice(index, 1);
        }
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
        });
        res.end();
      }, 25000);

      pollWaiters.push({ res, timeout });
      return;
    }

    if (req.method === "POST" && url.pathname === "/plugin/result") {
      pluginLastSeenAt = Date.now();
      const body = await readJsonBody(req);
      const waiter = resultWaiters.get(body.id);

      if (waiter) {
        clearTimeout(waiter.timeout);
        resultWaiters.delete(body.id);

        if (body.ok) {
          waiter.resolve(body.result);
        } else {
          waiter.reject(new Error(body.error || "Figma plugin command failed"));
        }
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

let bridgeStarted = false;

bridgeServer.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Figma MCP Enhancer bridge already running on http://localhost:${PORT}; reusing it for MCP calls.`);
    return;
  }

  console.error(`Figma MCP Enhancer bridge error: ${error && error.message ? error.message : String(error)}`);
});

bridgeServer.listen(PORT, () => {
  bridgeStarted = true;
  console.error(`Figma MCP Enhancer bridge listening on http://localhost:${PORT}`);
});

function toolDefinitions() {
  return [
    {
      name: "figma_find_all_frames",
      description: "List frame-like nodes from the Figma plugin. Use scope=currentPage for outermost frames on the current page, scope=selection for frames under the selected parent, or scope=queue for frames selected in the plugin UI queue.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["currentPage", "selection", "queue"],
            default: "currentPage",
            description: "Where to search for frames. Use queue to return frames currently selected in the plugin UI queue."
          },
          includeSections: {
            type: "boolean",
            default: true,
            description: "Whether SECTION nodes should be included with FRAME, COMPONENT, and INSTANCE nodes."
          },
          depth: {
            type: "string",
            enum: ["outermost", "direct", "recursive"],
            default: "outermost",
            description: "Use outermost to list only top-level frame-like nodes, direct for direct children of the search root, or recursive to include nested frames."
          }
        }
      }
    },
    {
      name: "figma_select_frame",
      description: "Select a Figma frame by nodeId, or select the next/previous frame from the last figma_find_all_frames result.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["next", "previous", "nodeId"],
            default: "next",
            description: "Selection mode."
          },
          nodeId: {
            type: "string",
            description: "Figma node id to select when mode=nodeId."
          },
          nodeIds: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Optional queue of node ids to use for next/previous selection."
          }
        }
      }
    }
  ];
}

async function callTool(name, args) {
  if (name === "figma_find_all_frames") {
    const result = await requestPlugin("findAllFrames", args || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  if (name === "figma_select_frame") {
    const result = await requestPlugin("selectFrame", args || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, error) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error && error.message ? error.message : String(error)
    }
  });
}

async function handleMessage(message) {
  if (!message || message.id == null) {
    return;
  }

  try {
    if (message.method === "initialize") {
      writeResult(message.id, {
        protocolVersion: message.params && message.params.protocolVersion ? message.params.protocolVersion : "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "figma-mcp-enhancer",
          version: "0.1.0"
        }
      });
      return;
    }

    if (message.method === "tools/list") {
      writeResult(message.id, { tools: toolDefinitions() });
      return;
    }

    if (message.method === "tools/call") {
      const params = message.params || {};
      const result = await callTool(params.name, params.arguments || {});
      writeResult(message.id, result);
      return;
    }

    writeError(message.id, new Error(`Unsupported method: ${message.method}`));
  } catch (error) {
    writeError(message.id, error);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  try {
    handleMessage(JSON.parse(line));
  } catch (error) {
    writeError(null, error);
  }
});

rl.on("close", () => {
  if (bridgeStarted) {
    bridgeServer.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  if (bridgeStarted) {
    bridgeServer.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on("SIGTERM", () => {
  if (bridgeStarted) {
    bridgeServer.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
