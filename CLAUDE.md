# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
npm run dev              # Start the app in dev mode (Electron + React HMR)
npm test                 # Run all Vitest unit tests
npx vitest run tests/foo # Run a single test file
npm run typecheck        # TypeScript checking (tsc --noEmit)
npm run build            # Full build: kill-app → clean → typecheck → vite build → electron-builder portable
```

The build output is a signed portable `.exe` at `release/TOList-Desktop-Pet-0.4.0.exe`.

## Architecture

This is an **Electron 39** desktop app (frameless, transparent, always-on-top) with **React 19** rendering, built with **electron-vite**. The app manages TODOs as local Markdown files and shows a desktop pet with a floating TODO panel.

### Process model

| Process | Entry | Role |
|---|---|---|
| Main | `src/main/index.ts` | Window, tray, menus, IPC handlers, Markdown persistence, pet registry, scheduled TODOs |
| Preload | `src/preload/index.ts` | Typed IPC bridge (`window.todoPet.*`) exposed to renderer |
| Renderer | `src/renderer/src/App.tsx` | React UI: pet animation, TODO panel, schedule panel, menus |

### Data flow

- **TODO persistence**: `src/main/todoStore.ts` — reads/writes `%USERPROFILE%\Documents\TOList\todos.md` as structured Markdown (`parseTodoMarkdown` → `renderTodoMarkdown`). Changes are broadcast to the renderer via IPC (`todos:changed`).
- **Scheduled TODOs**: `src/main/scheduledTodos.ts` — JSON persistence at `%APPDATA%\TOList\scheduled-todos.json`. A timer fires at the next due time to auto-generate TODOs from weekly/one-time rules.
- **Pet registry**: `src/main/petRegistry.ts` — discovers pets from `.codex/pets`, `%APPDATA%\TOList\pets`, and npm-installed pet-packages. Serves spritesheets via a custom `todolist-pet://` protocol.
- **App settings**: `src/main/appSettings.ts` — JSON at `%APPDATA%\TOList\settings.json` (language preference).
- **AI API**: `src/main/aiApi.ts` — localhost-only (`127.0.0.1`) HTTP API for external AI tools to manage TODOs and scheduled rules. Per-startup token; discovery file at `%APPDATA%\TOList\ai-api.json`. Usage doc: `docs/ai-api/SKILL.md`.
- **IPC**: All renderer↔main communication goes through `ipcMain.handle` / `ipcRenderer.invoke`. The preload exposes typed methods under `window.todoPet.*`.
- **Single instance**: `app.requestSingleInstanceLock()` prevents duplicate processes; `second-instance` event restores the existing window.

### Key modules (renderer)

- `src/renderer/src/App.tsx` — ~60KB monolithic component: pet rendering, TODO list with tag groups/sub-tasks/drag reorder, schedule panel, inline editing, context menus via IPC.
- `src/renderer/src/todoOrdering.ts` — `buildTodoListUnits` flattens items into `tag-group | todo` units for rendering and drag reorder.
- `src/renderer/src/todoStats.ts` — `countCompletedToday` and `countRemainingToday` for the rotating header display.
- `src/renderer/src/petAnimation.ts` — sprite-sheet animation (9 states × N frames), interactive state driven by hover/drag/todo state.
- `src/shared/i18n.ts` — `t(language, key, values)` with `zh-CN`/`en-US` translations.
- `src/shared/types.ts` — `TodoItem`, `TodoSubTask`, `ScheduledTodoRule`, `PetPackage`, `PetState`, etc.

### Markdown format

```markdown
# 2026
## 2026-06
### 2026-06-23 Tuesday
- [ ] [!] [order:1] [tag:Work] [ddl:2026-06-26] Parent todo
  - [ ] [ddl:2026-06-23] Sub-task
  - Inline note
- [x] [done:2026-06-23] ~~Finished item~~
```

## Project conventions

- **Develop on `main`** — no feature branches.
- **Commit messages** — `type: 中文摘要` (e.g., `feat: 标题栏轮播显示今日仍需完成任务数`), followed by an English body paragraph with details.
- **After every feature or fix** — run `npm run build` to confirm it compiles and packages, run `npm test` for all tests, and update README.md / README.en.md if the change affects user-facing behavior.
- **Pet behavior** — mouse passthrough (`setIgnoreMouseEvents`) lets clicks through transparent areas. The pet window is always-on-top and frameless. Right-click shows a native `Menu`.
- **Sub-tasks** — rendered sorted with incomplete items first (`[...subTasks].sort((a, b) => Number(a.completed) - Number(b.completed))`). They live under a parent `TodoItem.subTasks` and are serialized as indented checkbox lines in Markdown.
