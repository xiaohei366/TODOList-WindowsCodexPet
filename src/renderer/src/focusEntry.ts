import type { TodoItem } from '../../shared/types';

/**
 * A target for the focus panel. Reminders only ever produce `todo` targets,
 * but the focus panel can also be opened on a sub-task from the context menu,
 * so the queue stores both shapes.
 */
export type FocusTarget =
  | { kind: 'todo'; id: string }
  | { kind: 'subtask'; parentId: string; subTaskId: string };

export type FocusState = {
  current: FocusTarget | null;
  queue: FocusTarget[];
};

export type EnterFocusRequest = {
  target: FocusTarget;
  force?: boolean;
  exists: boolean;
};

/** Stable identity for a focus target, used for de-duplication. */
export function focusKey(target: FocusTarget): string {
  return target.kind === 'todo' ? target.id : target.subTaskId;
}

/**
 * Decides whether a focus target still refers to an incomplete todo/sub-task.
 * Stale entries (deleted or already completed while waiting in the queue) are
 * skipped when the queue drains.
 */
export function isFocusTargetValid(target: FocusTarget, todos: TodoItem[]): boolean {
  if (target.kind === 'todo') {
    const item = todos.find((t) => t.id === target.id);
    return !!item && !item.completed;
  }
  const parent = todos.find((t) => t.id === target.parentId);
  const sub = parent?.subTasks.find((s) => s.id === target.subTaskId);
  return !!sub && !sub.completed;
}

/**
 * Computes the next focus state after an enter-focus request.
 *
 * "Blocking queue" semantics:
 * - A target that no longer exists never enters.
 * - If nothing is focused, the target is focused immediately.
 * - If the target is already focused, nothing changes.
 * - A scheduled reminder (force=false) firing while another todo is focused
 *   is appended to the queue tail instead of being dropped.
 * - A notification click (force=true) takes over focus immediately; the
 *   interrupted target is returned to the head of the queue so it resumes
 *   next. The target is also removed from the queue if already queued.
 */
export function applyEnterFocusRequest(state: FocusState, request: EnterFocusRequest): FocusState {
  if (!request.exists) {
    return state;
  }

  const key = focusKey(request.target);

  // Already focused - nothing to do.
  if (state.current && focusKey(state.current) === key) {
    return state;
  }

  const alreadyQueued = state.queue.some((t) => focusKey(t) === key);

  if (state.current === null) {
    // Not focused: focus immediately. Drop a stale queued entry if present.
    return {
      current: request.target,
      queue: alreadyQueued ? state.queue.filter((t) => focusKey(t) !== key) : state.queue
    };
  }

  if (request.force) {
    // Take over: current goes back to the head, target removed from queue if present.
    const queue = alreadyQueued ? state.queue.filter((t) => focusKey(t) !== key) : state.queue;
    return { current: request.target, queue: [state.current, ...queue] };
  }

  // Scheduled reminder while focused: queue at the tail. No-op if already queued
  // (preserves the original queue order).
  if (alreadyQueued) {
    return state;
  }
  return { current: state.current, queue: [...state.queue, request.target] };
}
