figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

let frameQueue = [];
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

function resetQueue() {
  frameQueue = [];
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
      pageName: figma.currentPage.name,
      count: frameQueue.length,
      frames: frameQueue.map((node, index) => summarizeFrame(node, index))
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
    frameQueue = nodes;
    queueIndex = -1;
    queueSignature = nodes.map((node) => node.id).join(",");
  }

  return {
    scope,
    depth,
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
    const existingIndex = frameQueue.findIndex((node) => node.id === params.nodeId);
    if (existingIndex >= 0) {
      queueIndex = existingIndex;
    }
  } else {
    if (Array.isArray(params.nodeIds)) {
      const nextSignature = params.nodeIds.join(",");
      if (nextSignature !== queueSignature) {
        await setQueue({ nodeIds: params.nodeIds });
      }
    }

    if (frameQueue.length === 0) {
      findAllFrames({ scope: "currentPage" });
    }

    const current = figma.currentPage.selection[0];
    const currentQueueIndex = current
      ? frameQueue.findIndex((node) => node.id === current.id)
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

    target = frameQueue[queueIndex] || null;
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
    queueCount: frameQueue.length,
    hasNext: queueIndex >= 0 && queueIndex < frameQueue.length - 1
  };
}

async function setQueue(params) {
  const nodeIds = Array.isArray(params.nodeIds) ? params.nodeIds : [];
  const nodes = [];
  const previousQueueIndex = queueIndex;

  for (const nodeId of nodeIds) {
    const node = await getNodeById(nodeId);
    if (node && isFrameLike(node)) {
      nodes.push(node);
    }
  }

  frameQueue = nodes;
  queueIndex = params && params.preserveIndex ? previousQueueIndex : -1;
  queueSignature = nodeIds.join(",");

  return {
    count: frameQueue.length,
    frames: frameQueue.map((node, index) => summarizeFrame(node, index))
  };
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
    } else if (message.command === "selectFrame") {
      result = await selectFrame(message.params || {});
    } else if (message.command === "setQueue") {
      result = await setQueue(message.params || {});
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
}
