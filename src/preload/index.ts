import { contextBridge, ipcRenderer } from 'electron';
import type { PetPackage, ScheduledTodoInput, ScheduledTodoRule, ScheduleTarget, SubTaskMenuAction, TodoItem, TodoMenuAction, TodoSubTask } from '../shared/types';
import type { AppLanguage } from '../shared/i18n';

type Listener<T> = (payload: T) => void;

function onPayload<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('todoPet', {
  todos: {
    list: (): Promise<TodoItem[]> => ipcRenderer.invoke('todos:list'),
    add: (text: string): Promise<TodoItem> => ipcRenderer.invoke('todos:add', text),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('todos:delete', id),
    setCompleted: (id: string, completed: boolean): Promise<TodoItem> =>
      ipcRenderer.invoke('todos:setCompleted', id, completed),
    setHighlighted: (id: string, highlighted: boolean): Promise<TodoItem> =>
      ipcRenderer.invoke('todos:setHighlighted', id, highlighted),
    updateText: (id: string, text: string): Promise<TodoItem> => ipcRenderer.invoke('todos:updateText', id, text),
    updateNotes: (id: string, notes: string): Promise<TodoItem> => ipcRenderer.invoke('todos:updateNotes', id, notes),
    setDeadline: (id: string, deadline: string | undefined): Promise<TodoItem> => ipcRenderer.invoke('todos:setDeadline', id, deadline),
    updateTag: (id: string, tag: string | undefined): Promise<TodoItem> => ipcRenderer.invoke('todos:updateTag', id, tag),
    addSubTask: (parentId: string, text: string): Promise<TodoItem> => ipcRenderer.invoke('todos:addSubTask', parentId, text),
    updateSubTask: (parentId: string, subTaskId: string, text: string): Promise<TodoItem> => ipcRenderer.invoke('todos:updateSubTask', parentId, subTaskId, text),
    setSubTaskCompleted: (parentId: string, subTaskId: string, completed: boolean): Promise<TodoItem> => ipcRenderer.invoke('todos:setSubTaskCompleted', parentId, subTaskId, completed),
    setSubTaskDeadline: (parentId: string, subTaskId: string, deadline: string | undefined): Promise<TodoItem> => ipcRenderer.invoke('todos:setSubTaskDeadline', parentId, subTaskId, deadline),
    deleteSubTask: (parentId: string, subTaskId: string): Promise<TodoItem> => ipcRenderer.invoke('todos:deleteSubTask', parentId, subTaskId),
    moveSubTask: (parentId: string, subTaskId: string, direction: 'up' | 'down'): Promise<TodoItem> => ipcRenderer.invoke('todos:moveSubTask', parentId, subTaskId, direction),
    reorderSubTasks: (parentId: string, ids: string[]): Promise<TodoItem[]> => ipcRenderer.invoke('todos:reorderSubTasks', parentId, ids),
    reorder: (date: string, ids: string[]): Promise<TodoItem[]> => ipcRenderer.invoke('todos:reorder', date, ids),
    reorderVisible: (ids: string[]): Promise<TodoItem[]> => ipcRenderer.invoke('todos:reorderVisible', ids),
    openSource: (): Promise<void> => ipcRenderer.invoke('todos:openSource'),
    onChanged: (listener: Listener<TodoItem[]>): (() => void) => onPayload('todos:changed', listener)
  },
  schedules: {
    list: (): Promise<ScheduledTodoRule[]> => ipcRenderer.invoke('schedules:list'),
    create: (input: ScheduledTodoInput): Promise<ScheduledTodoRule> => ipcRenderer.invoke('schedules:create', input),
    update: (id: string, input: ScheduledTodoInput): Promise<ScheduledTodoRule> =>
      ipcRenderer.invoke('schedules:update', id, input),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('schedules:delete', id),
    setEnabled: (id: string, enabled: boolean): Promise<ScheduledTodoRule> =>
      ipcRenderer.invoke('schedules:setEnabled', id, enabled),
    onChanged: (listener: Listener<ScheduledTodoRule[]>): (() => void) => onPayload('schedules:changed', listener)
  },
  pets: {
    list: (): Promise<PetPackage[]> => ipcRenderer.invoke('pets:list'),
    select: (id: string): Promise<PetPackage | undefined> => ipcRenderer.invoke('pets:select', id),
    importZip: (path?: string): Promise<PetPackage | undefined> => ipcRenderer.invoke('pets:importZip', path),
    reload: (): Promise<PetPackage[]> => ipcRenderer.invoke('pets:reload'),
    onChanged: (listener: Listener<PetPackage[]>): (() => void) => onPayload('pets:changed', listener)
  },
  settings: {
    getLanguage: (): Promise<AppLanguage> => ipcRenderer.invoke('settings:getLanguage'),
    setLanguage: (language: AppLanguage): Promise<AppLanguage> => ipcRenderer.invoke('settings:setLanguage', language),
    onLanguageChanged: (listener: Listener<AppLanguage>): (() => void) => onPayload('settings:languageChanged', listener)
  },
  ui: {
    showPetMenu: (point: { x: number; y: number }): Promise<void> => ipcRenderer.invoke('ui:showPetMenu', point),
    showTodoMenu: (payload: { point: { x: number; y: number }; item: TodoItem }): Promise<void> =>
      ipcRenderer.invoke('ui:showTodoMenu', payload),
    showSubTaskMenu: (payload: { point: { x: number; y: number }; parentId: string; subTask: TodoSubTask }): Promise<void> =>
      ipcRenderer.invoke('ui:showSubTaskMenu', payload),
    onToggleTodoPanel: (listener: Listener<void>): (() => void) => onPayload('ui:toggleTodoPanel', listener),
    rendererReady: (): Promise<void> => ipcRenderer.invoke('ui:rendererReady'),
    onToggleSchedulePanel: (listener: Listener<ScheduleTarget>): (() => void) =>
      onPayload('ui:toggleSchedulePanel', listener),
    onEnterTodoFocus: (listener: Listener<string>): (() => void) => onPayload('ui:enterTodoFocus', listener),
    onSelectPet: (listener: Listener<string>): (() => void) => onPayload('ui:selectPet', listener),
    onTodoAction: (listener: Listener<TodoMenuAction>): (() => void) => onPayload('ui:todoAction', listener),
    onSubTaskAction: (listener: Listener<SubTaskMenuAction>): (() => void) => onPayload('ui:subTaskAction', listener)
  },
  window: {
    moveBy: (deltaX: number, deltaY: number): Promise<void> => ipcRenderer.invoke('window:moveBy', deltaX, deltaY),
    startDrag: (screenX: number, screenY: number): void => ipcRenderer.send('window:dragStart', screenX, screenY),
    moveDrag: (screenX: number, screenY: number): void => ipcRenderer.send('window:dragMove', screenX, screenY),
    endDrag: (): void => ipcRenderer.send('window:dragEnd'),
    setMousePassthrough: (ignore: boolean): Promise<void> => ipcRenderer.invoke('window:setMousePassthrough', ignore),
    quit: (): Promise<void> => ipcRenderer.invoke('window:quit')
  }
});
