import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  screen,
  shell,
  Tray
} from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TodoMarkdownStore } from './todoStore';
import { PetRegistry } from './petRegistry';
import { getAppPaths } from './paths';
import { AppSettingsStore } from './appSettings';
import { getNextScheduledRunDate, runDueScheduledTodos, ScheduledTodoStore } from './scheduledTodos';
import { startAiApiServer, type AiApiServer } from './aiApi';
import { keepPetWindowOnTop, setPetWindowMousePassthrough } from './windowLayering';
import { constrainWindowPosition, getWindowDragPosition, type Position, type Rect } from './windowBounds';
import type { ImportResult, PetPackage, ScheduledTodoInput, ScheduleTarget, TodoItem, TodoMenuAction, SubTaskMenuAction, TodoSubTask } from '../shared/types';
import { type AppLanguage, type I18nKey, defaultLanguage, languageOptions, normalizeLanguage, t } from '../shared/i18n';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'todolist-pet',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let todoWatch: FSWatcher | undefined;
let todoStore: TodoMarkdownStore;
let scheduledTodoStore: ScheduledTodoStore;
let settingsStore: AppSettingsStore;
let scheduledTodoTimer: NodeJS.Timeout | undefined;
let aiApiServer: AiApiServer | null = null;
let petRegistry: PetRegistry;
let currentLanguage: AppLanguage = defaultLanguage;
let rendererReady = false;
let pendingReminderQueue: { id: string; force: boolean }[] = [];
const activeReminderNotifications = new Set<Notification>();
const windowDragSessions = new WeakMap<BrowserWindow, { startBounds: Rect; startPointer: Position }>();

const currentDir = dirname(fileURLToPath(import.meta.url));

function getBundledAssetPath(fileName: string): string {
  return join(currentDir, '../../build', fileName);
}

function createWindow(): void {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 680,
    height: 720,
    minWidth: 680,
    minHeight: 720,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: getBundledAssetPath('icon.png'),
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  keepPetWindowOnTop(mainWindow);
  setPetWindowMousePassthrough(mainWindow, true);

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    rendererReady = false;
    mainWindow = undefined;
  });
  mainWindow.on('show', () => {
    if (mainWindow) {
      keepPetWindowOnTop(mainWindow);
    }
  });
  mainWindow.on('restore', () => {
    if (mainWindow) {
      keepPetWindowOnTop(mainWindow);
    }
  });
}

function createTrayIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(getBundledAssetPath('icon.png')).resize({ width: 16, height: 16 });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('TOList Desktop Pet');
  tray.on('double-click', () => toggleMainWindow());
  updateTrayMenu();
}

function tr(key: I18nKey, values?: Record<string, string | number>): string {
  return t(currentLanguage, key, values);
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: tr('menu.showHide'),
        click: () => toggleMainWindow()
      },
      {
        label: tr('menu.openTodoMarkdown'),
        click: async () => {
          await openTodoSource();
        }
      },
      { type: 'separator' },
      {
        label: tr('menu.quitApp'),
        click: () => app.quit()
      }
    ])
  );
}

async function setAppLanguage(language: AppLanguage): Promise<AppLanguage> {
  currentLanguage = normalizeLanguage(language);
  await settingsStore.setLanguage(currentLanguage);
  updateTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:languageChanged', currentLanguage);
  }
  return currentLanguage;
}

function toggleMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }
  mainWindow.show();
  keepPetWindowOnTop(mainWindow);
}

async function startTodoWatch(): Promise<void> {
  todoWatch?.close();
  const filePath = await todoStore.openPath();
  let timer: NodeJS.Timeout | undefined;
  todoWatch = watch(filePath, { persistent: false }, () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void sendTodosChanged();
    }, 100);
  });
}

async function sendTodosChanged(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('todos:changed', await todoStore.list());
}

async function sendPetsChanged(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('pets:changed', await listPetsWithUrls());
}

async function sendSchedulesChanged(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('schedules:changed', await scheduledTodoStore.list());
}

function sendPendingReminderFocus(): void {
  if (pendingReminderQueue.length === 0 || !rendererReady || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  for (const item of pendingReminderQueue) {
    mainWindow.webContents.send('ui:enterTodoFocus', item);
  }
  pendingReminderQueue = [];
}

function focusReminderTodo(todoId: string, force = false): void {
  pendingReminderQueue.push({ id: todoId, force });
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  keepPetWindowOnTop(mainWindow);
  sendPendingReminderFocus();
}

function showScheduledReminder(todo: TodoItem): void {
  focusReminderTodo(todo.id);
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: tr('reminder.notificationTitle'),
    body: todo.text,
    icon: getBundledAssetPath('icon.png')
  });
  activeReminderNotifications.add(notification);
  const release = (): void => {
    activeReminderNotifications.delete(notification);
  };
  notification.once('close', release);
  notification.once('failed', release);
  notification.on('click', () => focusReminderTodo(todo.id, true));
  notification.show();
}

async function openTodoSource(): Promise<void> {
  const filePath = await todoStore.openPath();
  await shell.openPath(filePath);
}

async function exportDataZip(): Promise<void> {
  const result = await dialog.showSaveDialog({
    title: tr('dialog.exportDataZip'),
    defaultPath: 'tolist-data.zip',
    filters: [{ name: tr('dialog.zipFiles'), extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePath) {
    return;
  }

  const zip = new JSZip();
  const todoContent = await todoStore.readSourceContent();
  zip.file('todos.md', todoContent);
  const scheduleContent = await scheduledTodoStore.readSourceContent();
  zip.file('scheduled-todos.json', scheduleContent);

  const blob = await zip.generateAsync({ type: 'nodebuffer' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(result.filePath, blob);
}

const ALLOWED_ARCHIVE_ENTRIES = new Set(['todos.md', 'scheduled-todos.json']);

async function importDataZip(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: tr('dialog.importDataZip'),
    filters: [{ name: tr('dialog.zipFiles'), extensions: ['zip'] }],
    properties: ['openFile']
  });
  const selectedPath = result.filePaths[0];
  if (!selectedPath) {
    return;
  }

  const { readFile } = await import('node:fs/promises');
  const data = await readFile(selectedPath);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    await showImportError(tr('dialog.importInvalidContent'));
    return;
  }

  // Validate: only allowed entries
  const entryNames = Object.keys(zip.files);
  for (const name of entryNames) {
    if (zip.files[name].dir) continue;
    if (!ALLOWED_ARCHIVE_ENTRIES.has(name)) {
      await showImportError(tr('dialog.importInvalidFile'));
      return;
    }
  }

  const hasTodo = entryNames.includes('todos.md');
  const hasSchedule = entryNames.includes('scheduled-todos.json');
  if (!hasTodo && !hasSchedule) {
    await showImportError(tr('dialog.importEmptyArchive'));
    return;
  }

  let todoAdded = 0;
  let todoSkipped = 0;
  let scheduleAdded = 0;
  let scheduleUpdated = 0;
  let scheduleSkipped = 0;

  if (hasTodo) {
    const content = await zip.file('todos.md')!.async('string');
    if (!/^###\s+\d{4}-\d{2}-\d{2}/m.test(content) && !/^\s*-\s+\[[ xX]\]\s+/m.test(content)) {
      await showImportError(tr('dialog.importInvalidContent'));
      return;
    }
    const imported = await todoStore.importMarkdownFromContent(content);
    todoAdded = imported.added;
    todoSkipped = imported.skipped;
    await sendTodosChanged();
  }

  if (hasSchedule) {
    const content = await zip.file('scheduled-todos.json')!.async('string');
    try {
      JSON.parse(content);
    } catch {
      await showImportError(tr('dialog.importInvalidContent'));
      return;
    }
    const imported = await scheduledTodoStore.importJsonFromContent(content);
    scheduleAdded = imported.added;
    scheduleUpdated = imported.updated ?? 0;
    scheduleSkipped = imported.skipped;
    await afterScheduleMutation(true);
  }
}

async function showImportError(message: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: tr('dialog.importDataZip'),
    message,
    buttons: ['OK']
  });
}

async function importPetZip(zipPath?: string): Promise<PetPackage | undefined> {
  let selectedPath = zipPath;
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({
      title: tr('dialog.importCodexPetZip'),
      filters: [{ name: tr('dialog.zipFiles'), extensions: ['zip'] }],
      properties: ['openFile']
    });
    selectedPath = result.filePaths[0];
  }
  if (!selectedPath) {
    return undefined;
  }
  const pet = await petRegistry.importZip(selectedPath);
  await sendPetsChanged();
  return { ...pet, spritesheetUrl: `todolist-pet://${encodeURIComponent(pet.id)}/spritesheet.webp` };
}

async function listPetsWithUrls(): Promise<PetPackage[]> {
  return (await petRegistry.list()).map((pet) => ({
    ...pet,
    spritesheetUrl: `todolist-pet://${encodeURIComponent(pet.id)}/spritesheet.webp`
  }));
}

async function showPetMenu(point?: { x: number; y: number }): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const pets = await listPetsWithUrls();
  const selectedPetId = await mainWindow.webContents.executeJavaScript(
    "localStorage.getItem('tolist:selected-pet')",
    true
  ) as string | null;
  const petItems: Electron.MenuItemConstructorOptions[] =
    pets.length > 0
      ? pets.map((pet) => ({
          label: pet.displayName,
          type: 'radio',
          checked: selectedPetId === pet.id,
          click: () => mainWindow?.webContents.send('ui:selectPet', pet.id)
        }))
      : [{ label: tr('menu.noPetsFound'), enabled: false }];
  const menu = Menu.buildFromTemplate([
    {
      label: tr('menu.showHideTodoPanel'),
      click: () => mainWindow?.webContents.send('ui:toggleTodoPanel')
    },
    {
      label: tr('menu.schedules'),
      submenu: [
        {
          label: tr('menu.scheduledTodos'),
          click: () => mainWindow?.webContents.send('ui:toggleSchedulePanel', 'todo' satisfies ScheduleTarget)
        },
        {
          label: tr('menu.scheduledReminders'),
          click: () => mainWindow?.webContents.send('ui:toggleSchedulePanel', 'reminder' satisfies ScheduleTarget)
        }
      ]
    },
    {
      label: tr('menu.language'),
      submenu: languageOptions.map((option) => ({
        label: option.label,
        type: 'radio',
        checked: currentLanguage === option.language,
        click: async () => {
          await setAppLanguage(option.language);
        }
      }))
    },
    { type: 'separator' },
    {
      label: tr('menu.openMarkdown'),
      click: async () => {
        await openTodoSource();
      }
    },
    {
      label: tr('menu.exportData'),
      click: async () => {
        await exportDataZip();
      }
    },
    {
      label: tr('menu.importData'),
      click: async () => {
        await importDataZip();
      }
    },
    { type: 'separator' },
    {
      label: tr('menu.switchPet'),
      submenu: petItems
    },
    { type: 'separator' },
    {
      label: tr('menu.importPetZip'),
      click: async () => {
        await importPetZip();
      }
    },
    {
      label: tr('menu.refreshPets'),
      click: async () => {
        await sendPetsChanged();
      }
    },
    { type: 'separator' },
    {
      label: tr('menu.quit'),
      click: () => app.quit()
    }
  ]);

  menu.popup({ window: mainWindow, x: point?.x, y: point?.y });
}

function sendTodoMenuAction(action: TodoMenuAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('ui:todoAction', action);
}

function showTodoMenu(payload: { point?: { x: number; y: number }; item: TodoItem }): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { item, point } = payload;
  const menu = Menu.buildFromTemplate([
    {
      label: tr('menu.edit'),
      click: () => sendTodoMenuAction({ type: 'edit', id: item.id })
    },
    {
      label: tr('focus.enter'),
      click: () => sendTodoMenuAction({ type: 'enter-focus', id: item.id })
    },
    { type: 'separator' },
    {
      label: item.completed ? tr('menu.markActive') : tr('menu.markDone'),
      click: () => sendTodoMenuAction({ type: 'toggle-completed', id: item.id })
    },
    {
      label: item.deadline ? tr('menu.changeDeadline') : tr('menu.setDeadline'),
      click: () => sendTodoMenuAction({ type: 'set-deadline', id: item.id })
    },
    {
      label: item.highlighted ? tr('menu.unmarkRed') : tr('menu.markRed'),
      click: () => sendTodoMenuAction({ type: 'toggle-highlighted', id: item.id })
    },
    {
      label: tr('menu.adjustPriority'),
      enabled: !item.completed,
      submenu: [
        {
          label: tr('menu.moveUp'),
          click: () => sendTodoMenuAction({ type: 'move-up', id: item.id })
        },
        {
          label: tr('menu.moveDown'),
          click: () => sendTodoMenuAction({ type: 'move-down', id: item.id })
        }
      ]
    },
    { type: 'separator' },
    {
      label: tr('menu.editNotes'),
      click: () => sendTodoMenuAction({ type: 'edit-notes', id: item.id })
    },
    {
      label: tr('menu.editTag'),
      click: () => sendTodoMenuAction({ type: 'edit-tag', id: item.id })
    },
    {
      label: tr('menu.addSubTask'),
      click: () => sendTodoMenuAction({ type: 'add-sub-task', id: item.id })
    },
    { type: 'separator' },
    {
      label: tr('menu.delete'),
      click: () => sendTodoMenuAction({ type: 'delete', id: item.id })
    }
  ]);

  menu.popup({ window: mainWindow, x: point?.x, y: point?.y });
}

function sendSubTaskMenuAction(action: SubTaskMenuAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('ui:subTaskAction', action);
}

function showSubTaskMenu(payload: { point?: { x: number; y: number }; parentId: string; subTask: TodoSubTask }): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { parentId, subTask, point } = payload;
  const menu = Menu.buildFromTemplate([
    {
      label: tr('menu.edit'),
      click: () => sendSubTaskMenuAction({ type: 'edit', parentId, subTaskId: subTask.id })
    },
    {
      label: tr('focus.enter'),
      click: () => sendSubTaskMenuAction({ type: 'enter-focus', parentId, subTaskId: subTask.id })
    },
    { type: 'separator' },
    {
      label: subTask.completed ? tr('menu.markActive') : tr('menu.markDone'),
      click: () => sendSubTaskMenuAction({ type: 'toggle-completed', parentId, subTaskId: subTask.id })
    },
    {
      label: subTask.deadline ? tr('menu.changeDeadline') : tr('menu.setDeadline'),
      click: () => sendSubTaskMenuAction({ type: 'set-deadline', parentId, subTaskId: subTask.id })
    },
    {
      label: tr('menu.adjustPriority'),
      enabled: !subTask.completed,
      submenu: [
        {
          label: tr('menu.moveUp'),
          click: () => sendSubTaskMenuAction({ type: 'move-up', parentId, subTaskId: subTask.id })
        },
        {
          label: tr('menu.moveDown'),
          click: () => sendSubTaskMenuAction({ type: 'move-down', parentId, subTaskId: subTask.id })
        }
      ]
    },
    { type: 'separator' },
    {
      label: tr('menu.delete'),
      click: () => sendSubTaskMenuAction({ type: 'delete', parentId, subTaskId: subTask.id })
    }
  ]);

  menu.popup({ window: mainWindow, x: point?.x, y: point?.y });
}

function registerPetProtocol(): void {
  protocol.handle('todolist-pet', async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname);
    const pet = await petRegistry.findById(id);
    if (!pet) {
      return new Response('Pet not found.', { status: 404 });
    }
    return net.fetch(pathToFileURL(pet.spritesheetPath).toString());
  });
}

function registerIpc(): void {
  ipcMain.handle('todos:list', async () => todoStore.list());
  ipcMain.handle('todos:add', async (_event, text: string) => {
    const item = await todoStore.add(text);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:delete', async (_event, id: string) => {
    await todoStore.delete(id);
    await sendTodosChanged();
  });
  ipcMain.handle('todos:setCompleted', async (_event, id: string, completed: boolean) => {
    const item = await todoStore.setCompleted(id, completed);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:setHighlighted', async (_event, id: string, highlighted: boolean) => {
    const item = await todoStore.setHighlighted(id, highlighted);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:updateText', async (_event, id: string, text: string) => {
    const item = await todoStore.updateText(id, text);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:updateNotes', async (_event, id: string, notes: string) => {
    const item = await todoStore.updateNotes(id, notes);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:setDeadline', async (_event, id: string, deadline: string | undefined) => {
    const item = await todoStore.setDeadline(id, deadline);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:updateTag', async (_event, id: string, tag: string | undefined) => {
    const item = await todoStore.updateTag(id, tag);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:addSubTask', async (_event, parentId: string, text: string) => {
    const item = await todoStore.addSubTask(parentId, text);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:updateSubTask', async (_event, parentId: string, subTaskId: string, text: string) => {
    const item = await todoStore.updateSubTask(parentId, subTaskId, text);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:setSubTaskCompleted', async (_event, parentId: string, subTaskId: string, completed: boolean) => {
    const item = await todoStore.setSubTaskCompleted(parentId, subTaskId, completed);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:setSubTaskDeadline', async (_event, parentId: string, subTaskId: string, deadline: string | undefined) => {
    const item = await todoStore.setSubTaskDeadline(parentId, subTaskId, deadline);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:deleteSubTask', async (_event, parentId: string, subTaskId: string) => {
    const item = await todoStore.deleteSubTask(parentId, subTaskId);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:moveSubTask', async (_event, parentId: string, subTaskId: string, direction: 'up' | 'down') => {
    const item = await todoStore.moveSubTask(parentId, subTaskId, direction);
    await sendTodosChanged();
    return item;
  });
  ipcMain.handle('todos:reorderSubTasks', async (_event, parentId: string, ids: string[]) => {
    const items = await todoStore.reorderSubTasks(parentId, ids);
    await sendTodosChanged();
    return items;
  });
  ipcMain.handle('ui:showSubTaskMenu', async (_event, payload: { point: { x: number; y: number }; parentId: string; subTask: TodoSubTask }) => {
    showSubTaskMenu(payload);
  });
  ipcMain.handle('todos:reorder', async (_event, date: string, ids: string[]) => {
    const items = await todoStore.reorder(date, ids);
    await sendTodosChanged();
    return items;
  });
  ipcMain.handle('todos:reorderVisible', async (_event, ids: string[]) => {
    const items = await todoStore.reorderVisible(ids);
    await sendTodosChanged();
    return items;
  });
  ipcMain.handle('todos:openSource', async () => {
    await openTodoSource();
  });

  ipcMain.handle('schedules:list', async () => scheduledTodoStore.list());
  ipcMain.handle('schedules:create', async (_event, input: ScheduledTodoInput) => {
    const rule = await scheduledTodoStore.create(input);
    await afterScheduleMutation(true);
    return rule;
  });
  ipcMain.handle('schedules:update', async (_event, id: string, input: ScheduledTodoInput) => {
    const rule = await scheduledTodoStore.update(id, input);
    await afterScheduleMutation(true);
    return rule;
  });
  ipcMain.handle('schedules:delete', async (_event, id: string) => {
    await scheduledTodoStore.delete(id);
    await afterScheduleMutation(false);
  });
  ipcMain.handle('schedules:setEnabled', async (_event, id: string, enabled: boolean) => {
    const rule = await scheduledTodoStore.setEnabled(id, enabled);
    await afterScheduleMutation(true);
    return rule;
  });
  ipcMain.handle('ui:rendererReady', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      return;
    }
    rendererReady = true;
    sendPendingReminderFocus();
  });
  ipcMain.handle('settings:getLanguage', () => currentLanguage);
  ipcMain.handle('settings:setLanguage', async (_event, language: AppLanguage) => setAppLanguage(language));

  ipcMain.handle('pets:list', async () => listPetsWithUrls());
  ipcMain.handle('pets:select', async (_event, id: string) => petRegistry.findById(id));
  ipcMain.handle('pets:reload', async () => {
    const pets = await listPetsWithUrls();
    await sendPetsChanged();
    return pets;
  });
  ipcMain.handle('pets:importZip', async (_event, zipPath?: string) => {
    return importPetZip(zipPath);
  });
  ipcMain.handle('ui:showPetMenu', async (_event, point?: { x: number; y: number }) => showPetMenu(point));
  ipcMain.handle('ui:showTodoMenu', (_event, payload: { point?: { x: number; y: number }; item: TodoItem }) =>
    showTodoMenu(payload)
  );

  ipcMain.handle('window:moveBy', (event, deltaX: number, deltaY: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    const bounds = window.getBounds();
    const proposed = {
      x: Math.round(bounds.x + deltaX),
      y: Math.round(bounds.y + deltaY)
    };
    const display = screen.getDisplayMatching({ ...bounds, ...proposed });
    const next = constrainWindowPosition(proposed, bounds, display.workArea);
    window.setPosition(next.x, next.y, false);
    keepPetWindowOnTop(window);
  });
  ipcMain.on('window:dragStart', (event, screenX: number, screenY: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    windowDragSessions.set(window, {
      startBounds: window.getBounds(),
      startPointer: { x: screenX, y: screenY }
    });
    keepPetWindowOnTop(window);
  });
  ipcMain.on('window:dragMove', (event, screenX: number, screenY: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    const drag = windowDragSessions.get(window);
    if (!drag) {
      return;
    }
    const proposed = getWindowDragPosition(drag.startBounds, drag.startPointer, { x: screenX, y: screenY });
    const display = screen.getDisplayMatching({ ...drag.startBounds, ...proposed });
    const next = constrainWindowPosition(proposed, drag.startBounds, display.workArea);
    window.setPosition(next.x, next.y, false);
  });
  ipcMain.on('window:dragEnd', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    windowDragSessions.delete(window);
    keepPetWindowOnTop(window);
  });
  ipcMain.handle('window:setMousePassthrough', (event, ignore: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    setPetWindowMousePassthrough(window, ignore);
  });
  ipcMain.handle('window:quit', () => app.quit());
}

async function runScheduledTodoCheck(): Promise<void> {
  const reminders: TodoItem[] = [];
  const generated = await runDueScheduledTodos(
    scheduledTodoStore,
    todoStore,
    new Date(),
    (rule, todo) => {
      if (rule.target === 'reminder') {
        reminders.push(todo as TodoItem);
      }
    }
  );
  if (generated > 0) {
    await sendTodosChanged();
  }
  reminders.forEach(showScheduledReminder);
  await sendSchedulesChanged();
}

async function handleScheduledTodoTimer(): Promise<void> {
  try {
    await runScheduledTodoCheck();
  } finally {
    await refreshScheduledTodoTimer();
  }
}

async function afterScheduleMutation(runDueNow: boolean): Promise<void> {
  if (runDueNow) {
    await runScheduledTodoCheck();
  } else {
    await sendSchedulesChanged();
  }
  await refreshScheduledTodoTimer();
}

async function refreshScheduledTodoTimer(): Promise<void> {
  if (scheduledTodoTimer) {
    clearTimeout(scheduledTodoTimer);
    scheduledTodoTimer = undefined;
  }

  const nextRun = getNextScheduledRunDate(await scheduledTodoStore.list());
  if (!nextRun) {
    return;
  }

  const delay = Math.max(1000, nextRun.getTime() - Date.now() + 1000);
  scheduledTodoTimer = setTimeout(() => {
    void handleScheduledTodoTimer();
  }, Math.min(delay, 2_147_483_647));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
app.setAppUserModelId('local.todolist.desktoppet');
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  // 用户再次启动便携包时，聚焦已有窗口而非启动第二个实例
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  keepPetWindowOnTop(mainWindow);
});

// 只有拿到单实例锁的实例才执行启动流程；锁失败的实例在上方已 app.quit()，
// 但 quit 不会取消已注册的 whenReady 回调，必须在这里显式拦住，
// 否则第二个实例会照常跑启动逻辑（如重写 AI API 发现文件）再退出。
if (gotSingleInstanceLock) app.whenReady().then(async () => {
  const paths = getAppPaths();
  todoStore = new TodoMarkdownStore(paths.todoFile);
  scheduledTodoStore = new ScheduledTodoStore(paths.scheduledTodosFile);
  settingsStore = new AppSettingsStore(paths.settingsFile);
  currentLanguage = await settingsStore.getLanguage();
  petRegistry = new PetRegistry({
    codexPets: paths.codexPets,
    appPets: paths.appPets,
    packageRoot: paths.packageRoot
  });

  registerPetProtocol();
  registerIpc();
  try {
    aiApiServer = await startAiApiServer({
      todoStore,
      scheduleStore: scheduledTodoStore,
      onTodosChanged: sendTodosChanged,
      onSchedulesChanged: afterScheduleMutation,
      infoFile: paths.aiApiInfoFile
    });
  } catch (error) {
    console.error('AI API 启动失败：', error);
  }
  createWindow();
  createTray();
  await startTodoWatch();
  await runScheduledTodoCheck();
  await refreshScheduledTodoTimer();
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  void aiApiServer?.close();
  todoWatch?.close();
  if (scheduledTodoTimer) {
    clearTimeout(scheduledTodoTimer);
  }
});
