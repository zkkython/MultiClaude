# MultiClaude — 多模型并行终端管理器

> 同时跑 Claude、Kimi、GLM 等多个大模型 CLI？一个窗口搞定。

---

## 痛点：你是不是也这样？

用 Claude Code 写代码的人越来越多了。但现实往往是——你手头不止一个模型。

Opus 4.6 用来啃硬骨头，Kimi K2.5 拿来做快速原型，GLM-5 跑一些测试场景……每个模型背后可能是不同的 API 地址、不同的 Token、甚至不同的代理。

Claude Code 的配置全靠环境变量（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`……），想切换模型？要么改 `.zshrc`，要么开一堆终端窗口手动 `export`，要么维护几套 shell alias——哪种都不优雅，还容易搞混。

**MultiClaude 就是为了解决这件事。**

---

## 它能做什么？

简单说：**给每个模型定义一套配置，点一下就能打开一个注入了正确环境变量的终端，多个模型可以同时跑。**

具体来讲：

- **命名配置** — 给每套模型环境变量起个名字，比如"Opus 4.6 直连"、"Kimi K2.5 走代理"，一目了然
- **内嵌终端** — 应用内直接开终端（基于 xterm.js），每个标签页用不同的模型配置
- **系统终端** — 一键打开 macOS Terminal.app，环境变量已经帮你注入好了
- **并行使用** — 左边标签页跑 Opus，右边标签页跑 Kimi，互不干扰

---

## 功能一览

- **配置管理** — 创建、编辑、复制、删除、导入/导出模型配置
- **内嵌终端** — 完整的 xterm.js 终端，支持 WebGL 渲染、可点击链接、右键菜单
- **系统终端** — 一键启动 macOS Terminal.app 并自动注入环境变量
- **多标签页** — 同时运行多个终端，每个使用不同配置
- **环境变量覆写** — 即使你的 `~/.zshrc` 里设了同名变量也能正确覆盖（ZDOTDIR + CLAUDE_ENV_FILE 双重机制）
- **配置搜索** — 配置多了以后可以按名称快速过滤
- **可调侧边栏** — 拖拽调整宽度，重启后自动记住
- **暗色主题** — Catppuccin Mocha 风格，看着舒服
- **快捷键** — 完整的菜单栏 + 标准快捷键支持
- **导入/导出** — 通过 JSON 文件在不同机器间同步配置

---

## 架构概览

对于想了解内部实现的同学，这是整体架构：

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
│                                                         │
│  ┌──────────────┐    IPC     ┌────────────────────────┐ │
│  │ Main Process │◄──────────►│   Renderer Process     │ │
│  │              │            │                        │ │
│  │ config-store │            │  Sidebar  │ Terminal   │ │
│  │ pty-manager  │  node-pty  │  Config   │ Tabs       │ │
│  │ env-builder  │◄──────────►│  Editor   │ xterm.js   │ │
│  │ system-term  │            │  Status   │ Views      │ │
│  │ menu         │            │  Bar      │            │ │
│  └──────────────┘            └────────────────────────┘ │
│         │                                               │
│         ▼                                               │
│  ~/.multiclaude/configs.json                            │
│  ~/Library/Application Support/multiclaude/env-files/   │
└─────────────────────────────────────────────────────────┘
```

主进程负责配置存储、PTY 管理和环境变量构建；渲染进程负责 UI 展示，包括侧边栏、配置编辑器、终端标签页等。两者通过 IPC 通信。

### 项目结构

```
src/
├── main/                          # Electron 主进程
│   ├── index.ts                   # 应用生命周期、窗口创建
│   ├── ipc-handlers.ts            # IPC 处理器注册
│   ├── pty-manager.ts             # node-pty 的 spawn/write/resize/kill
│   ├── config-store.ts            # 配置 CRUD，JSON 文件读写
│   ├── system-terminal.ts         # 启动 macOS Terminal.app 并注入环境变量
│   ├── env-builder.ts             # 构建环境变量 + ZDOTDIR wrapper
│   └── menu.ts                    # 应用菜单栏
├── preload/
│   └── index.ts                   # contextBridge API
├── renderer/
│   ├── index.html                 # 入口 HTML
│   ├── index.ts                   # 应用初始化、事件绑定
│   ├── styles/
│   │   └── main.css               # 全部样式（Catppuccin Mocha 主题）
│   ├── components/
│   │   ├── Sidebar.ts             # 配置列表、搜索、操作按钮
│   │   ├── ConfigEditor.ts        # 创建/编辑配置的弹窗
│   │   ├── TerminalTabs.ts        # 标签页管理
│   │   ├── TerminalView.ts        # xterm.js 封装 + 右键菜单
│   │   ├── WelcomeScreen.ts       # 首次启动的空白引导页
│   │   └── StatusBar.ts           # 底部信息栏
│   └── state/
│       └── store.ts               # 简单的发布/订阅响应式状态
└── shared/
    ├── types.ts                   # TypeScript 接口定义
    └── constants.ts               # IPC 通道名、默认值
```

### 环境变量覆写机制（技术细节）

这是 MultiClaude 的核心难题：PTY 终端启动时会跑一个 login shell（zsh），它会 source `~/.zshrc`——如果你在 `.zshrc` 里也设了 `ANTHROPIC_BASE_URL` 之类的变量，就会把我们注入的值覆盖掉。

MultiClaude 用了三重机制来确保环境变量"最后一个生效"的是我们的：

1. **ZDOTDIR wrapper**（内嵌终端用）— 把 zsh 指向一个自定义的 `.zshrc`，它先 source 你真正的 `~/.zshrc`，然后再重新 export MultiClaude 的配置变量，确保我们的值在最上面。
2. **CLAUDE_ENV_FILE**（Claude Code 专用）— 生成一个包含所有配置变量的 shell 脚本，Claude Code 启动时会 source 这个文件，覆盖 shell 设置的任何值。
3. **osascript do script**（系统终端用）— Terminal.app 打开并完成 shell 初始化后，再 source 环境变量文件，完成覆盖。

### 数据模型

每个配置存储以下字段：

| 字段                           | 对应环境变量                                 | 说明                          |
| ------------------------------ | -------------------------------------------- | ----------------------------- |
| `anthropicBaseUrl`           | `ANTHROPIC_BASE_URL`                       | API 接口地址                  |
| `anthropicAuthToken`         | `ANTHROPIC_AUTH_TOKEN`                     | 认证 Token                    |
| `anthropicModel`             | `ANTHROPIC_MODEL`                          | 主模型名称                    |
| `anthropicSmallFastModel`    | `ANTHROPIC_SMALL_FAST_MODEL`               | 轻量任务用的快速模型          |
| `apiTimeoutMs`               | `API_TIMEOUT_MS`                           | 请求超时时间（默认 600000ms） |
| `disableNonessentialTraffic` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 是否禁用遥测                  |
| `customEnvVars`              | *（自定义）*                               | 任意键值对环境变量            |

配置文件保存在 `~/Library/Application Support/multiclaude/configs.json`，文件权限限制为仅所有者可读写（0600）。

---

## 安装

### 方式一：DMG 安装（推荐）

1. 从 [Releases](https://github.com/anthropics/multiclaude/releases) 下载最新的 `.dmg` 文件
2. 打开 DMG，把 **MultiClaude** 拖到 Applications 文件夹
3. 从启动台或 Spotlight 启动

### 方式二：从源码构建

需要 Node.js >= 18 和 pnpm。

```bash
git clone https://github.com/anthropics/multiclaude.git
cd multiclaude
pnpm install
node scripts/build.js
npx electron .
```

### 构建 DMG 安装包

```bash
pnpm run dist:mac
```

产出文件：`out/MultiClaude-1.0.0-arm64.dmg`（和/或 x64 版本）

---

## 使用指南

### 第一步：创建配置

启动 MultiClaude，首次打开会看到欢迎页面。

点击 **Create Your First Config**，填写以下信息：

- **Name** — 给配置起个好认的名字，比如"Opus 4.6 直连"、"Kimi K2.5 走代理"
- **Color** — 选个颜色，方便一眼区分不同配置
- **Model** — 模型标识符，比如 `claude-opus-4-6`、`kimi-k2.5`
- **Base URL** — API 地址，比如 `https://api.anthropic.com`、`https://api.kimi.com/coding/`
- **Auth Token** — 你的 API Key 或认证令牌
- **Custom Env Vars** — 需要额外的环境变量？点"+ Add Variable"添加

填完点 **Create**，搞定。

### 第二步：打开内嵌终端

在侧边栏单击选中一个配置，然后：

- 点击配置上的 **Terminal** 按钮，或
- 按 `Cmd+T`

一个新的终端标签页就会打开，所有配置里的环境变量已经注入好了。直接输入 `claude` 就能用对应的模型。

想验证一下？跑这个命令：

```bash
env | grep ANTHROPIC
```

### 第三步：打开系统终端

点击配置上的 **System** 按钮，macOS 的 Terminal.app 会打开一个新窗口，环境变量已经加载好了。你会看到确认信息：

```
[MultiClaude] Config loaded: Kimi K2.5
```

### 第四步：管理多个终端

- **切换标签页**：点击标签，或 `Cmd+Shift+]` / `Cmd+Shift+[`
- **跳到第 N 个标签页**：`Cmd+1` 到 `Cmd+9`
- **关闭标签页**：点标签上的 X，或 `Cmd+W`
- **清屏**：`Cmd+K`

### 第五步：导入/导出配置

- **导出**：菜单 > Config > Export Configs — 把所有配置保存为 JSON 文件
- **导入**：菜单 > Config > Import Configs — 从 JSON 文件加载配置，名称冲突会自动重命名

**注意**：导出的文件里包含明文的 Auth Token，请妥善保管。

---

## 快捷键速查

| 快捷键                | 功能                       |
| --------------------- | -------------------------- |
| `Cmd+T`             | 为选中配置打开新的内嵌终端 |
| `Cmd+Shift+T`       | 为选中配置打开新的系统终端 |
| `Cmd+W`             | 关闭当前终端标签页         |
| `Cmd+N`             | 新建配置                   |
| `Cmd+E`             | 编辑选中的配置             |
| `Cmd+D`             | 复制选中的配置             |
| `Cmd+K`             | 清屏                       |
| `Cmd+B`             | 切换侧边栏显示/隐藏        |
| `Cmd+Shift+]`       | 下一个标签页               |
| `Cmd+Shift+[`       | 上一个标签页               |
| `Cmd+1`..`Cmd+9`  | 跳到第 N 个标签页          |
| `Cmd+=` / `Cmd+-` | 放大 / 缩小                |
| `Cmd+0`             | 重置缩放                   |

### 右键菜单

在终端里右键可以：

- 复制 / 粘贴 / 全选
- 清屏
- 用当前配置打开系统终端

---

## 技术栈

| 组件     | 技术选型                                         |
| -------- | ------------------------------------------------ |
| 框架     | Electron 34                                      |
| 语言     | TypeScript 5.7                                   |
| 终端     | @xterm/xterm 5.5 + 插件（fit、webgl、web-links） |
| PTY      | node-pty                                         |
| 打包工具 | esbuild                                          |
| 分发打包 | electron-builder                                 |
| UI       | 原生 TypeScript（无框架依赖）                    |

---

## 本地开发

```bash
# 安装依赖
pnpm install

# 构建
node scripts/build.js

# 开发模式运行
npx electron .

# 构建可分发版本
pnpm run dist:mac
```

---

## 许可证

MIT
