# MultiClaude

在一个应用里并行管理多个 AI 编程 CLI 配置（Claude / Codex），并按配置隔离终端与工作区。

MultiClaude 是一个 Electron 桌面应用，适合需要频繁切换不同模型、不同 API Key、不同代码目录的开发场景。

## 解决的问题

CLI 工具大量依赖环境变量。手动 `export`、改 shell 配置、开多窗口容易混乱。

MultiClaude 提供“配置即入口”的方式：

- 配置好模型参数
- 一键开终端
- 自动注入正确环境变量

## 当前功能

- 双 Provider 配置：
  - `claude`（Anthropic 风格变量）
  - `codex`（OpenAI 兼容变量 + 自动生成 `CODEX_HOME/config.toml`）
- 内嵌终端（xterm.js + node-pty）
- 系统终端打开（继承当前配置）
- 多屏工作区（最多 4 屏）
- 屏内分组（重命名/折叠/删除/移动到组）
- Worktree 启动器（创建/列出/打开/清理 worktree，合并就绪检查，复制合并命令）
- 批量压力启动器（N 个子目录开 N 个终端，多轮脚本压测，导出 JSON 报告）
- 启动前 Preflight 检查（缺模型/缺 Key/URL 非法/JSON 非法/Claude hooks 提示）
- 运行状态识别（`running` / `waiting` / `idle` / `exited`）+ 一键跳到下一个等待终端
- 侧边栏折叠/展开，宽度持久化
- 配置导入导出（导出默认清空敏感密钥字段）

## 多屏规则

- 最多 4 屏，固定槽位：`screen-a` 到 `screen-d`
- 新建屏优先占用“第一个未使用槽位”
- 加载时会做 screen id 去重和规范化
- 布局规则：
  - 1 屏：占满
  - 2 屏：左右各半
  - 3 屏：左侧上下各 1/4，右侧 1/2
  - 4 屏：2x2
- `Move To Screen` 为子菜单（现有屏列表 + `+ New Screen...`）
- Tab 跨屏移动不会自动加入目标 Group，分组仅由用户显式操作

## 关闭屏幕语义

点击屏右上角 `x` 后，可选两种行为：

- `Close (Session Only)`：
  - 仅关闭该屏当前会话中的 Tab
  - 保留该屏和 Group 的持久化元数据
- `Close + Clear Saved Data`：
  - 关闭 Tab
  - 清除该屏持久化信息

## 环境变量注入机制

每次启动终端，MultiClaude 会在用户数据目录写入 env 文件并注入 provider 变量。

- Claude 常见变量：
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_MODEL`
- Codex 常见变量：
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`（或自定义 key 名）
  - `OPENAI_MODEL`
  - `CODEX_HOME`

为避免 shell 初始化覆盖变量，zsh 下会额外生成每个配置对应的 `ZDOTDIR` wrapper。

## 快速开始

### 1）安装并运行

```bash
pnpm install
pnpm run dev
```

### 2）创建配置

侧边栏点击 `+`：

1. 选择 Provider（Claude 或 Codex）
2. 填写 model/base URL/API key
3. 保存

### 3）启动终端

- 内嵌终端：点击 `Terminal`
- 系统终端：配置卡片 `...` -> `System`
- Worktree 终端：点击 `Worktree`

### 4）组织标签页

- 右键 Tab -> `Move To Screen`
- 右键 Tab -> `Move To Group`
- 右键 Group -> 重命名 / 关闭全部 / 删除

## 快捷键

- `Cmd/Ctrl+T`：新建内嵌终端
- `Cmd/Ctrl+Shift+T`：新建系统终端
- `Cmd/Ctrl+Alt+T`：新建 Worktree 终端
- `Cmd/Ctrl+W`：关闭当前终端标签
- `Cmd/Ctrl+Shift+]` / `Cmd/Ctrl+Shift+[`：下一个/上一个标签
- `Cmd/Ctrl+;`：跳到下一个 waiting 终端
- `Cmd/Ctrl+K`：清屏
- `Cmd/Ctrl+B`：切换侧边栏折叠
- `Cmd/Ctrl+1..9`：跳转到指定标签
- `Cmd/Ctrl+,`：Preferences

## 数据存储位置

数据写入 Electron `app.getPath('userData')`（随平台变化），主要包括：

- `configs.json`
- `settings.json`
- `env-files/`
- `codex-homes/`

## 构建与测试

```bash
pnpm run build
pnpm run test
pnpm run test:coverage
pnpm run start
```

打包：

```bash
pnpm run dist:mac
pnpm run dist:win
```

## 项目结构

- `src/main/`：主进程（IPC、PTY、配置存储、环境构建、protocol/worktree 服务）
- `src/preload/`：安全桥接 API
- `src/renderer/`：界面、状态、组件
- `src/shared/`：共享类型与常量

## 仓库地址

- 项目主页：https://github.com/zkkython/MultiClaude
- Issue：https://github.com/zkkython/MultiClaude/issues
