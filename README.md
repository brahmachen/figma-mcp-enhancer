# Figma MCP Enhancer

这是一个用于增强 Figma 批处理能力的 CLI + Skill + Figma 插件桥接，同时保留 companion MCP server 兼容入口。

它新增两个 MCP 工具：

- `figma_find_all_frames`：获取当前页面或当前选中父级下面的 Frame 列表。
- `figma_select_frame`：按 `nodeId` 指定选中某个 Frame，或从上一次列表队列中选中下一个/上一个 Frame。

它不会修改官方 Figma MCP server，而是作为并行的 MCP server 使用。这个工具负责“找 Frame / 选中 Frame”，官方 Figma MCP 继续负责在选中后调用 `get_design_context` 读取设计上下文。

## 文件说明

- `plugin/manifest.json`：Figma 插件配置。
- `plugin/src/main.js`：访问 Figma 文档、查找 Frame、切换选中节点的核心逻辑。
- `plugin/src/ui.html`：插件 UI，同时负责和本地 MCP bridge 通信。
- `mcp/server.js`：stdio MCP server，同时启动本地 HTTP bridge。

## 启动方式

### 推荐：CLI + Skill

在项目目录安装 CLI：

```bash
npm link
```

保持 Figma 插件窗口打开，然后直接运行：

```bash
figma-enhancer health
figma-enhancer frames --scope queue
figma-enhancer select --node-id "123:456"
```

CLI 会在调用期间临时启动本地 bridge，命令完成后退出，不需要配置或保持 MCP server 常驻。如果 `8787` 端口上已有兼容 bridge，CLI 会自动复用。

仓库内提供 `skills/figma-enhancer` Skill，可链接到 Codex 的 skills 目录后使用。

### 兼容：MCP server

1. 在 MCP 客户端中配置这个 server。

   不需要手动长期运行 `mcp/server.js`。Codex、Cursor、Claude Desktop 等 MCP 客户端启动后，会根据配置自动拉起这个 server。

   ```bash
   node /Users/xxx/figma-mcp-enhancer/mcp/server.js
   ```

   MCP 配置示例：

   ```json
   {
     "mcpServers": {
       "figma-mcp-enhancer": {
         "command": "node",
         "args": ["/Users/xxx/figma-mcp-enhancer/mcp/server.js"]
       }
     }
   }
   ```

2. 重启 MCP 客户端。

   例如重启 Codex、Cursor 或 Claude Desktop。客户端启动后会自动启动 `figma-mcp-enhancer/mcp/server.js`，并同时打开本地 bridge：

   ```text
   http://localhost:8787
   ```

3. 在 Figma 中导入插件，选择这个 manifest 文件：

   ```text
   figma-mcp-enhancer/plugin/manifest.json
   ```

4. 运行插件，并保持插件的小窗口打开。正常情况下会显示 `Connected` 或等待 MCP 命令的状态。

   如果在 Dev Mode 中使用，它不会像普通 Design 插件一样显示浮动窗口；它会出现在右侧 Inspect 面板的 Plugins 区域里。

### 手动调试

只有在排查 bridge 连接问题时，才需要手动启动 server：

```bash
node /Users/markchen/shenzhou/figma-mcp-enhancer/mcp/server.js
```

如果这个命令能看到：

```text
Figma MCP Enhancer bridge listening on http://localhost:8787
```

说明本地 bridge 可以正常启动。正式使用时仍然建议交给 MCP 客户端自动拉起。

## 插件 UI 用法

点击 `Find frames` 后，插件会列出当前页面所有最外层 Frame。默认不会把它们加入 `Next` 队列。

点击列表里的 Frame 名称/内容区域，会在 Figma 设计稿中同步选中该 Frame，并滚动到对应位置。

勾选需要处理的 Frame 后，点击 `Use selected`，只有勾选的 Frame 会进入队列。之后点击 `Next` 会按列表顺序逐个选中这些 Frame。

`Next` 会以当前勾选列表为准，只在勾选的 Frame 队列中跳转。MCP 也可以通过 `figma_find_all_frames` + `scope: "queue"` 读取当前勾选队列。

如果需要快速选择，可以使用：

- `All`：全选当前列表。
- `Clear`：清空当前选择。

插件会把当前页面的 Frame 列表和勾选队列保存到本地状态文件中，默认路径是系统临时目录下的 `figma-mcp-enhancer-state.json`。状态会按 Figma 文件和页面隔离，切换项目或页面时不会恢复另一个项目里的 Frame 列表。Dev Mode 右侧面板切换到 Inspect 再切回来时，UI 可能会被 Figma 重建，但插件会自动恢复当前文件、当前页面上一次的列表和勾选状态。

## MCP 工具用法

### `figma_find_all_frames`

用于获取 Frame 列表。最常用的是读取插件 UI 中已经勾选的队列：

```json
{
  "scope": "queue"
}
```

返回结果会包含：

- `count`：Frame 数量。
- `frames`：Frame 列表。
- `frames[].id`：Figma nodeId，可传给 `figma_select_frame` 或官方 Figma MCP。
- `frames[].name`：Frame 名称。
- `frames[].description`：基础描述，包括尺寸、子节点数量、布局信息等。
- `frames[].textSnippets`：Frame 内部前几个文本片段，方便 AI 判断页面内容。

如果需要不依赖 UI 勾选，直接扫描当前页面最外层 Frame：

```json
{
  "scope": "currentPage",
  "depth": "outermost"
}
```

如果只想扫描当前选中父级下面的直接子 Frame：

```json
{
  "scope": "selection",
  "depth": "direct"
}
```

如果确实需要包含内部嵌套 Frame：

```json
{
  "scope": "selection",
  "depth": "recursive"
}
```

`depth` 说明：

- `outermost`：只返回最外层 Frame，Frame 内部嵌套的 Frame 不会返回。默认值。
- `direct`：只返回搜索根节点的直接子级 Frame。
- `recursive`：递归返回所有内部嵌套 Frame。

### `figma_select_frame`

用于让 Figma 画布同步选中某个 Frame。

选中指定 Frame：

```json
{
  "mode": "nodeId",
  "nodeId": "123:456"
}
```

在队列中选择下一个 Frame：

```json
{
  "mode": "next"
}
```

如果希望明确限制在某个队列里跳转，可以把 `figma_find_all_frames` 返回的 id 列表传给 `nodeIds`：

```json
{
  "mode": "next",
  "nodeIds": ["123:456", "123:789", "123:999"]
}
```

选择上一个 Frame：

```json
{
  "mode": "previous"
}
```

推荐给 AI 的调用顺序：

1. `figma_find_all_frames({ "scope": "queue" })` 读取插件 UI 勾选队列。
2. `figma_select_frame({ "mode": "nodeId", "nodeId": "..." })` 或 `figma_select_frame({ "mode": "next", "nodeIds": [...] })` 选中目标 Frame。
3. 调用官方 Figma MCP 的 `get_design_context` 读取当前选中 Frame。
4. 实现代码。
5. 继续选中下一个 Frame。

## 推荐 AI 工作流

1. 调用 `figma_find_all_frames`，使用 `scope: "selection"` 或 `scope: "currentPage"` 获取待实现 Frame 队列。
2. 调用 `figma_select_frame`，使用 `mode: "next"` 或指定 `nodeId` 选中某个 Frame。
3. 调用官方 Figma MCP 的 `get_design_context`，读取当前选中 Frame 的设计上下文。
4. 实现当前 Frame。
5. 重复第 2 步，继续实现下一个 Frame。

## 注意事项

- Figma 插件窗口必须保持打开，否则 MCP server 无法通过 bridge 调用 Figma 插件。
- 插件通过 `http://localhost:8787` 连接本地 bridge；Figma manifest 不接受 `http://127.0.0.1:8787` 作为 `devAllowedDomains`。
- `figma_find_all_frames` 只负责返回列表和基础描述，不替代官方 Figma MCP 的 `get_design_context`。
- 默认使用 `scope: "currentPage"` + `depth: "outermost"` 扫描页面最外层 Frame，适合“逐个实现页面级 Frame”的场景。
- 如果 Figma 文件很大，可以使用 `scope: "selection"` + `depth: "direct"`，先选中一个父级容器，再只扫描它下面的直接子 Frame。
- 这个项目适合和官方 Figma MCP 一起使用：本项目负责批处理选中，官方 MCP 负责读取设计上下文和截图。
- 不需要 publish 才能保留切 tab 前的勾选状态；当前实现通过本地 bridge 的状态文件保存 UI 状态。可以通过环境变量 `FIGMA_ENHANCER_STATE_FILE` 指定状态文件路径。
