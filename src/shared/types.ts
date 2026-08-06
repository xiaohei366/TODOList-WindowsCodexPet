export type TodoSubTask = {
  id: string;
  text: string;
  completed: boolean;
  completedDate?: string;
  deadline?: string;
  displayOrder?: number;
};

export type TodoItem = {
  id: string;
  date: string;
  text: string;
  completed: boolean;
  completedDate?: string;
  highlighted: boolean;
  overdue: boolean;
  displayOrder?: number;
  sourceLine: number;
  notes: string;
  deadline?: string;
  tag?: string;
  subTasks: TodoSubTask[];
};

export type TodoMenuActionType =
  | 'edit'
  | 'edit-notes'
  | 'edit-tag'
  | 'set-deadline'
  | 'add-sub-task'
  | 'toggle-completed'
  | 'toggle-highlighted'
  | 'delete'
  | 'move-up'
  | 'move-down'
  | 'enter-focus';

export type TodoMenuAction = {
  type: TodoMenuActionType;
  id: string;
};

export type SubTaskMenuActionType =
  | 'edit'
  | 'toggle-completed'
  | 'set-deadline'
  | 'delete'
  | 'move-up'
  | 'move-down'
  | 'enter-focus';

export type SubTaskMenuAction = {
  type: SubTaskMenuActionType;
  parentId: string;
  subTaskId: string;
};

export type PetSource = 'app' | 'codex' | 'npm';

export type PetPackage = {
  id: string;
  displayName: string;
  description: string;
  kind?: string;
  directory: string;
  spritesheetPath: string;
  spritesheetUrl?: string;
  source: PetSource;
};

export type PetState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export type AnimationSpec = {
  state: PetState;
  row: number;
  frameCount: number;
  durations: number[];
};

export type ScheduleKind = 'weekly' | 'one-time';
export type ScheduleTarget = 'todo' | 'reminder';

export type ScheduledTodoBase = {
  id: string;
  kind: ScheduleKind;
  target: ScheduleTarget;
  enabled: boolean;
  text: string;
  hour: number;
  minute: number;
  createdAt: string;
  updatedAt: string;
  lastGeneratedDate?: string;
  deadlineDays?: number;
};

export type WeeklyScheduledTodoRule = ScheduledTodoBase & {
  kind: 'weekly';
  weekdays: number[];
};

export type OneTimeScheduledTodoRule = ScheduledTodoBase & {
  kind: 'one-time';
  date: string;
  fired?: boolean;
};

export type ScheduledTodoRule = WeeklyScheduledTodoRule | OneTimeScheduledTodoRule;

export type ScheduledTodoInput = {
  kind: ScheduleKind;
  target?: ScheduleTarget;
  enabled?: boolean;
  text: string;
  hour?: number | null;
  minute?: number | null;
  weekdays?: number[];
  date?: string | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  deadlineDays?: number | null;
};

export type ImportResult = {
  added: number;
  updated?: number;
  skipped: number;
};
