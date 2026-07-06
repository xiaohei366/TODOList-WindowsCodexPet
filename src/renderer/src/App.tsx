import { Check, ChevronDown, ChevronRight, Circle, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import React, { FormEvent, PointerEvent, ReactElement, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { PetPackage, PetState, ScheduledTodoInput, ScheduledTodoRule, SubTaskMenuAction, TodoItem, TodoMenuAction, TodoSubTask } from '../../shared/types';
import { type AppLanguage, type I18nKey, defaultLanguage, t } from '../../shared/i18n';
import { getAnimationSpec, getInteractivePetState, getPetSpriteStyle, getTodoDrivenPetState } from './petAnimation';
import { clampPetUiScale, defaultPetUiScale, getPetUiScaleFromResizeDrag } from './petScale';
import {
  buildDeadlineInput,
  buildScheduleInput,
  createDefaultScheduleForm,
  formatScheduleSummary,
  getDeadlineFormMaxDay,
  getScheduleFormMaxDay,
  scheduleRuleToForm,
  type ScheduleFormState,
  weekdayOptions
} from './scheduleForm';
import {
  buildTodoListUnits,
  flattenActiveUnitIds,
  flattenTodoUnits,
  getTodoTopLevelUnitId,
  moveTodoRelative,
  moveTodoStep,
  moveTodoUnitRelative,
  moveTodoWithinTagRelative,
  type TodoListUnit,
  type TodoPlacement
} from './todoOrdering';
import { countCompletedToday, countRemainingToday, formatLocalDateKey, getNextLocalDayRefreshDelay } from './todoStats';
import { hasExceededPetWindowDragThreshold } from './windowDrag';
import { shouldIgnoreWindowMouseEvents } from './mousePassthrough';
import { FocusMode } from './FocusMode';

const selectedPetStorageKey = 'tolist:selected-pet';
const petUiScaleStorageKey = 'tolist:pet-ui-scale';
const collapsedSubTasksStorageKey = 'tolist:collapsed-subtasks';
const collapsedTagGroupsStorageKey = 'tolist:collapsed-tag-groups';
const petBaseBottom = 38;
const petBaseHeight = 104;
const todoPetGap = 8;

export function App(): ReactElement {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pets, setPets] = useState<PetPackage[]>([]);
  const [schedules, setSchedules] = useState<ScheduledTodoRule[]>([]);
  const [language, setLanguage] = useState<AppLanguage>(defaultLanguage);
  const [selectedPetId, setSelectedPetId] = useState<string>(() => localStorage.getItem(selectedPetStorageKey) ?? '');
  const [todoPanelVisible, setTodoPanelVisible] = useState(true);
  const [schedulePanelVisible, setSchedulePanelVisible] = useState(false);
  const [focusTarget, setFocusTarget] = useState<
    | { kind: 'todo'; id: string }
    | { kind: 'subtask'; parentId: string; subTaskId: string }
    | null
  >(null)
  const [composerOpen, setComposerOpen] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [editingTodo, setEditingTodo] = useState<{ id: string; text: string; parentId?: string } | null>(null);
  const [editingNotesTodo, setEditingNotesTodo] = useState<{ id: string; notes: string } | null>(null);
  const [editingTagTodo, setEditingTagTodo] = useState<{ id: string; tag: string } | null>(null);
  const [deadlineFormTodo, setDeadlineFormTodo] = useState<{ id: string; year: string; month: string; day: string } | null>(null);
  const [deadlineFormError, setDeadlineFormError] = useState('');
  const [subTaskComposerParent, setSubTaskComposerParent] = useState<string | null>(null);
  const [newSubTaskText, setNewSubTaskText] = useState('');
  const [subTaskDeadlineForm, setSubTaskDeadlineForm] = useState<{ parentId: string; subTaskId: string; year: string; month: string; day: string } | null>(null);
  const [subTaskDeadlineFormError, setSubTaskDeadlineFormError] = useState('');
  const [draggingSubTask, setDraggingSubTask] = useState<{ parentId: string; subTaskId: string } | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(collapsedSubTasksStorageKey);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [collapsedTagGroups, setCollapsedTagGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(collapsedTagGroupsStorageKey);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(() => createDefaultScheduleForm());
  const [draggingTodo, setDraggingTodo] = useState<TodoItem | null>(null);
  const [draggingTodoUnit, setDraggingTodoUnit] = useState<string | null>(null);
  const [resizingPetUi, setResizingPetUi] = useState(false);
  const [petUiScale, setPetUiScale] = useState(() =>
    clampPetUiScale(Number(localStorage.getItem(petUiScaleStorageKey) ?? defaultPetUiScale))
  );
  const [petHovered, setPetHovered] = useState(false);
  const [transientState, setTransientState] = useState<PetState | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const windowDrag = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
    lastDirection: 'running-left' | 'running-right' | null;
  } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; scale: number } | null>(null);
  const mouseInputCaptured = useRef(false);
  const mousePassthrough = useRef<boolean | null>(null);
  const todoPressStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setWindowMousePassthrough(true);
    const handlePointerMove = (event: globalThis.PointerEvent): void => {
      updateWindowMousePassthrough(event.target);
    };
    const handleMouseMove = (event: MouseEvent): void => {
      updateWindowMousePassthrough(event.target);
    };
    const handlePointerLeave = (): void => {
      if (!mouseInputCaptured.current) {
        setWindowMousePassthrough(true);
      }
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('pointerleave', handlePointerLeave);
      void window.todoPet.window.setMousePassthrough(false);
    };
  }, []);

  useEffect(() => {
    void window.todoPet.settings.getLanguage().then(setLanguage);
    const offLanguage = window.todoPet.settings.onLanguageChanged(setLanguage);
    return () => {
      offLanguage();
    };
  }, []);

  useEffect(() => {
    void window.todoPet.todos.list().then(setTodos);
    void window.todoPet.pets.list().then((loadedPets) => {
      setPets(loadedPets);
      if (!selectedPetId && loadedPets[0]) {
        selectPet(loadedPets[0].id);
      }
    });
    void window.todoPet.schedules.list().then(setSchedules);

    const offTodos = window.todoPet.todos.onChanged(setTodos);
    const offSchedules = window.todoPet.schedules.onChanged(setSchedules);
    const offPets = window.todoPet.pets.onChanged((loadedPets) => {
      setPets(loadedPets);
      if (loadedPets.length > 0 && !loadedPets.some((pet) => pet.id === selectedPetId)) {
        selectPet(loadedPets[0].id);
      }
    });
    const offToggleTodoPanel = window.todoPet.ui.onToggleTodoPanel(() => {
      setSchedulePanelVisible(false);
      setTodoPanelVisible((visible) => !visible);
      setComposerOpen(false);
    });
    const offToggleSchedulePanel = window.todoPet.ui.onToggleSchedulePanel(() => {
      setTodoPanelVisible(true);
      setSchedulePanelVisible((visible) => !visible);
      setComposerOpen(false);
      setEditingTodo(null);
    });
    const offSelectPet = window.todoPet.ui.onSelectPet((id) => selectPet(id));
    return () => {
      offTodos();
      offSchedules();
      offPets();
      offToggleTodoPanel();
      offToggleSchedulePanel();
      offSelectPet();
    };
  }, [selectedPetId]);

  useEffect(() => {
    const offTodoAction = window.todoPet.ui.onTodoAction(handleTodoMenuAction);
    const offSubTaskAction = window.todoPet.ui.onSubTaskAction(handleSubTaskMenuAction);
    return () => {
      offTodoAction();
      offSubTaskAction();
    };
  }, [todos]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const refreshAndReschedule = (): void => {
      if (disposed) {
        return;
      }
      void window.todoPet.todos.list().then((items) => {
        if (!disposed) {
          setTodos(items);
        }
      }).finally(() => {
        if (!disposed) {
          scheduleNextRefresh();
        }
      });
    };

    const scheduleNextRefresh = (): void => {
      timer = window.setTimeout(refreshAndReschedule, getNextLocalDayRefreshDelay(new Date()));
    };

    scheduleNextRefresh();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!draggingTodo && !draggingTodoUnit) {
      return;
    }
    const stopDragging = (event: globalThis.PointerEvent): void => {
      const activeIds = flattenActiveUnitIds(buildTodoListUnits(todos));
      void window.todoPet.todos.reorderVisible(activeIds).then(setTodos);
      setDraggingTodo(null);
      setDraggingTodoUnit(null);
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(event.clientX, event.clientY);
    };
    window.addEventListener('pointerup', stopDragging, { once: true });
    return () => window.removeEventListener('pointerup', stopDragging);
  }, [draggingTodo, draggingTodoUnit, todos]);

  useEffect(() => {
    if (!draggingSubTask) {
      return;
    }
    const stopDragging = (event: globalThis.PointerEvent): void => {
      const parent = todos.find((item) => item.id === draggingSubTask.parentId);
      if (parent) {
        const activeIds = parent.subTasks.filter((s) => !s.completed).map((s) => s.id);
        void window.todoPet.todos.reorderSubTasks(draggingSubTask.parentId, activeIds).then(setTodos);
      }
      setDraggingSubTask(null);
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(event.clientX, event.clientY);
    };
    window.addEventListener('pointerup', stopDragging, { once: true });
    return () => window.removeEventListener('pointerup', stopDragging);
  }, [draggingSubTask, todos]);

  useEffect(() => {
    if (!resizingPetUi) {
      return;
    }

    const onMove = (event: globalThis.PointerEvent): void => {
      if (!resizeStart.current) {
        return;
      }

      const nextScale = getPetUiScaleFromResizeDrag(
        resizeStart.current.scale,
        event.screenX - resizeStart.current.x,
        event.screenY - resizeStart.current.y
      );
      setPetUiScale(nextScale);
    };

    const onUp = (event: globalThis.PointerEvent): void => {
      setResizingPetUi(false);
      resizeStart.current = null;
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(event.clientX, event.clientY);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizingPetUi]);

  useEffect(() => {
    localStorage.setItem(petUiScaleStorageKey, String(petUiScale));
  }, [petUiScale]);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId) ?? pets[0],
    [pets, selectedPetId]
  );
  const completedTodayCount = countCompletedToday(todos, formatLocalDateKey(new Date()));
  const remainingTodayCount = countRemainingToday(todos, formatLocalDateKey(new Date()));
  const [streakPhase, setStreakPhase] = useState<'completed' | 'remaining'>('completed');
  useEffect(() => {
    const id = window.setInterval(() => {
      setStreakPhase((prev) => (prev === 'completed' ? 'remaining' : 'completed'));
    }, 4000);
    return () => window.clearInterval(id);
  }, []);
  const todoUnits = useMemo(() => buildTodoListUnits(todos), [todos]);
  const existingActiveTags = useMemo(
    () => Array.from(new Set(todos.filter((item) => !item.completed && item.tag).map((item) => item.tag!))).sort(),
    [todos]
  );
  const scheduleMaxDay = getScheduleFormMaxDay(scheduleForm);
  const deadlineMaxDay = deadlineFormTodo ? getDeadlineFormMaxDay(deadlineFormTodo) : 31;
  const subTaskDeadlineMaxDay = subTaskDeadlineForm ? getDeadlineFormMaxDay(subTaskDeadlineForm) : 31;
  const basePetState = getTodoDrivenPetState(todos);
  const petState =
    transientState ??
    getInteractivePetState({
      baseState: basePetState,
      isHovered: petHovered
    });

  const focusData = useMemo(() => {
    if (!focusTarget) return null
    if (focusTarget.kind === 'todo') {
      const item = todos.find((t) => t.id === focusTarget.id)
      return item ? { text: item.text, completed: item.completed } : null
    }
    const parent = todos.find((t) => t.id === focusTarget.parentId)
    const sub = parent?.subTasks.find((s) => s.id === focusTarget.subTaskId)
    return sub ? { text: sub.text, completed: sub.completed } : null
  }, [focusTarget, todos])

  function tr(key: I18nKey, values?: Record<string, string | number>): string {
    return t(language, key, values);
  }

  function selectPet(id: string): void {
    setSelectedPetId(id);
    localStorage.setItem(selectedPetStorageKey, id);
    void window.todoPet.pets.select(id);
  }

  async function submitTodo(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = newTodoText.trim();
    if (!text) {
      return;
    }
    await window.todoPet.todos.add(text);
    setNewTodoText('');
    setComposerOpen(false);
    setTransientState('waving');
    window.setTimeout(() => setTransientState(null), 900);
  }

  async function submitSchedule(event: FormEvent): Promise<void> {
    event.preventDefault();
    let input: ScheduledTodoInput;
    try {
      input = buildScheduleInput(scheduleForm, new Date(), language);
    } catch (error) {
      setScheduleError((error as Error).message);
      return;
    }

    setScheduleError('');
    if (editingScheduleId) {
      await window.todoPet.schedules.update(editingScheduleId, input);
    } else {
      await window.todoPet.schedules.create(input);
    }
    closeScheduleForm();
  }

  function openPetMenu(event: React.MouseEvent): void {
    event.preventDefault();
    void window.todoPet.ui.showPetMenu({ x: Math.round(event.clientX), y: Math.round(event.clientY) });
  }

  function openTaskMenu(event: React.MouseEvent, item: TodoItem): void {
    event.preventDefault();
    void window.todoPet.ui.showTodoMenu({
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
      item
    });
  }

  function setWindowMousePassthrough(ignore: boolean): void {
    if (mousePassthrough.current === ignore) {
      return;
    }
    mousePassthrough.current = ignore;
    void window.todoPet.window.setMousePassthrough(ignore);
  }

  function updateWindowMousePassthrough(target: EventTarget | null): void {
    setWindowMousePassthrough(shouldIgnoreWindowMouseEvents(target, mouseInputCaptured.current));
  }

  function updateWindowMousePassthroughFromPoint(clientX: number, clientY: number): void {
    updateWindowMousePassthrough(document.elementFromPoint(clientX, clientY));
  }

  function setWindowMouseInputCaptured(captured: boolean): void {
    mouseInputCaptured.current = captured;
    if (captured) {
      setWindowMousePassthrough(false);
    }
  }

  function openNewScheduleForm(): void {
    setScheduleForm(createDefaultScheduleForm());
    setEditingScheduleId(null);
    setScheduleError('');
    setScheduleFormOpen(true);
  }

  function editSchedule(rule: ScheduledTodoRule): void {
    setScheduleForm(scheduleRuleToForm(rule));
    setEditingScheduleId(rule.id);
    setScheduleError('');
    setScheduleFormOpen(true);
  }

  function closeScheduleForm(): void {
    setScheduleFormOpen(false);
    setEditingScheduleId(null);
    setScheduleError('');
    setScheduleForm(createDefaultScheduleForm());
  }

  function updateScheduleForm(patch: Partial<ScheduleFormState>): void {
    setScheduleForm((current) => ({ ...current, ...patch }));
  }

  function toggleScheduleWeekday(day: number): void {
    setScheduleForm((current) => {
      const weekdays = current.weekdays.includes(day)
        ? current.weekdays.filter((weekday) => weekday !== day)
        : [...current.weekdays, day].sort((left, right) => left - right);
      return { ...current, weekdays };
    });
  }

  async function toggleScheduleEnabled(rule: ScheduledTodoRule): Promise<void> {
    await window.todoPet.schedules.setEnabled(rule.id, !rule.enabled);
  }

  async function deleteSchedule(rule: ScheduledTodoRule): Promise<void> {
    await window.todoPet.schedules.delete(rule.id);
    if (editingScheduleId === rule.id) {
      closeScheduleForm();
    }
  }

  function handleTodoMenuAction(action: TodoMenuAction): void {
    const item = todos.find((todo) => todo.id === action.id);
    if (!item) {
      return;
    }

    if (action.type === 'edit') {
      setComposerOpen(false);
      setEditingTodo({ id: item.id, text: item.text });
      return;
    }
    if (action.type === 'enter-focus') {
      setFocusTarget({ kind: 'todo', id: action.id });
      return;
    }
    if (action.type === 'edit-notes') {
      setComposerOpen(false);
      setEditingNotesTodo({ id: item.id, notes: item.notes ?? '' });
      return;
    }
    if (action.type === 'edit-tag') {
      setComposerOpen(false);
      setEditingTagTodo({ id: item.id, tag: item.tag ?? '' });
      return;
    }
    if (action.type === 'set-deadline') {
      setComposerOpen(false);
      const today = new Date();
      const parts = item.deadline?.split('-') ?? [];
      setDeadlineFormError('');
      setDeadlineFormTodo({
        id: item.id,
        year: parts[0] ?? String(today.getFullYear()),
        month: parts[1] ?? String(today.getMonth() + 1).padStart(2, '0'),
        day: parts[2] ?? String(today.getDate()).padStart(2, '0')
      });
      return;
    }
    if (action.type === 'add-sub-task') {
      setComposerOpen(false);
      setSubTaskComposerParent(item.id);
      setNewSubTaskText('');
      return;
    }
    if (action.type === 'toggle-completed') {
      void window.todoPet.todos.setCompleted(item.id, !item.completed);
      return;
    }
    if (action.type === 'toggle-highlighted') {
      void window.todoPet.todos.setHighlighted(item.id, !item.highlighted);
      return;
    }
    if (action.type === 'delete') {
      void window.todoPet.todos.delete(item.id);
      return;
    }
    if (action.type === 'move-up' || action.type === 'move-down') {
      applyPriorityStep(item, action.type === 'move-up' ? 'up' : 'down');
    }
  }

  function startTodoPress(event: PointerEvent, item: TodoItem): void {
    if (editingTodo?.id === item.id || editingTodo?.parentId === item.id || editingNotesTodo?.id === item.id || editingTagTodo?.id === item.id || deadlineFormTodo?.id === item.id || item.completed || event.button !== 0) {
      return;
    }
    todoPressStart.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setWindowMouseInputCaptured(true);
      setDraggingTodo(item);
      setDraggingTodoUnit(getTodoTopLevelUnitId(item));
    }, 220);
  }

  function cancelTodoPress(): void {
    window.clearTimeout(longPressTimer.current);
    todoPressStart.current = null;
  }

  async function submitTodoEdit(event: FormEvent, item: TodoItem): Promise<void> {
    event.preventDefault();
    const text = editingTodo?.text.trim() ?? '';
    if (!text) {
      return;
    }
    if (editingTodo?.parentId) {
      await window.todoPet.todos.updateSubTask(editingTodo.parentId, editingTodo.id, text);
    } else {
      await window.todoPet.todos.updateText(item.id, text);
    }
    setEditingTodo(null);
  }

  async function submitNotesEdit(event: FormEvent, item: TodoItem): Promise<void> {
    event.preventDefault();
    const notes = editingNotesTodo?.notes ?? '';
    await window.todoPet.todos.updateNotes(item.id, notes);
    setEditingNotesTodo(null);
  }

  async function submitTagEdit(event: FormEvent, item: TodoItem): Promise<void> {
    event.preventDefault();
    await window.todoPet.todos.updateTag(item.id, editingTagTodo?.tag ?? undefined);
    setEditingTagTodo(null);
  }

  async function removeTag(item: TodoItem): Promise<void> {
    await window.todoPet.todos.updateTag(item.id, undefined);
    setEditingTagTodo(null);
  }

  async function submitDeadlineForm(event: FormEvent, item: TodoItem): Promise<void> {
    event.preventDefault();
    const form = deadlineFormTodo;
    if (!form) return;
    let deadline: string | undefined;
    try {
      deadline = buildDeadlineInput(form, new Date(), language);
    } catch (error) {
      setDeadlineFormError((error as Error).message);
      return;
    }
    setDeadlineFormError('');
    await window.todoPet.todos.setDeadline(item.id, deadline);
    setDeadlineFormTodo(null);
  }

  function getDeadlineInfo(deadline: string): { label: string; className: string } {
    const today = formatLocalDateKey(new Date());
    const diffDays = Math.round((new Date(deadline).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      return { label: tr('todo.overdue'), className: 'todo-deadline--overdue' };
    }
    if (diffDays === 0) {
      return { label: tr('todo.dueToday'), className: 'todo-deadline--due-today' };
    }
    return { label: tr('todo.daysLeft', { count: diffDays }), className: '' };
  }

  function handleSubTaskMenuAction(action: SubTaskMenuAction): void {
    if (action.type === 'edit') {
      const parent = todos.find((item) => item.id === action.parentId);
      const sub = parent?.subTasks.find((s) => s.id === action.subTaskId);
      if (!sub) return;
      setEditingTodo({ id: sub.id, text: sub.text, parentId: action.parentId });
      return;
    }
    if (action.type === 'enter-focus') {
      setFocusTarget({ kind: 'subtask', parentId: action.parentId, subTaskId: action.subTaskId });
      return;
    }
    if (action.type === 'toggle-completed') {
      const parent = todos.find((item) => item.id === action.parentId);
      const sub = parent?.subTasks.find((s) => s.id === action.subTaskId);
      if (!sub) return;
      void window.todoPet.todos.setSubTaskCompleted(action.parentId, action.subTaskId, !sub.completed);
      return;
    }
    if (action.type === 'set-deadline') {
      const parent = todos.find((item) => item.id === action.parentId);
      const sub = parent?.subTasks.find((s) => s.id === action.subTaskId);
      if (!sub) return;
      const today = new Date();
      const parts = sub.deadline?.split('-') ?? [];
      setSubTaskDeadlineFormError('');
      setSubTaskDeadlineForm({
        parentId: action.parentId,
        subTaskId: action.subTaskId,
        year: parts[0] ?? String(today.getFullYear()),
        month: parts[1] ?? String(today.getMonth() + 1).padStart(2, '0'),
        day: parts[2] ?? String(today.getDate()).padStart(2, '0')
      });
      return;
    }
    if (action.type === 'delete') {
      void window.todoPet.todos.deleteSubTask(action.parentId, action.subTaskId);
      return;
    }
    if (action.type === 'move-up' || action.type === 'move-down') {
      void window.todoPet.todos.moveSubTask(action.parentId, action.subTaskId, action.type === 'move-up' ? 'up' : 'down');
    }
  }

  function handleFocusToggleCompleted(): void {
    if (!focusTarget) return
    if (focusTarget.kind === 'todo') {
      const item = todos.find((t) => t.id === focusTarget.id)
      if (!item) return
      void window.todoPet.todos.setCompleted(focusTarget.id, !item.completed)
    } else {
      const parent = todos.find((t) => t.id === focusTarget.parentId)
      const sub = parent?.subTasks.find((s) => s.id === focusTarget.subTaskId)
      if (!sub) return
      void window.todoPet.todos.setSubTaskCompleted(focusTarget.parentId, focusTarget.subTaskId, !sub.completed)
    }
  }

  async function submitSubTask(event: FormEvent, parentId: string): Promise<void> {
    event.preventDefault();
    const text = newSubTaskText.trim();
    if (!text) return;
    await window.todoPet.todos.addSubTask(parentId, text);
    setNewSubTaskText('');
    setSubTaskComposerParent(null);
  }

  async function submitSubTaskDeadlineForm(event: FormEvent, parentId: string): Promise<void> {
    event.preventDefault();
    const form = subTaskDeadlineForm;
    if (!form) return;
    let deadline: string | undefined;
    try {
      deadline = buildDeadlineInput(form, new Date(), language);
    } catch (error) {
      setSubTaskDeadlineFormError((error as Error).message);
      return;
    }
    setSubTaskDeadlineFormError('');
    await window.todoPet.todos.setSubTaskDeadline(parentId, form.subTaskId, deadline);
    setSubTaskDeadlineForm(null);
  }

  function openSubTaskMenu(event: React.MouseEvent, parentId: string, sub: TodoSubTask): void {
    event.preventDefault();
    event.stopPropagation();
    void window.todoPet.ui.showSubTaskMenu({
      point: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
      parentId,
      subTask: sub
    });
  }

  function toggleCollapse(parentId: string): void {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      localStorage.setItem(collapsedSubTasksStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function toggleTagGroup(unitId: string): void {
    setCollapsedTagGroups((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      localStorage.setItem(collapsedTagGroupsStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function startTagGroupPress(event: PointerEvent, unitId: string): void {
    if (event.button !== 0) return;
    todoPressStart.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setWindowMouseInputCaptured(true);
      setDraggingTodoUnit(unitId);
    }, 220);
  }

  function startSubTaskPress(event: PointerEvent, parentId: string, sub: TodoSubTask): void {
    if (sub.completed || event.button !== 0) return;
    todoPressStart.current = { x: event.clientX, y: event.clientY };
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setWindowMouseInputCaptured(true);
      setDraggingSubTask({ parentId, subTaskId: sub.id });
    }, 220);
  }

  function cancelSubTaskPress(): void {
    window.clearTimeout(longPressTimer.current);
    todoPressStart.current = null;
  }

  function handleSubTaskPointerMove(event: PointerEvent<HTMLElement>, parentId: string, sub: TodoSubTask): void {
    if (!draggingSubTask && todoPressStart.current) {
      const deltaX = event.clientX - todoPressStart.current.x;
      const deltaY = event.clientY - todoPressStart.current.y;
      if (Math.hypot(deltaX, deltaY) > 10) {
        cancelSubTaskPress();
      }
      return;
    }
    if (!draggingSubTask || draggingSubTask.parentId !== parentId || sub.id === draggingSubTask.subTaskId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement: 'before' | 'after' = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
    hoverSubTask(parentId, draggingSubTask.subTaskId, sub.id, placement);
  }

  function hoverSubTask(parentId: string, draggingId: string, targetId: string, placement: 'before' | 'after'): void {
    if (!draggingSubTask) return;
    setTodos((current) => reorderSubTasksLocally(current, parentId, draggingId, targetId, placement));
  }

  function reorderSubTasksLocally(todosList: TodoItem[], parentId: string, draggingSubTaskId: string, hoverSubTaskId: string, placement: 'before' | 'after'): TodoItem[] {
    return todosList.map((item) => {
      if (item.id !== parentId) return item;
      const subTasks = [...item.subTasks];
      const fromIdx = subTasks.findIndex((s) => s.id === draggingSubTaskId);
      if (fromIdx < 0) return item;
      const [removed] = subTasks.splice(fromIdx, 1);
      let toIdx = subTasks.findIndex((s) => s.id === hoverSubTaskId);
      if (toIdx < 0) return item;
      if (placement === 'after') toIdx += 1;
      subTasks.splice(toIdx, 0, removed);
      return { ...item, subTasks };
    });
  }

  function handleTodoPointerMove(event: PointerEvent<HTMLElement>, item: TodoItem): void {
    if (!draggingTodo && !draggingTodoUnit && todoPressStart.current) {
      const deltaX = event.clientX - todoPressStart.current.x;
      const deltaY = event.clientY - todoPressStart.current.y;
      if (Math.hypot(deltaX, deltaY) > 10) {
        cancelTodoPress();
      }
      return;
    }

    if (!draggingTodo && !draggingTodoUnit) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement: TodoPlacement = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
    if (draggingTodoUnit && !item.tag) {
      setTodos((current) => {
        const units = buildTodoListUnits(current);
        const nextUnits = moveTodoUnitRelative(units, draggingTodoUnit, getTodoTopLevelUnitId(item), placement);
        return nextUnits === units ? current : flattenTodoUnits(nextUnits);
      });
      return;
    }
    hoverTodo(item, placement);
  }

  function handleTodoUnitPointerMove(event: PointerEvent<HTMLElement>, unitId: string): void {
    if (!draggingTodoUnit && todoPressStart.current) {
      const deltaX = event.clientX - todoPressStart.current.x;
      const deltaY = event.clientY - todoPressStart.current.y;
      if (Math.hypot(deltaX, deltaY) > 10) {
        cancelTodoPress();
      }
      return;
    }
    if (!draggingTodoUnit || draggingTodoUnit === unitId) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement: TodoPlacement = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
    setTodos((current) => {
      const units = buildTodoListUnits(current);
      const nextUnits = moveTodoUnitRelative(units, draggingTodoUnit, unitId, placement);
      return nextUnits === units ? current : flattenTodoUnits(nextUnits);
    });
  }

  function hoverTodo(item: TodoItem, placement: TodoPlacement): void {
    if (!draggingTodo || item.id === draggingTodo.id || item.completed) {
      return;
    }
    if (draggingTodo.tag && item.tag === draggingTodo.tag) {
      setTodos((current) => moveTodoWithinTagRelative(current, draggingTodo.id, item.id, placement));
      return;
    }
    if (!draggingTodo.tag && !item.tag) {
      setTodos((current) => moveTodoRelative(current, draggingTodo.id, item.id, placement));
    }
  }

  function applyPriorityStep(item: TodoItem, direction: 'up' | 'down'): void {
    const next = moveTodoStep(todos, item.id, direction);
    if (next === todos) {
      return;
    }
    setTodos(next);
    const activeIds = flattenActiveUnitIds(buildTodoListUnits(next));
    void window.todoPet.todos.reorderVisible(activeIds).then(setTodos);
  }

  function startWindowDrag(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    setWindowMouseInputCaptured(true);
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    windowDrag.current = {
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      dragging: false,
      lastDirection: null
    };
    window.todoPet.window.startDrag(event.screenX, event.screenY);

    let pendingDragMove: { screenX: number; screenY: number } | null = null;
    let dragAnimationFrame: number | null = null;

    const flushDragMove = (): void => {
      dragAnimationFrame = null;
      if (!pendingDragMove) {
        return;
      }
      const next = pendingDragMove;
      pendingDragMove = null;
      window.todoPet.window.moveDrag(next.screenX, next.screenY);
    };

    const scheduleDragMove = (screenX: number, screenY: number): void => {
      pendingDragMove = { screenX, screenY };
      if (dragAnimationFrame === null) {
        dragAnimationFrame = window.requestAnimationFrame(flushDragMove);
      }
    };

    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      const drag = windowDrag.current;
      if (!drag) {
        return;
      }

      if (!drag.dragging) {
        if (!hasExceededPetWindowDragThreshold(drag.startX, drag.startY, moveEvent.screenX, moveEvent.screenY)) {
          return;
        }
        drag.dragging = true;
      }

      const deltaX = moveEvent.screenX - drag.lastX;
      const deltaY = moveEvent.screenY - drag.lastY;
      drag.lastX = moveEvent.screenX;
      drag.lastY = moveEvent.screenY;
      if (deltaX !== 0 || deltaY !== 0) {
        const direction = deltaX < 0 ? 'running-left' : 'running-right';
        if (drag.lastDirection !== direction) {
          drag.lastDirection = direction;
          setTransientState(direction);
        }
        scheduleDragMove(moveEvent.screenX, moveEvent.screenY);
      }
    };

    const stopDragging = (upEvent: globalThis.PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stopDragging);
      const drag = windowDrag.current;
      if (dragAnimationFrame !== null) {
        window.cancelAnimationFrame(dragAnimationFrame);
        dragAnimationFrame = null;
      }
      if (drag?.dragging) {
        window.todoPet.window.moveDrag(upEvent.screenX, upEvent.screenY);
      }
      pendingDragMove = null;
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      windowDrag.current = null;
      window.todoPet.window.endDrag();
      setTransientState(null);
      setWindowMouseInputCaptured(false);
      updateWindowMousePassthroughFromPoint(upEvent.clientX, upEvent.clientY);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stopDragging, { once: true });
  }

  function startPetUiResize(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setWindowMouseInputCaptured(true);
    resizeStart.current = { x: event.screenX, y: event.screenY, scale: petUiScale };
    setResizingPetUi(true);
  }

  function renderTodoItem(item: TodoItem, options: { inTagGroup?: boolean } = {}): ReactElement {
    return (
      <React.Fragment key={item.id}>
        <article
          className={[
            'todo-item',
            options.inTagGroup ? 'todo-item--tagged' : '',
            item.completed ? 'todo-item--done' : '',
            item.highlighted ? 'todo-item--hot' : '',
            editingTodo?.id === item.id ? 'todo-item--editing' : '',
            editingNotesTodo?.id === item.id ? 'todo-item--editing-notes' : '',
            draggingTodo?.id === item.id ? 'todo-item--dragging' : ''
          ].join(' ')}
          data-todo-id={item.id}
          onContextMenu={(event) => openTaskMenu(event, item)}
          onPointerDown={(event) => startTodoPress(event, item)}
          onPointerMove={(event) => handleTodoPointerMove(event, item)}
          onPointerUp={cancelTodoPress}
          onPointerCancel={cancelTodoPress}
        >
          {editingTodo?.id === item.id && !editingTodo.parentId ? (
            <form className="todo-editor" onSubmit={(event) => void submitTodoEdit(event, item)}>
              <input
                autoFocus
                value={editingTodo.text}
                onChange={(event) => setEditingTodo({ id: item.id, text: event.target.value })}
              />
              <button className="icon-button" title={tr('todo.saveEdit')} type="submit">
                <Check size={16} />
              </button>
              <button className="icon-button" title={tr('menu.cancelEdit')} type="button" onClick={() => setEditingTodo(null)}>
                <X size={16} />
              </button>
            </form>
          ) : (
            <>
              <button
                className="todo-check"
                title={item.completed ? tr('todo.markActive') : tr('todo.markDone')}
                onClick={() => {
                  if (!item.completed && item.subTasks.some((s) => !s.completed)) return;
                  void window.todoPet.todos.setCompleted(item.id, !item.completed);
                }}
              >
                {item.completed ? <Check size={15} /> : <Circle size={15} />}
              </button>
              <div className="todo-copy">
                <span>
                  {item.subTasks.length > 0 ? (
                    <button
                      className="todo-collapse-toggle"
                      title={collapsedParents.has(item.id) ? tr('todo.expandSubTasks') : tr('todo.collapseSubTasks')}
                      type="button"
                      onClick={(event) => { event.stopPropagation(); toggleCollapse(item.id); }}
                    >
                      {collapsedParents.has(item.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : null}
                  {item.text}
                </span>
                <div className="todo-copy-meta">
                  {item.deadline && !item.completed ? (
                    <small className={getDeadlineInfo(item.deadline).className}>{getDeadlineInfo(item.deadline).label}</small>
                  ) : (
                    <small>{item.overdue ? item.date : tr('todo.today')}</small>
                  )}
                  {item.tag && !options.inTagGroup ? <small className="todo-tag-chip">{item.tag}</small> : null}
                  {item.notes && editingNotesTodo?.id !== item.id ? (
                    <small className="todo-notes-preview">{item.notes}</small>
                  ) : null}
                  {item.subTasks.length > 0 && collapsedParents.has(item.id) ? (
                    <small className="todo-subtask-count">{item.subTasks.filter((s) => s.completed).length}/{item.subTasks.length}</small>
                  ) : null}
                </div>
              </div>
              {deadlineFormTodo?.id === item.id ? (
                <form className="todo-deadline-editor" onSubmit={(event) => void submitDeadlineForm(event, item)}>
                  <div className="todo-deadline-inputs">
                    <input autoFocus className="todo-deadline-year" value={deadlineFormTodo.year} onChange={(event) => setDeadlineFormTodo({ ...deadlineFormTodo, year: event.target.value })} placeholder={tr('schedule.year')} />
                    <input className="todo-deadline-month" value={deadlineFormTodo.month} onChange={(event) => setDeadlineFormTodo({ ...deadlineFormTodo, month: event.target.value })} placeholder={tr('schedule.month')} />
                    <input className="todo-deadline-day" value={deadlineFormTodo.day} onChange={(event) => setDeadlineFormTodo({ ...deadlineFormTodo, day: event.target.value })} min={1} max={deadlineMaxDay} placeholder={tr('schedule.day')} />
                  </div>
                  {deadlineFormError ? <div className="todo-deadline-error">{deadlineFormError}</div> : null}
                  <div className="todo-deadline-editor-actions">
                    {item.deadline ? (
                      <button className="icon-button icon-button--danger" title={tr('menu.removeDeadline')} type="button" onClick={() => { void window.todoPet.todos.setDeadline(item.id, undefined); setDeadlineFormTodo(null); setDeadlineFormError(''); }}>
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                    <button className="icon-button" title={tr('todo.save')} type="submit"><Check size={16} /></button>
                    <button className="icon-button" title={tr('menu.cancelEdit')} type="button" onClick={() => { setDeadlineFormTodo(null); setDeadlineFormError(''); }}><X size={16} /></button>
                  </div>
                </form>
              ) : null}
              {editingTagTodo?.id === item.id ? (
                <form className="todo-tag-editor" onSubmit={(event) => void submitTagEdit(event, item)}>
                  {existingActiveTags.length > 0 ? (
                    <select
                      className="todo-tag-select"
                      value={existingActiveTags.includes(editingTagTodo.tag) ? editingTagTodo.tag : ''}
                      onChange={(event) => setEditingTagTodo({ id: item.id, tag: event.target.value })}
                    >
                      <option value="">{tr('todo.selectExistingTag')}</option>
                      {existingActiveTags.map((tag) => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                  ) : null}
                  <div className="todo-tag-editor__row">
                    <input autoFocus value={editingTagTodo.tag} onChange={(event) => setEditingTagTodo({ id: item.id, tag: event.target.value })} placeholder={tr('todo.tagPlaceholder')} />
                    {item.tag ? (
                      <button className="icon-button icon-button--danger" title={tr('todo.removeTag')} type="button" onClick={() => void removeTag(item)}>
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                    <button className="icon-button" title={tr('todo.saveTag')} type="submit"><Check size={16} /></button>
                    <button className="icon-button" title={tr('menu.cancelEdit')} type="button" onClick={() => setEditingTagTodo(null)}><X size={16} /></button>
                  </div>
                </form>
              ) : null}
              {editingNotesTodo?.id === item.id ? (
                <form className="todo-notes-editor" onSubmit={(event) => void submitNotesEdit(event, item)}>
                  <textarea autoFocus value={editingNotesTodo.notes} onChange={(event) => setEditingNotesTodo({ id: item.id, notes: event.target.value })} placeholder={tr('todo.notesPlaceholder')} rows={2} />
                  <div className="todo-notes-editor-actions">
                    <button className="icon-button" title={tr('todo.saveNotes')} type="submit"><Check size={16} /></button>
                    <button className="icon-button" title={tr('menu.cancelEdit')} type="button" onClick={() => setEditingNotesTodo(null)}><X size={16} /></button>
                  </div>
                </form>
              ) : null}
            </>
          )}
        </article>
        {!collapsedParents.has(item.id) ? [...item.subTasks].sort((a, b) => Number(a.completed) - Number(b.completed)).map((sub) => (
          <article
            className={[
              'todo-item',
              'todo-sub-task',
              options.inTagGroup ? 'todo-sub-task--tagged' : '',
              sub.completed ? 'todo-item--done' : '',
              editingTodo?.id === sub.id && editingTodo?.parentId === item.id ? 'todo-item--editing' : '',
              draggingSubTask?.subTaskId === sub.id ? 'todo-sub-task--dragging' : ''
            ].join(' ')}
            key={sub.id}
            onContextMenu={(event) => openSubTaskMenu(event, item.id, sub)}
            onPointerDown={(event) => startSubTaskPress(event, item.id, sub)}
            onPointerMove={(event) => handleSubTaskPointerMove(event, item.id, sub)}
            onPointerUp={cancelSubTaskPress}
            onPointerCancel={cancelSubTaskPress}
          >
            {editingTodo?.id === sub.id && editingTodo?.parentId === item.id ? (
              <form className="todo-editor" onSubmit={(event) => void submitTodoEdit(event, item)}>
                <input autoFocus value={editingTodo.text} onChange={(event) => setEditingTodo({ id: sub.id, text: event.target.value, parentId: item.id })} />
                <button className="icon-button" title={tr('todo.saveEdit')} type="submit"><Check size={14} /></button>
                <button className="icon-button" title={tr('menu.cancelEdit')} type="button" onClick={() => setEditingTodo(null)}><X size={14} /></button>
              </form>
            ) : subTaskDeadlineForm?.subTaskId === sub.id ? (
              <>
                <button className="todo-check" onClick={() => void window.todoPet.todos.setSubTaskCompleted(item.id, sub.id, !sub.completed)}>{sub.completed ? <Check size={13} /> : <Circle size={13} />}</button>
                <div className="todo-copy">
                  <span>{sub.text}</span>
                  <form className="todo-deadline-editor" style={{ gridColumn: '1 / -1' }} onSubmit={(event) => void submitSubTaskDeadlineForm(event, item.id)}>
                    <div className="todo-deadline-inputs">
                      <input autoFocus className="todo-deadline-year" value={subTaskDeadlineForm.year} onChange={(event) => setSubTaskDeadlineForm({ ...subTaskDeadlineForm!, year: event.target.value })} placeholder={tr('schedule.year')} />
                      <input className="todo-deadline-month" value={subTaskDeadlineForm.month} onChange={(event) => setSubTaskDeadlineForm({ ...subTaskDeadlineForm!, month: event.target.value })} placeholder={tr('schedule.month')} />
                      <input className="todo-deadline-day" value={subTaskDeadlineForm.day} onChange={(event) => setSubTaskDeadlineForm({ ...subTaskDeadlineForm!, day: event.target.value })} min={1} max={subTaskDeadlineMaxDay} placeholder={tr('schedule.day')} />
                    </div>
                    {subTaskDeadlineFormError ? <div className="todo-deadline-error">{subTaskDeadlineFormError}</div> : null}
                    <div className="todo-deadline-editor-actions">
                      {sub.deadline ? (
                        <button className="icon-button icon-button--danger" title={tr('menu.removeDeadline')} type="button" onClick={() => { void window.todoPet.todos.setSubTaskDeadline(item.id, sub.id, undefined); setSubTaskDeadlineForm(null); setSubTaskDeadlineFormError(''); }}><Trash2 size={14} /></button>
                      ) : null}
                      <button className="icon-button" title={tr('todo.save')} type="submit"><Check size={14} /></button>
                      <button className="icon-button" title={tr('menu.cancelEdit')} type="button" onClick={() => { setSubTaskDeadlineForm(null); setSubTaskDeadlineFormError(''); }}><X size={14} /></button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <>
                <button className="todo-check" onClick={() => void window.todoPet.todos.setSubTaskCompleted(item.id, sub.id, !sub.completed)}>{sub.completed ? <Check size={13} /> : <Circle size={13} />}</button>
                <div className="todo-copy">
                  <span>{sub.text}</span>
                  <div className="todo-copy-meta">
                    {sub.deadline && !sub.completed ? <small className={getDeadlineInfo(sub.deadline).className}>{getDeadlineInfo(sub.deadline).label}</small> : null}
                  </div>
                </div>
              </>
            )}
          </article>
        )) : null}
        {!collapsedParents.has(item.id) && subTaskComposerParent === item.id ? (
          <form className="todo-sub-task-composer" onSubmit={(event) => void submitSubTask(event, item.id)}>
            <input autoFocus value={newSubTaskText} onChange={(event) => setNewSubTaskText(event.target.value)} placeholder={tr('todo.subTaskPlaceholder')} />
            <button className="icon-button" title={tr('todo.save')} type="submit"><Check size={14} /></button>
            <button className="icon-button" title={tr('todo.cancel')} type="button" onClick={() => setSubTaskComposerParent(null)}><X size={14} /></button>
          </form>
        ) : null}
      </React.Fragment>
    );
  }

  function renderTodoUnit(unit: TodoListUnit): ReactElement {
    if (unit.type === 'todo') {
      return renderTodoItem(unit.item);
    }
    const collapsed = collapsedTagGroups.has(unit.id);
    const color = getTagColor(unit.tag);
    const activeCount = unit.items.filter((item) => !item.completed).length;
    return (
      <section className={['todo-tag-group', draggingTodoUnit === unit.id ? 'todo-tag-group--dragging' : ''].join(' ')} key={unit.id} style={{ '--tag-color': color } as CSSProperties}>
        <div
          className="todo-tag-group__header"
          onPointerDown={(event) => startTagGroupPress(event, unit.id)}
          onPointerMove={(event) => handleTodoUnitPointerMove(event, unit.id)}
          onPointerUp={cancelTodoPress}
          onPointerCancel={cancelTodoPress}
        >
          <button className="todo-tag-group__toggle" title={collapsed ? tr('todo.expandTagGroup') : tr('todo.collapseTagGroup')} type="button" onClick={(event) => { event.stopPropagation(); toggleTagGroup(unit.id); }}>
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <span className="todo-tag-group__pill">{unit.tag}</span>
          <span className="todo-tag-group__count">{activeCount}/{unit.items.length}</span>
        </div>
        {!collapsed ? <div className="todo-tag-group__items">{unit.items.map((item) => renderTodoItem(item, { inTagGroup: true }))}</div> : null}
      </section>
    );
  }

  return (
    <main className="pet-stage" style={{ '--pet-ui-scale': petUiScale } as CSSProperties}>
      {focusTarget && focusData ? (
        <section
          className="todo-panel"
          style={{ bottom: petBaseBottom + petBaseHeight * petUiScale + todoPetGap }}
        >
          <FocusMode
            text={focusData.text}
            completed={focusData.completed}
            completedLabel={tr('focus.completed')}
            exitLabel={tr('focus.exit')}
            onToggleCompleted={handleFocusToggleCompleted}
            onExit={() => setFocusTarget(null)}
          />
        </section>
      ) : (
        <>
          {schedulePanelVisible ? (
        <section
          className="todo-panel schedule-panel"
          aria-label={tr('schedule.aria')}
          style={{ bottom: petBaseBottom + petBaseHeight * petUiScale + todoPetGap }}
        >
          <div className="todo-panel__top">
            <div className="todo-panel__heading">
              <span className="todo-panel__title">{tr('schedule.title')}</span>
              <span className="schedule-count">{tr('schedule.count', { count: schedules.length })}</span>
            </div>
            <div className="panel-actions">
              <button className="icon-button" title={tr('schedule.add')} onClick={openNewScheduleForm}>
                <Plus size={16} />
              </button>
              <button className="icon-button" title={tr('schedule.close')} onClick={() => setSchedulePanelVisible(false)}>
                <X size={16} />
              </button>
            </div>
          </div>

          {scheduleFormOpen ? (
            <form className="schedule-form" onSubmit={(event) => void submitSchedule(event)}>
              <div className="schedule-kind">
                <button
                  className={scheduleForm.kind === 'weekly' ? 'schedule-kind__option schedule-kind__option--active' : 'schedule-kind__option'}
                  type="button"
                  onClick={() => updateScheduleForm({ kind: 'weekly' })}
                >
                  {tr('schedule.weekly')}
                </button>
                <button
                  className={scheduleForm.kind === 'one-time' ? 'schedule-kind__option schedule-kind__option--active' : 'schedule-kind__option'}
                  type="button"
                  onClick={() => updateScheduleForm({ kind: 'one-time' })}
                >
                  {tr('schedule.oneTime')}
                </button>
              </div>
              <input
                value={scheduleForm.text}
                onChange={(event) => updateScheduleForm({ text: event.target.value })}
                placeholder={tr('schedule.text')}
              />
              <div className="schedule-time">
                <input
                  max={23}
                  min={0}
                  placeholder={tr('schedule.hour')}
                  type="number"
                  value={scheduleForm.hour}
                  onChange={(event) => updateScheduleForm({ hour: event.target.value })}
                />
                <span>:</span>
                <input
                  max={59}
                  min={0}
                  placeholder={tr('schedule.minute')}
                  type="number"
                  value={scheduleForm.minute}
                  onChange={(event) => updateScheduleForm({ minute: event.target.value })}
                />
              </div>
              {scheduleForm.kind === 'weekly' ? (
                <div className="weekday-row">
                  <span className="weekday-row__label">{tr('schedule.weekly')}</span>
                  {weekdayOptions.map((weekday) => (
                    <button
                      className={
                        scheduleForm.weekdays.includes(weekday.value)
                          ? 'weekday-toggle weekday-toggle--active'
                          : 'weekday-toggle'
                      }
                      key={weekday.value}
                      type="button"
                      onClick={() => toggleScheduleWeekday(weekday.value)}
                    >
                      {weekday.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="schedule-date">
                  <input
                    max={9999}
                    min={1}
                    placeholder={tr('schedule.year')}
                    type="number"
                    value={scheduleForm.year}
                    onChange={(event) => updateScheduleForm({ year: event.target.value })}
                  />
                  <input
                    max={12}
                    min={1}
                    placeholder={tr('schedule.month')}
                    type="number"
                    value={scheduleForm.month}
                    onChange={(event) => updateScheduleForm({ month: event.target.value })}
                  />
                  <input
                    max={scheduleMaxDay}
                    min={1}
                    placeholder={tr('schedule.day')}
                    type="number"
                    value={scheduleForm.day}
                    onChange={(event) => updateScheduleForm({ day: event.target.value })}
                  />
                </div>
              )}
              {scheduleError ? <div className="schedule-error">{scheduleError}</div> : null}
              <div className="schedule-form__actions">
                <button className="icon-button" title={tr('schedule.save')} type="submit">
                  <Check size={16} />
                </button>
                <button className="icon-button" title={tr('schedule.cancel')} type="button" onClick={closeScheduleForm}>
                  <X size={16} />
                </button>
              </div>
            </form>
          ) : null}

          <div className="schedule-list">
            {schedules.length === 0 ? (
              <div className="empty-state">{tr('schedule.empty')}</div>
            ) : (
              schedules.map((rule) => (
                <article className={rule.enabled ? 'schedule-item' : 'schedule-item schedule-item--disabled'} key={rule.id}>
                  <div className="schedule-item__copy">
                    <span>{rule.text}</span>
                    <small>{formatScheduleSummary(rule, language)}</small>
                  </div>
                  <div className="schedule-item__actions">
                    <button className="icon-button" title={rule.enabled ? tr('schedule.disable') : tr('schedule.enable')} onClick={() => void toggleScheduleEnabled(rule)}>
                      <Power size={15} />
                    </button>
                    <button className="icon-button" title={tr('schedule.edit')} onClick={() => editSchedule(rule)}>
                      <Pencil size={15} />
                    </button>
                    <button className="icon-button" title={tr('menu.delete')} onClick={() => void deleteSchedule(rule)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : todoPanelVisible ? (
        <section
          className="todo-panel"
          aria-label={tr('todo.aria')}
          style={{ bottom: petBaseBottom + petBaseHeight * petUiScale + todoPetGap }}
        >
          <div className="todo-panel__top">
            <div className="todo-panel__heading">
              <span className="todo-panel__title">TODO</span>
              <span className="todo-panel__streak">
                <span key={streakPhase} className="todo-panel__streak-text">
                  {streakPhase === 'completed'
                    ? tr('todo.completedToday', { count: completedTodayCount })
                    : tr('todo.remainingToday', { count: remainingTodayCount })}
                </span>
              </span>
            </div>
            <button className="icon-button" title={tr('todo.add')} onClick={() => setComposerOpen(true)}>
              <Plus size={16} />
            </button>
          </div>

          {composerOpen ? (
            <form className="todo-composer" onSubmit={(event) => void submitTodo(event)}>
              <input
                autoFocus
                value={newTodoText}
                onChange={(event) => setNewTodoText(event.target.value)}
                placeholder={tr('todo.new')}
              />
              <button className="icon-button" title={tr('todo.save')} type="submit">
                <Check size={16} />
              </button>
              <button className="icon-button" title={tr('todo.cancel')} type="button" onClick={() => setComposerOpen(false)}>
                <X size={16} />
              </button>
            </form>
          ) : null}

          <div className="todo-list">
            {todos.length === 0 ? (
              <div className="empty-state">{tr('todo.empty')}</div>
            ) : (
              todoUnits.map((unit) => renderTodoUnit(unit))
            )}
          </div>
        </section>
      ) : null}
        </>
      )}

      <div
        className="pet-anchor"
        onContextMenu={openPetMenu}
        onPointerDown={startWindowDrag}
        onPointerEnter={() => setPetHovered(true)}
        onPointerLeave={() => setPetHovered(false)}
        style={{ width: 96 * petUiScale, height: 104 * petUiScale }}
      >
        {selectedPet ? (
          <PetSprite pet={selectedPet} scale={petUiScale} state={petState} />
        ) : (
          <div className="pet-placeholder">PET</div>
        )}
        <button
          className="ui-resize-handle pet-resize-handle"
          title={tr('ui.resize')}
          type="button"
          onPointerDown={startPetUiResize}
        />
      </div>
    </main>
  );
}

function getTagColor(tag: string): string {
  const palette = ['#2f6fed', '#d3455b', '#d89b18', '#2e8b57', '#b65ad8', '#e06c2f', '#1d9aa8', '#6d6af1'];
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) {
    hash = Math.imul(hash ^ tag.charCodeAt(index), 0x45d9f3b);
  }
  return palette[Math.abs(hash) % palette.length];
}

function PetSprite({ pet, scale, state }: { pet: PetPackage; scale: number; state: PetState }): ReactElement {
  const frame = useAnimationFrame(state);

  return (
    <div
      className="pet-sprite"
      title={pet.displayName}
      style={getPetSpriteStyle(state, frame, pet.spritesheetUrl ?? '', scale)}
    />
  );
}

function useAnimationFrame(state: PetState): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const spec = getAnimationSpec(state);
    setFrame(0);
    let disposed = false;
    let frameIndex = 0;
    let timer: number;

    const tick = (): void => {
      if (disposed) {
        return;
      }
      timer = window.setTimeout(() => {
        frameIndex = (frameIndex + 1) % spec.frameCount;
        setFrame(frameIndex);
        tick();
      }, spec.durations[frameIndex]);
    };

    tick();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [state]);

  return frame;
}

