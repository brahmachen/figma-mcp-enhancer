---
name: figma-enhancer
description: Control the companion Figma plugin through the local figma-enhancer CLI to list queued, selected, or current-page frames and select a frame on the Figma canvas. Use when implementing multiple Figma frames, navigating a user-curated frame queue, or when the Figma MCP enhancer connection is unavailable or unreliable.
---

# Figma Enhancer

Use the CLI to discover and select Figma frames without depending on an MCP server connection. Keep the Figma Enhancer plugin window open while running commands.

## Locate the CLI

Prefer `figma-enhancer` when it is on `PATH`. Otherwise locate this skill's repository and run:

```bash
node <repo>/cli/figma-enhancer.js <command>
```

All commands emit JSON to stdout. Treat `ok: false` or a nonzero exit status as failure.

## Workflow

1. Run `figma-enhancer health` to inspect an existing bridge. A stopped bridge is normal because CLI commands can start a temporary bridge. If `pluginConnected` is false, ask the user to open the Figma Enhancer plugin window.
2. Read the user-curated queue with `figma-enhancer frames --scope queue`.
3. If the queue is empty and the user did not explicitly request the queue, scan with `figma-enhancer frames --scope currentPage --depth outermost`.
4. Select a frame with `figma-enhancer select --node-id '<nodeId>'`.
5. Use the official Figma integration to read design context or screenshots for the selected node.
6. Repeat for the remaining frames.

## Commands

```bash
figma-enhancer health
figma-enhancer frames --scope queue
figma-enhancer frames --scope currentPage --depth outermost
figma-enhancer frames --scope selection --depth direct
figma-enhancer frames --scope selection --depth recursive --no-sections
figma-enhancer select --node-id '123:456'
figma-enhancer select --next --node-ids '123:456,123:789'
figma-enhancer select --previous --node-ids '123:456,123:789'
```

Use exact node IDs from the frames response. Pass `--node-ids` for deterministic next/previous navigation instead of relying on a prior process's in-memory queue.

## Failure Handling

- If a command times out, tell the user to open the plugin and keep its window visible, then retry once.
- If the port is occupied by an incompatible process, report the configured port and suggest setting the same `FIGMA_ENHANCER_PORT` for both plugin bridge and CLI only after checking the local setup.
- Do not replace official Figma design-context retrieval with frame summaries. Summaries are for discovery; the official integration remains the source for detailed design data.
