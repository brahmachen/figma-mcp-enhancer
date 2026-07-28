# Figma MCP Enhancer

这是一个用于批量查找和选中 Figma Frame 的本地工具，由 Figma 插件、CLI 和配套 Skill 组成。CLI 可以读取插件中勾选的 Frame 队列、扫描当前页面或当前选区，并让 Figma 画布切换到指定 Frame。

## 安装 Figma 插件

1. 下载或克隆本仓库，并确认本地存在以下文件：

   ```text
   figma-mcp-enhancer/plugin/manifest.json
   ```

2. 打开 Figma 桌面端，在菜单中选择 `Plugins` > `Development` > `Import plugin from manifest...`。

3. 选择本仓库中的 `plugin/manifest.json`。

4. 在任意 Figma 设计文件中选择 `Plugins` > `Development` > `Figma MCP Enhancer` 运行插件。

5. 使用 CLI 时保持插件窗口打开，然后执行 `frames` 或 `select` 命令。命令启动临时 bridge 后，插件会自动连接并处理请求。

在 Dev Mode 中，插件会出现在右侧 Inspect 面板的 Plugins 区域，而不是以普通浮动窗口显示。

## 安装 CLI

需要先安装 Node.js。在仓库根目录执行：

```bash
npm link
```

确认 CLI 已可用：

```bash
figma-enhancer --help
```

如果不希望全局链接，也可以在仓库根目录直接运行：

```bash
node cli/figma-enhancer.js --help
```

后续示例中的 `figma-enhancer` 均可替换为 `node cli/figma-enhancer.js`。

## 快速开始

先在 Figma 中打开插件，然后执行：

```bash
# 查看连接状态
figma-enhancer health

# 读取插件 UI 中已勾选的 Frame
figma-enhancer frames --scope queue

# 选中指定 Frame
figma-enhancer select --node-id "123:456"
```

CLI 会在执行 `frames` 或 `select` 命令时临时启动本地 bridge，并在命令结束后退出。因此，没有命令运行时 `health` 返回 `bridgeRunning: false` 是正常现象。

所有命令都向标准输出返回 JSON。`ok: false` 或非零退出码表示执行失败。

## CLI 用法

### 查看连接状态

```bash
figma-enhancer health
```

该命令只检查当前是否已有 bridge 在运行。插件是否可用应以实际执行一次 `frames` 或 `select` 命令为准。

### 获取 Frame 列表

```bash
figma-enhancer frames [--scope queue|currentPage|selection] [--depth outermost|direct|recursive] [--no-sections] [--count-only]
```

`--scope` 指定查找范围，默认值为 `queue`：

- `queue`：返回插件 UI 中已勾选并通过 `Use selected` 确认的 Frame。
- `currentPage`：扫描 Figma 当前页面。
- `selection`：扫描当前选中节点下面的 Frame。

`--depth` 指定扫描深度，默认值为 `outermost`：

- `outermost`：只返回搜索范围内最外层的 Frame。
- `direct`：只返回搜索根节点的直接子 Frame。
- `recursive`：递归返回所有嵌套 Frame。

其他选项：

- `--no-sections`：结果中不包含 Section。
- `--count-only`：只输出页面信息和 Frame 数量，不输出完整列表。

常用示例：

```bash
# 读取插件中人工整理的队列
figma-enhancer frames --scope queue

# 获取当前页面最外层的 Frame
figma-enhancer frames --scope currentPage --depth outermost

# 获取当前选中容器的直接子 Frame
figma-enhancer frames --scope selection --depth direct

# 递归获取当前选区下的 Frame，并排除 Section
figma-enhancer frames --scope selection --depth recursive --no-sections

# 只查看当前页面最外层 Frame 的数量
figma-enhancer frames --scope currentPage --count-only
```

Frame 结果包含 `id`、`name`、尺寸、布局信息和部分文本摘要。其中 `id` 可直接传给 `select --node-id`。

### 选中 Frame

按 node ID 选中：

```bash
figma-enhancer select --node-id "123:456"
```

在指定队列中选择下一个或上一个 Frame：

```bash
figma-enhancer select --next --node-ids "123:456,123:789,123:999"
figma-enhancer select --previous --node-ids "123:456,123:789,123:999"
```

建议始终向 `--next` 或 `--previous` 传入 `--node-ids`，这样每次 CLI 调用都使用明确、稳定的队列。

## 插件 UI 用法

点击 `Find frames` 后，插件会列出当前页面所有最外层 Frame。点击列表中的 Frame 名称，会在 Figma 画布中选中该 Frame，并滚动到对应位置。

勾选需要处理的 Frame 后，点击 `Use selected` 建立队列。之后可以使用插件中的 `Next`，也可以通过 CLI 的 `frames --scope queue` 读取队列。

快速选择按钮：

- `All`：全选当前列表。
- `Clear`：清空当前选择。

## 推荐工作流

1. 在 Figma 中打开插件并保持窗口可见。
2. 点击 `Find frames`，勾选待处理的 Frame，再点击 `Use selected`。
3. 运行 `figma-enhancer frames --scope queue` 获取 Frame 列表和 node ID。
4. 运行 `figma-enhancer select --node-id "<nodeId>"` 选中目标 Frame。
5. 处理完成后，继续选择列表中的下一个 Frame。

如果不需要人工整理队列，可以直接运行：

```bash
figma-enhancer frames --scope currentPage --depth outermost
```

## Skill 用法

仓库内提供 `skills/figma-enhancer` Skill。将其链接到 Codex 的 skills 目录后，Agent 可以按照相同的 CLI 工作流查找和选中 Frame。

## 故障排查

- 命令等待后超时：确认 Figma 插件已运行，并保持插件窗口打开，然后重试。
- `health` 显示 bridge 未运行：如果当前没有其他命令执行，这是正常状态；直接运行 `frames` 验证即可。
- `8787` 端口被占用：关闭占用该端口且不兼容的进程后重试。
- 大文件扫描较慢：先在 Figma 中选中一个父级容器，再使用 `--scope selection --depth direct` 缩小范围。
- 默认等待插件响应 30 秒。需要延长时可设置 `FIGMA_ENHANCER_TIMEOUT_MS`，例如：

  ```bash
  FIGMA_ENHANCER_TIMEOUT_MS=60000 figma-enhancer frames --scope currentPage
  ```

插件通过 `http://localhost:8787` 与本地 CLI bridge 通信。Figma manifest 不接受用 `http://127.0.0.1:8787` 替代该开发域名。
