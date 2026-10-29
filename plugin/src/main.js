figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

let selectedQueue = [];
let navigationQueue = [];
let queueIndex = -1;
let queueSignature = "";

function isFrameLike(node) {
  return ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type);
}

function hasChildren(node) {
  return "children" in node;
}

function hasBounds(node) {
  return "x" in node && "y" in node && "width" in node && "height" in node;
}

function getNodePath(node) {
  const names = [];
  let current = node;

  while (current && current.type !== "DOCUMENT") {
    if (current.name) {
      names.unshift(current.name);
    }
    current = current.parent;
  }

  return names.join(" / ");
}

function paintSummary(paints) {
  if (!Array.isArray(paints) || paints.length === 0) {
    return "none";
  }

  return paints
    .slice(0, 3)
    .map((paint) => {
      if (paint.type === "SOLID" && paint.color) {
        const r = Math.round(paint.color.r * 255);
        const g = Math.round(paint.color.g * 255);
        const b = Math.round(paint.color.b * 255);
        const a = paint.opacity == null ? 1 : paint.opacity;
        return `solid rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})`;
      }

      return paint.type.toLowerCase();
    })
    .join(", ");
}

function collectTextSnippets(root) {
  if (!hasChildren(root)) {
    return [];
  }

  return root
    .findAll((node) => node.type === "TEXT")
    .slice(0, 8)
    .map((node) => node.characters.trim())
    .filter(Boolean);
}

function summarizeFrame(node, index) {
  const childCount = hasChildren(node) ? node.children.length : 0;
  const bounds = hasBounds(node)
    ? {
        x: Math.round(node.x),
        y: Math.round(node.y),
        width: Math.round(node.width),
        height: Math.round(node.height)
      }
    : {};

  const layoutMode = "layoutMode" in node ? node.layoutMode : "NONE";
  const fills = "fills" in node ? paintSummary(node.fills) : "unknown";
  const strokes = "strokes" in node ? paintSummary(node.strokes) : "unknown";
  const textSnippets = collectTextSnippets(node);
  const parent = node.parent;

  return {
    index,
    id: node.id,
    name: node.name,
    type: node.type,
    fileKey: typeof figma.fileKey === "string" ? figma.fileKey : null,
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    parentId: parent && parent.type !== "DOCUMENT" ? parent.id : null,
    parentName: parent && parent.type !== "DOCUMENT" ? parent.name : null,
    path: getNodePath(node),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    childCount,
    layoutMode,
    fills,
    strokes,
    textSnippets,
    description: `${node.name} | ${node.type} | ${bounds.width || 0}x${bounds.height || 0} | children: ${childCount} | layout: ${layoutMode}`
  };
}

function getContext() {
  return {
    fileKey: typeof figma.fileKey === "string" ? figma.fileKey : null,
    rootName: figma.root && figma.root.name ? figma.root.name : null,
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name
  };
}

const NODE_SEARCH_LIMIT = 200;
const TEXT_PREVIEW_LENGTH = 120;

function normalizeNodeTypes(params) {
  const raw = params && params.types;

  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  }

  return String(raw || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * 文本图层信息。
 *
 * 设计稿里部分文案用的是无法直接引用的商用字体，只能把该 TEXT 图层导出成图片；
 * 这里把文案、字体、字号一起返回，用来判断应该导出哪个图层。
 */
function textInfo(node) {
  if (node.type !== "TEXT") {
    return null;
  }

  const characters = String(node.characters || "");
  const fontName = node.fontName;
  const fontSize = node.fontSize;

  return {
    characters:
      characters.length > TEXT_PREVIEW_LENGTH
        ? `${characters.slice(0, TEXT_PREVIEW_LENGTH)}…`
        : characters,
    fontName:
      fontName && fontName !== figma.mixed
        ? { family: fontName.family, style: fontName.style }
        : null,
    fontSize: fontSize === figma.mixed ? null : fontSize
  };
}

function absoluteBounds(node) {
  const box = node.absoluteBoundingBox;

  if (!box) {
    return null;
  }

  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
}

function summarizeNode(node, index) {
  const bounds = hasBounds(node)
    ? {
        x: Math.round(node.x),
        y: Math.round(node.y),
        width: Math.round(node.width),
        height: Math.round(node.height)
      }
    : {};
  const parent = node.parent;

  return {
    index,
    id: node.id,
    name: node.name,
    type: node.type,
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    parentId: parent && parent.type !== "DOCUMENT" ? parent.id : null,
    parentName: parent && parent.type !== "DOCUMENT" ? parent.name : null,
    path: getNodePath(node),
    ...bounds,
    absolute: absoluteBounds(node),
    childCount: hasChildren(node) ? node.children.length : 0,
    visible: node.visible !== false,
    text: textInfo(node),
    description: `${node.name} | ${node.type} | ${bounds.width || 0}x${bounds.height || 0}`
  };
}

function matchesNode(node, params) {
  const types = normalizeNodeTypes(params);

  if (types.length > 0 && !types.includes(node.type)) {
    return false;
  }

  const name = String((params && params.name) || "").toLowerCase();
  if (name && !node.name.toLowerCase().includes(name)) {
    return false;
  }

  const text = String((params && params.text) || "");
  if (text && (node.type !== "TEXT" || !String(node.characters || "").includes(text))) {
    return false;
  }

  if (params && params.visibleOnly === true && node.visible === false) {
    return false;
  }

  return true;
}

/**
 * 按条件查找任意类型的节点，不限于 Frame。
 *
 * findAllFrames 只认 FRAME/COMPONENT/INSTANCE/SECTION，文本、编组、矢量图层都
 * 拿不到 id；而 exportFrame 本身接受任意 nodeId。这里补齐「先找到 id」这一步，
 * 用于导出品牌文案这类只能以图片还原的图层。
 */
function findNodes(params) {
  const scope = params && params.scope === "selection" ? "selection" : "currentPage";
  const roots = scope === "selection" ? figma.currentPage.selection : [figma.currentPage];
  const depth = params && params.depth === "direct" ? "direct" : "recursive";
  const requestedLimit = Number(params && params.limit);
  const limit =
    requestedLimit > 0 ? Math.min(Math.round(requestedLimit), 1000) : NODE_SEARCH_LIMIT;
  const nodes = [];
  let matched = 0;

  for (const root of roots) {
    if (!hasChildren(root)) {
      continue;
    }

    const candidates =
      depth === "direct"
        ? root.children.filter((node) => matchesNode(node, params))
        : root.findAll((node) => matchesNode(node, params));

    matched += candidates.length;

    for (const node of candidates) {
      if (nodes.length < limit) {
        nodes.push(node);
      }
    }
  }

  nodes.sort((a, b) => {
    const aBox = a.absoluteBoundingBox || { x: 0, y: 0 };
    const bBox = b.absoluteBoundingBox || { x: 0, y: 0 };

    if (aBox.y !== bBox.y) return aBox.y - bBox.y;
    return aBox.x - bBox.x;
  });

  return {
    scope,
    depth,
    rootName: figma.root && figma.root.name ? figma.root.name : null,
    pageName: figma.currentPage.name,
    count: nodes.length,
    matched,
    truncated: matched > nodes.length,
    nodes: nodes.map((node, index) => summarizeNode(node, index))
  };
}

function resetQueue() {
  selectedQueue = [];
  navigationQueue = [];
  queueIndex = -1;
  queueSignature = "";
}

function getSearchRoots(scope) {
  if (scope === "selection") {
    const selection = figma.currentPage.selection.filter(hasChildren);
    return selection.length > 0 ? selection : [];
  }

  return [figma.currentPage];
}

function collectFrameChildren(root, includeSections, depth) {
  if (!hasChildren(root)) {
    return [];
  }

  if (depth === "direct") {
    return root.children.filter((node) => {
      if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
        return true;
      }

      return includeSections && node.type === "SECTION";
    });
  }

  const found = root.findAll((node) => {
    if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
      return true;
    }

    return includeSections && node.type === "SECTION";
  });

  if (depth !== "outermost") {
    return found;
  }

  return found.filter((node) => {
    let parent = node.parent;

    while (parent && parent !== root && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
      if (isFrameLike(parent)) {
        return false;
      }

      parent = parent.parent;
    }

    return true;
  });
}

function findAllFrames(params) {
  if (params && params.scope === "queue") {
    return {
      scope: "queue",
      depth: "selected",
      rootName: figma.root && figma.root.name ? figma.root.name : null,
      pageName: figma.currentPage.name,
      count: selectedQueue.length,
      frames: selectedQueue.map((node, index) => summarizeFrame(node, index))
    };
  }

  const scope = params && params.scope === "selection" ? "selection" : "currentPage";
  const includeSections = params && params.includeSections === false ? false : true;
  const depth = params && ["direct", "recursive", "outermost"].includes(params.depth)
    ? params.depth
    : "outermost";
  const roots = getSearchRoots(scope);
  const seen = new Set();
  const nodes = [];

  for (const root of roots) {
    const found = collectFrameChildren(root, includeSections, depth);

    for (const node of found) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        nodes.push(node);
      }
    }
  }

  nodes.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  if (!params || params.updateQueue !== false) {
    navigationQueue = nodes;
    queueIndex = -1;
    queueSignature = nodes.map((node) => node.id).join(",");
  }

  return {
    scope,
    depth,
    rootName: figma.root && figma.root.name ? figma.root.name : null,
    pageName: figma.currentPage.name,
    count: nodes.length,
    frames: nodes.map((node, index) => summarizeFrame(node, index))
  };
}

async function getNodeById(nodeId) {
  if (!nodeId) {
    return null;
  }

  if (typeof figma.getNodeByIdAsync === "function") {
    return await figma.getNodeByIdAsync(nodeId);
  }

  return figma.getNodeById(nodeId);
}

async function selectFrame(params) {
  const mode = params && params.mode ? params.mode : "next";
  let target = null;

  if (mode === "nodeId") {
    target = await getNodeById(params.nodeId);
    const existingIndex = navigationQueue.findIndex((node) => node.id === params.nodeId);
    if (existingIndex >= 0) {
      queueIndex = existingIndex;
    }
  } else {
    if (Array.isArray(params.nodeIds)) {
      const nextSignature = params.nodeIds.join(",");
      if (nextSignature !== queueSignature) {
        await setNavigationQueue(params.nodeIds);
      }
    }

    if (navigationQueue.length === 0) {
      findAllFrames({ scope: "currentPage" });
    }

    const current = figma.currentPage.selection[0];
    const currentQueueIndex = current
      ? navigationQueue.findIndex((node) => node.id === current.id)
      : -1;

    if (currentQueueIndex >= 0) {
      queueIndex = currentQueueIndex;
    }

    if (mode === "previous") {
      queueIndex -= 1;
    } else {
      queueIndex += 1;
    }

    if (queueIndex < 0) {
      queueIndex = 0;
    }

    target = navigationQueue[queueIndex] || null;
  }

  if (!target || !isFrameLike(target)) {
    throw new Error("Target frame was not found");
  }

  figma.currentPage.selection = [target];
  figma.viewport.scrollAndZoomIntoView([target]);

  const summary = summarizeFrame(target, queueIndex);
  figma.notify(`Selected ${summary.name}`);

  return {
    selected: summary,
    queueIndex,
    queueCount: navigationQueue.length,
    hasNext: queueIndex >= 0 && queueIndex < navigationQueue.length - 1
  };
}

async function resolveFrameNodes(nodeIds) {
  const nodes = [];

  for (const nodeId of nodeIds) {
    const node = await getNodeById(nodeId);
    if (node && isFrameLike(node)) {
      nodes.push(node);
    }
  }

  return nodes;
}

async function setNavigationQueue(nodeIds, preserveIndex = false) {
  const previousQueueIndex = queueIndex;
  navigationQueue = await resolveFrameNodes(nodeIds);
  queueIndex = preserveIndex ? previousQueueIndex : -1;
  queueSignature = nodeIds.join(",");
}

async function setQueue(params) {
  const nodeIds = Array.isArray(params.nodeIds) ? params.nodeIds : [];
  selectedQueue = await resolveFrameNodes(nodeIds);
  await setNavigationQueue(nodeIds, Boolean(params && params.preserveIndex));

  return {
    count: selectedQueue.length,
    frames: selectedQueue.map((node, index) => summarizeFrame(node, index))
  };
}

/**
 * 按指定倍率导出节点图片。
 *
 * MCP 的 get_screenshot 会把长图压到 1024px 以内，静态长页需要走
 * Figma Plugin API 的 exportAsync 拿原尺寸/2x/3x 图。
 *
 * nodeId 可以是任意节点（Frame、编组、文本、矢量图层），配合 findNodes
 * 就能把设计稿里的品牌文案等「不能直接用字体还原」的图层导成图片。
 * PNG 默认保留透明背景，叠加到页面底图上不会出现矩形接缝。
 *
 * hideNodeText 支持逗号分隔的图层名关键字（如「状态栏」）：
 * 导出前临时隐藏匹配到的图层（含实例），导出后恢复，避免把设计稿里的
 * iOS/Android 状态栏一起导进静态长图。
 */
async function exportFrame(params) {
  const nodeId = params && params.nodeId;
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  const node = await getNodeById(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const scale = Number(params.scale) > 0 ? Number(params.scale) : 2;
  const format = params.format === "JPG" ? "JPG" : "PNG";
  const hideTexts = String(params.hideNodeText || "")
    .split(",")
    .map((text) => text.trim())
    .filter(Boolean);
  const hiddenNodes = [];

  if (hideTexts.length > 0) {
    const matches = node.findAll((child) =>
      hideTexts.some((text) => child.name.includes(text))
    );
    for (const child of matches) {
      if (child.visible) {
        hiddenNodes.push(child);
        child.visible = false;
      }
    }
  }

  try {
    const bytes = await node.exportAsync({
      format,
      constraint: { type: "SCALE", value: scale }
    });

    return {
      nodeId,
      name: node.name,
      width: Math.round(node.width * scale),
      height: Math.round(node.height * scale),
      scale,
      format,
      hiddenNodeCount: hiddenNodes.length,
      base64: figma.base64Encode(bytes)
    };
  } finally {
    for (const child of hiddenNodes) {
      child.visible = true;
    }
  }
}

figma.ui.onmessage = async (message) => {
  if (!message || message.type !== "bridge-command") {
    return;
  }

  try {
    let result;

    if (message.command === "getContext") {
      result = getContext();
    } else if (message.command === "findAllFrames") {
      result = findAllFrames(message.params || {});
    } else if (message.command === "findNodes") {
      result = findNodes(message.params || {});
    } else if (message.command === "selectFrame") {
      result = await selectFrame(message.params || {});
    } else if (message.command === "setQueue") {
      result = await setQueue(message.params || {});
    } else if (message.command === "exportFrame") {
      result = await exportFrame(message.params || {});
    } else {
      throw new Error(`Unknown command: ${message.command}`);
    }

    figma.ui.postMessage({
      type: "bridge-result",
      id: message.id,
      ok: true,
      result
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "bridge-result",
      id: message.id,
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
};

if (typeof figma.on === "function") {
  figma.on("currentpagechange", () => {
    resetQueue();
    figma.ui.postMessage({
      type: "context-changed",
      context: getContext()
    });
  });

  figma.on("selectionchange", () => {
    const selected = figma.currentPage.selection[0];
    figma.ui.postMessage({
      type: "selection-changed",
      nodeId: selected && isFrameLike(selected) ? selected.id : null
    });
  });
}
