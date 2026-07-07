# TODOList Windows Codex Pet

[English](README.en.md)

这是一个 Windows 桌宠 TODO 管理应用，基于 Electron、React 和 TypeScript 构建。它使用人类可读的 Markdown 文件保存 TODO，并兼容 Codex 桌宠资源格式和本地 Codex 宠物包生态。

## 功能

- Windows 透明置顶桌宠窗口。
- 兼容 Codex 宠物包：`pet.json` 加 `spritesheet.webp`。
- 自动读取 `%USERPROFILE%\.codex\pets` 下的 Codex 宠物。
- 自动读取 `%APPDATA%\TOList\pets` 下的应用内宠物。
- 自动读取 `%APPDATA%\TOList\pet-packages` 下通过 npm 安装的宠物包。
- TODO 默认保存到 `%USERPROFILE%\Documents\TOList\todos.md`。
- Markdown 使用年、月、日三级标题组织，适合直接手写和阅读。
- 宠物头顶显示 TODO 面板，最多可见三条，超出后在面板内滚动。
- TODO 标题栏会轮播显示激励文字，先展示“今日已完成 X 个任务”，几秒后切换为“今日仍需完成 N 个任务”。完成数统计今日完成的父 TODO 项与子任务；剩余数规则为：父 TODO 未完成且设置了截止日期且截止日期不晚于今日时，父项计 1 加上其全部未完成子任务；否则父项不计入，子任务按自身截止日期独立判断（未完成且截止日期不晚于今日才计入）；未设置截止日期的项不计入。
- 会在本地日期切换后自动刷新 TODO 面板，昨日完成项会自动从可见列表移除。
- 支持定时 TODO 规则，可创建每周重复任务和一次性未来任务。
- 定时规则保存到 `%APPDATA%\TOList\scheduled-todos.json`。
- 原生菜单和 TODO 面板支持中文 / English 切换。
- 鼠标移动到宠物右下角会显示直角缩放柄，拖动后可在 65% 到 200% 之间同步缩放宠物和 TODO 框。
- 系统托盘会显示可见图标，支持显示/隐藏窗口、打开存储数据的原始文件和快速退出。
- 右键宠物可显示或隐藏面板、切换语言、管理定时 TODO、导入/导出 TODO 项和定时任务、导入宠物 zip、刷新宠物、切换宠物样式和退出。
- 右键 TODO 使用原生菜单，可编辑、标记完成、删除、标红或取消标红、编辑标签、添加备注/截止日期/子任务，并通过 `调整优先级` 下的 `上移` 或 `下移` 调整优先级。
- 带标签的 TODO 会按 Chrome/Edge 风格的彩色标签组聚合展示，标签组可折叠、展开，并可与未打标签 TODO 同级调整顺序；编辑标签时会通过下拉框提供当前未完成 TODO 中已存在的标签供选择，同时保留自定义输入。
- 子任务保存在父 TODO 下方，可随父 TODO 折叠；父 TODO 必须等待所有子任务完成后才能标记完成。
- 长按 TODO 可直接拖拽排序；带标签 TODO 只能在标签组内排序，标签组和未打标签 TODO 在顶层同级排序。
- TODO 完成后会划线并移动到当天列表末尾。
- 宠物状态会跟随 TODO 状态切换：有未完成 TODO 时为 `review`，清空后为 `idle`，鼠标悬停或新增后短暂 `waving`，拖拽时根据方向显示 `running-left` 或 `running-right`。
- 宠物动画保持 Codex 兼容的状态行和帧数，但播放节奏更慢，更适合桌面常驻。

## 环境要求

- Windows 10 或更新版本。
- 推荐 Node.js 24+。
- 推荐 npm 11+。

## 技术栈

- 桌面运行时：Electron 39，使用透明无边框 Windows `BrowserWindow`、原生托盘菜单、IPC，以及 Windows 置顶和鼠标穿透能力。
- 前端界面：React 19、TypeScript、CSS 和 `lucide-react` 图标。
- 构建工具：Electron Vite、Vite、TypeScript 编译器，以及 electron-builder 的 Windows 便携版打包。
- 数据持久化：TODO 使用本地 Markdown，定时 TODO 规则和应用设置使用 JSON。
- 宠物兼容：读取 Codex 风格的 `pet.json` 和 `spritesheet.webp` 图集，通过 JSZip 导入 zip，并用自定义 `todolist-pet://` 协议加载资源。
- 测试：Vitest 覆盖 Markdown 存储、定时调度、宠物注册、排序、本地化、窗口行为和动画 helper。

## 开发命令

安装依赖：

```powershell
npm install
```

启动开发模式：

```powershell
npm run dev
```

运行测试：

```powershell
npm test
```

运行 TypeScript 类型检查：

```powershell
npm run typecheck
```

构建 Windows 便携版可执行文件：

```powershell
npm run build
```

构建后的便携版可执行文件位于：

```text
release/TOList-Desktop-Pet-0.4.0.exe
```

## Markdown TODO 格式

默认源文件路径：

```powershell
%USERPROFILE%\Documents\TOList\todos.md
```

应用保存格式如下：

```markdown
# 2026

## 2026-05

### 2026-05-11 Monday

- [ ] [!] Important item
- [ ] [order:1] [tag:工作] [ddl:2026-05-12] Display-priority item
  - [ ] Sub-task item
  - Inline note text
- [ ] Normal item
- [x] [done:2026-05-11] ~~Finished item~~
```

规则：

- `#` 表示年份。
- `##` 表示月份，格式为 `YYYY-MM`。
- `###` 表示日期，格式为 `YYYY-MM-DD Weekday`。
- `[!]` 表示标红或高优先级。
- `[order:n]` 表示可见 TODO 的展示优先级，可用于逾期任务和今日任务之间的跨日期排序。
- `[tag:name]` 将父 TODO 归入单个标签组；标签组会以彩色折叠分组展示，并可与未打标签 TODO 同级排序。
- `[ddl:YYYY-MM-DD]` 表示父 TODO 或子任务的截止日期。
- `[done:YYYY-MM-DD]` 表示 TODO 的本地完成日期，因此今天完成的历史遗留 TODO 也会计入今日完成数。
- 缩进 checkbox 行（如 `  - [ ] Sub-task item`）表示父 TODO 的子任务。
- 缩进纯文本行（如 `  - Inline note text`）表示父 TODO 的备注。
- 完成项使用 `[x]` 和删除线。
- 删除 TODO 会直接移除对应 Markdown 行。

## 定时 TODO

右键桌宠并选择 `定时 TODO` 可管理自动创建 TODO 的规则。

- 每周规则可选择星期，并在指定小时和分钟自动创建 TODO。
- 一次性规则可选择未来日期，并在指定小时和分钟自动创建 TODO；生成后规则会自动删除。
- 新增定时规则时，日期和时间会默认使用打开面板时的本地日期时间。
- 小时限制为 `0-23`，分钟限制为 `0-59`，日期必须是真实日历日期，例如平年 2 月 28 日、闰年 2 月 29 日。
- 紧凑星期选择器使用数字 `1-7` 显示。
- 错过的任务只补发今天已经到点的内容，不补发更早日期。
- 每条规则每天最多创建一次 TODO。
- 迁移环境时，可通过右键菜单导出或导入 `todos.md` 和 `scheduled-todos.json`。

## 宠物包格式

兼容宠物目录包含：

```text
pet.json
spritesheet.webp
```

示例 `pet.json`：

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A short human-readable description.",
  "spritesheetPath": "spritesheet.webp",
  "kind": "person"
}
```

Spritesheet 要求：

- 图集尺寸：`1536x1872`。
- 布局：`8` 列 x `9` 行。
- 单元格尺寸：`192x208`。
- 状态行顺序：
  - `idle`
  - `running-right`
  - `running-left`
  - `waving`
  - `jumping`
  - `failed`
  - `waiting`
  - `running`
  - `review`

更多安装说明见 [docs/pet-pack-installation.md](docs/pet-pack-installation.md)。

## 安装宠物包

通过 npm 安装：

```powershell
npm install <pet-package> --prefix "$env:APPDATA\TOList\pet-packages"
```

安装后右键桌宠，选择 `刷新宠物`。

通过本地 zip 安装：

1. 创建一个包含 `pet.json` 和 `spritesheet.webp` 的 zip。
2. 右键桌宠。
3. 选择 `导入宠物 Zip`。

复用已有 Codex 宠物：

```powershell
%USERPROFILE%\.codex\pets
```

## 项目结构

```text
src/main/             Electron 主进程、Markdown 存储、定时 TODO、宠物注册表
src/preload/          暴露给 renderer 的安全 IPC 桥
src/renderer/         React 桌宠界面
src/shared/           共享类型
tests/                TODO 存储、定时 TODO、宠物注册、动画 helper 的 Vitest 测试
docs/                 宠物包安装文档
```

## 当前范围

这是一个本地优先的 Windows 桌面应用。当前不包含账号同步、云存储、推送通知或情感/人格系统。
