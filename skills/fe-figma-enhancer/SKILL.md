---
name: fe-figma-enhancer
description: 通过本地 figma-enhancer CLI 读取 Figma 插件 UI 勾选的 Frame 队列（拿 nodeId），查找 TEXT/GROUP/VECTOR 等任意类型节点并导出成图片，支持 --project 按项目定向（多项目插件同时打开时不抢答）。拿到 nodeId 后配合官方 Figma MCP 读取单个 Frame 的设计详情。用户需要批量实现 Figma 页面、逐个读取设计稿，或设计稿里存在无法用项目字体还原的图层时触发。
metadata:
  author: mc.chen05@zuche.com
  version: "1.1.0"
  versionTime: "2026-10-29"
  status: stable
  deprecated_by: ""
---

# Figma Frame 队列读取工具

本技能使用 `figma-enhancer` CLI 读取 Figma 插件 UI 中勾选的 Frame 队列，拿到 nodeId 后配合官方 Figma MCP 读取设计详情。CLI 提供四条命令：`health`（诊断）、`frames`（读队列）、`nodes`（查找任意类型节点）、`export`（导出节点图片）。

## 前置条件

1. 在 Figma 中导入并运行本项目的 `plugin/manifest.json`。
2. 保持 Figma Enhancer 插件窗口打开。
3. 确认 CLI 已安装并可执行：

```bash
figma-enhancer help
```

如果命令不在 `PATH`，先在本项目执行 `npm link`，或使用 `node <项目目录>/cli/figma-enhancer.js`。

## 标准流程

1. 执行 `figma-enhancer health` 检查本地 bridge 和插件连接状态；`connectedProjects` 会列出当前连着 bridge 的项目（多项目插件同时打开时尤其有用）。
2. 执行 `figma-enhancer frames` 读取用户在插件 UI 中勾选的 Frame 队列（默认就是 queue）。
   - 如果多个 Figma 项目同时开着插件窗口导致结果来回跳，加 `--project <项目名>` 定向到目标项目。
3. 从返回结果中读取准确的 `id`，直接调用官方 Figma MCP 的 `get_design_context(nodeId)` 和 `get_screenshot(nodeId)` 读取该 Frame 的完整设计上下文，再实现代码。不需要先在画布上选中该 Frame。
4. 图层无法用代码还原时（例如品牌文案用了项目无法加载的字体），用 `nodes` 找到图层 id，再用 `export` 导出 2x 图片接入页面。
5. 处理下一个 Frame 时重复第 3 至 4 步。

## CLI 命令

```bash
# 查看 bridge 和插件状态（含已连接的项目列表）
figma-enhancer health

# 读取插件 UI 勾选的 Frame 队列（唯一的数据来源，CLI 只负责拿 nodeId）
figma-enhancer frames

# 只查询队列数量，避免输出完整 Frame 数据
figma-enhancer frames --count-only

# 多项目插件同时打开时，指定项目名定向读取（避免命令被别的项目插件抢答）
figma-enhancer frames --project 'App'

# 查找任意类型节点：文本、编组、矢量图层都能拿到 id
figma-enhancer nodes --name '<关键字>' --type TEXT,GROUP --limit 20
figma-enhancer nodes --text '<文案>' --scope selection

# 把节点导出成图片（nodeId 可以是任意节点）
figma-enhancer export --node-id '123:456' --out /tmp/layer@2x.png --scale 2
```

所有命令都输出 JSON。`ok` 为 `false` 或进程退出码非零时，说明执行失败，不能继续用结果中的 nodeId。

## 参数和结果约定

### frames

- 只读取插件 UI 勾选的 Frame 队列（等效于 `--scope queue`）。
- `--project <项目名>` 指定目标项目：bridge 只把命令派发给该项目对应的插件窗口，多个 Figma 项目同时开着插件时不会抢答。项目名就是 Figma 文件名（`health` 的 `connectedProjects` 可查）。
- `--count-only` 只输出数量和页面信息；用户只问“有几个”时必须优先使用，避免输出大量 Frame 数据。
- 结果里的 `rootName` 表示这次应答的是哪个项目，可用于核对定向是否生效。
- CLI 返回的 `description`/`textSnippets` 只用于定位，不替代官方设计上下文。

### nodes

- `--name <关键字>`：图层名包含该关键字（不区分大小写）。
- `--text <文案>`：文本图层内容包含该文案。
- `--type <类型>`：逗号分隔的节点类型，如 `TEXT,GROUP`；不传则不限制类型。
- `--scope currentPage|selection`：扫整页（默认）或只扫当前选区。
- `--depth direct|recursive`：只看直接子节点（`direct`）或递归所有层级（默认）。
- `--limit <n>`：最多返回多少条，默认 200，上限 1000；超出时 `truncated` 为 `true`。
- `--visible-only`：跳过隐藏图层。
- `--project <项目名>`：同 `frames`，用于多项目定向。
- 结果包含 `id`、`name`、`type`、`absolute`（绝对坐标）、`visible`；TEXT 图层额外带 `text.characters`、`text.fontName`、`text.fontSize`，用于判断该导出哪个图层。

### export

- `--node-id <id>`：任意节点，不限于 Frame。
- `--out <file>`：输出文件路径，CLI 会直接写入图片。
- `--scale <n>`：导出倍率，默认 2。
- `--format PNG|JPG`：默认 PNG；PNG 保留透明背景，文本图层叠加到页面底图上不会出现矩形接缝。
- `--hide-node <关键字>`：逗号分隔的图层名关键字（如 `状态栏`），导出前临时隐藏、导出后自动恢复。
- `--project <项目名>`：同 `frames`。
- 结果返回 `nodeId`、`name`、`width`、`height`、`scale`、`format`、`hiddenNodeCount`、`out`。

## 用导出代替重绘

设计稿里部分文案使用的是项目无法直接引用的字体。不要用其他字体近似字形：

1. 用 `figma-enhancer nodes --text '<文案>'`（或 `--name`）找到该图层。
2. 按 2x 导出：`figma-enhancer export --node-id '<id>' --out src/assets/<name>@2x.png --scale 2`。
3. CSS 里按一半像素尺寸渲染（`width: <px/2>`），保证高清屏清晰，并保留原文案的 `alt`。
4. 用浏览器截图与 Figma 稿对比后再汇报改动。

## 故障处理

- 超时：提示用户打开插件并保持窗口可见，等待后重试一次。
- `pluginConnected: false`：说明 bridge 可访问但插件未轮询，先让用户重新打开或切回插件面板。
- 端口占用：CLI 会尝试复用已有兼容 bridge；若返回不兼容错误，检查 `FIGMA_ENHANCER_PORT` 是否与本地 bridge 配置一致。
- `nodes` 返回 `count` 为 0：先去掉 `--type`、`--visible-only` 等过滤条件重试，再确认图层是否在当前页或当前选区内。
- `frames` 返回的 `description`/`textSnippets` 只用于定位，不替代官方设计上下文；实现前必须调用官方 Figma MCP 读取完整设计详情。

## 代码仓库约定

修改 CLI 或插件时，先执行：

```bash
npm run check
```

不要把本机绝对路径写入项目代码或 Skill。运行时先根据当前工作区定位项目目录。
