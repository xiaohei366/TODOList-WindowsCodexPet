# TODOList Windows Codex Pet

[中文文档](README.md)

Windows desktop pet TODO manager built with Electron, React, and TypeScript. It keeps TODO data in a readable Markdown file and reuses Codex-compatible pet packages from the local Codex pet ecosystem.

## Features

- Transparent always-on-top Windows desktop pet.
- Codex pet package compatibility: `pet.json` plus `spritesheet.webp`.
- Automatic pet discovery from `%USERPROFILE%\.codex\pets`.
- App pet discovery from `%APPDATA%\TOList\pets`.
- npm-installed pet package discovery from `%APPDATA%\TOList\pet-packages`.
- Markdown-backed TODO storage at `%USERPROFILE%\Documents\TOList\todos.md`.
- Human-readable TODO hierarchy: year, month, day.
- Floating TODO panel above the pet, with up to three visible items and scroll support.
- Motivational TODO header that rotates between "X tasks completed today" and "N tasks still due today" every few seconds. The completed count covers today's finished parent TODOs and sub-tasks. The remaining count works as follows: when a parent TODO is not yet completed and has a deadline on or before today, it counts as 1 plus all of its incomplete sub-tasks; otherwise the parent is not counted, and its sub-tasks are judged independently by their own deadline (only incomplete sub-tasks with a deadline on or before today are counted). Items without a deadline are not counted.
- Automatic local-day refresh so yesterday's completed items disappear from the visible TODO panel after midnight.
- Scheduled TODO rules for weekly recurring tasks and one-time future tasks.
- Scheduled reminders reuse the scheduled TODO form, create a TODO when due, automatically enter its focus mode, and send a native Windows notification. If another task is already focused, the reminder queues up and enters focus once the current one exits or completes.
- Scheduled rules are stored at `%APPDATA%\TOList\scheduled-todos.json`.
- Switchable Chinese / English native menus and TODO panels from the pet right-click menu.
- Hover the pet's bottom-right corner to reveal a resize handle; drag it to scale the pet and TODO panel between 65% and 200%.
- Visible system tray icon with show/hide, open raw data file, and quick quit actions in the selected language.
- Right-click pet actions include a `Scheduled` parent menu with separate `Scheduled TODOs` and `Scheduled Reminders` panels, plus showing or hiding panels, switching language, importing/exporting data, importing pet zip packages, refreshing pets, switching pet styles, and quitting.
- Right-click TODO actions use a native menu for editing, marking done, deleting, toggling the `[!]` red marker, adding/removing tags, adding notes/deadlines/sub-tasks, and moving priority up or down.
- Tagged TODOs are grouped in Chrome/Edge-like colored tag groups that can be collapsed, expanded, and reordered against untagged TODOs. The tag editor offers a dropdown of existing tags from unfinished TODOs while still allowing custom tags.
- Sub-tasks are stored under parent TODOs, can be collapsed with their parent, and must all be completed before the parent TODO can be marked done.
- Long-press TODO sorting is supported for direct drag ordering; tagged TODOs reorder within their tag group, while tag groups and untagged TODOs reorder at the same top level.
- Completed TODOs are rendered with strikethrough and moved to the end of the day.
- Pet state changes based on TODO state: `review` for active TODOs, `idle` when clear, `waving` on hover or after adding, and directional running while dragging.
- Pet animations use Codex-compatible rows and frames with a calmer desktop playback cadence.

## Requirements

- Windows 10 or newer.
- Node.js 24+ recommended.
- npm 11+ recommended.

## Tech Stack

- Desktop runtime: Electron 39 with transparent frameless Windows `BrowserWindow`, native tray menus, IPC, and Windows topmost/mouse-passthrough integration.
- UI: React 19, TypeScript, CSS, and `lucide-react` icons.
- Build tooling: Electron Vite, Vite, TypeScript compiler, and electron-builder portable Windows packaging.
- Persistence: local Markdown for TODO data, JSON for scheduled TODO rules and app settings.
- Pet compatibility: Codex-style `pet.json` plus `spritesheet.webp` atlas loading, zip import via JSZip, and custom `todolist-pet://` asset protocol.
- Testing: Vitest unit tests for Markdown storage, scheduling, pet registry, ordering, localization, window behavior, and animation helpers.

## Development

Install dependencies:

```powershell
npm install
```

Run the app in development mode:

```powershell
npm run dev
```

Run tests:

```powershell
npm test
```

Run TypeScript checking:

```powershell
npm run typecheck
```

Build a portable Windows executable:

```powershell
npm run build
```

The portable executable is generated at:

```text
release/TOList-Desktop-Pet-0.4.0.exe
```

## Markdown TODO Format

The default source file is:

```powershell
%USERPROFILE%\Documents\TOList\todos.md
```

The app stores TODOs in this format:

```markdown
# 2026

## 2026-05

### 2026-05-11 Monday

- [ ] [!] Important item
- [ ] [order:1] [tag:Work] [ddl:2026-05-12] Display-priority item
  - [ ] Sub-task item
  - Inline note text
- [ ] Normal item
- [x] [done:2026-05-11] ~~Finished item~~
```

Rules:

- `#` headings are years.
- `##` headings are months in `YYYY-MM`.
- `###` headings are days in `YYYY-MM-DD Weekday`.
- `[!]` marks a TODO as red/high priority.
- `[order:n]` stores display priority for active visible TODOs, including cross-date ordering between overdue and today.
- `[tag:name]` assigns a parent TODO to a single tag group. Tag groups are displayed as colored collapsible groups and can be reordered against untagged TODOs.
- `[ddl:YYYY-MM-DD]` stores a deadline for a parent TODO or sub-task.
- `[done:YYYY-MM-DD]` records the local date when a TODO was completed, so legacy TODOs finished today count toward today's completed total.
- Indented checkbox lines such as `  - [ ] Sub-task item` are sub-tasks of the parent TODO.
- Indented plain lines such as `  - Inline note text` are notes for the parent TODO.
- Completed items use `[x]` and strikethrough.
- Deleting a TODO removes its Markdown line.

## Scheduling

Right-click the pet and open `Scheduled`, then choose `Scheduled TODOs` or `Scheduled Reminders`. Both use the same weekly/one-time rule form.

- Weekly rules can run on selected weekdays at a required hour and minute.
- One-time rules can run on a specific future date at a required hour and minute, then remove themselves after generating the TODO.
- A scheduled TODO creates the TODO in the background. A scheduled reminder also opens that TODO in focus mode and sends a native Windows notification; clicking the notification returns to the focused TODO. If a reminder fires while another task is focused, it queues and automatically enters focus after the current one exits or completes; the focus panel shows how many tasks are queued.
- New schedule forms default to the local date and time when the panel is opened.
- Hours are limited to `0-23`, minutes to `0-59`, and dates must be real calendar dates such as February 28 or February 29 in leap years.
- Weekdays are shown as numbers `1-7` in the compact picker.
- Missed runs are only backfilled for today. Older missed days are not created.
- Each rule creates at most one TODO per local day.
- Optional "Set deadline": when checked, enter N (1-9999); the generated TODO is due on the Nth day, counting the firing day as day 1 (N=1 means due today).
- Use the pet menu to export or import both `todos.md` and `scheduled-todos.json` when moving to another Windows environment.

## Pet Package Format

A compatible pet folder contains:

```text
pet.json
spritesheet.webp
```

Example `pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A short human-readable description.",
  "spritesheetPath": "spritesheet.webp",
  "kind": "person"
}
```

Spritesheet requirements:

- Atlas size: `1536x1872`.
- Layout: `8` columns by `9` rows.
- Cell size: `192x208`.
- State row order:
  - `idle`
  - `running-right`
  - `running-left`
  - `waving`
  - `jumping`
  - `failed`
  - `waiting`
  - `running`
  - `review`

More installation details are in [docs/pet-pack-installation.md](docs/pet-pack-installation.md).

## Installing Pet Packs

Install from npm:

```powershell
npm install <pet-package> --prefix "$env:APPDATA\TOList\pet-packages"
```

Then right-click the pet and choose `刷新宠物`.

Install from a local zip:

1. Create a zip containing `pet.json` and `spritesheet.webp`.
2. Right-click the pet.
3. Choose `导入宠物 Zip`.

Reuse existing Codex pets by placing them under:

```powershell
%USERPROFILE%\.codex\pets
```

## Project Structure

```text
src/main/             Electron main process, Markdown storage, scheduled TODOs, pet registry
src/preload/          Safe IPC bridge exposed to the renderer
src/renderer/         React desktop pet UI
src/shared/           Shared types
tests/                Vitest coverage for TODO storage, scheduled TODOs, pet registry, animation helpers
docs/                 Pet package installation documentation
```

## Current Scope

This is a local-first Windows desktop app. It does not include account sync, cloud storage, push notifications, or an emotional/personality system.
