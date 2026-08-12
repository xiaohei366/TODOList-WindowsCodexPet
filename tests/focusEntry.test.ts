import { describe, expect, test } from 'vitest';
import {
  applyEnterFocusRequest,
  focusKey,
  isFocusTargetValid,
  type FocusState,
  type FocusTarget
} from '../src/renderer/src/focusEntry';
import type { TodoItem } from '../src/shared/types';

const todo = (id: string): TodoItem => ({
  id,
  date: '2026-08-12',
  text: id,
  completed: false,
  highlighted: false,
  overdue: false,
  sourceLine: 0,
  notes: '',
  subTasks: []
});

const target = (id: string): FocusTarget => ({ kind: 'todo', id });

const state = (current: FocusTarget | null = null, queue: FocusTarget[] = []): FocusState => ({
  current,
  queue
});

describe('applyEnterFocusRequest', () => {
  test('a scheduled reminder enters focus when nothing is being focused', () => {
    const next = applyEnterFocusRequest(state(), { target: target('a'), exists: true });
    expect(next).toEqual(state(target('a')));
  });

  test('a scheduled reminder is queued when another todo is already focused', () => {
    const next = applyEnterFocusRequest(state(target('a')), { target: target('b'), exists: true });
    expect(next).toEqual(state(target('a'), [target('b')]));
  });

  test('multiple reminders queue in arrival order', () => {
    let s = applyEnterFocusRequest(state(target('a')), { target: target('b'), exists: true });
    s = applyEnterFocusRequest(s, { target: target('c'), exists: true });
    expect(s).toEqual(state(target('a'), [target('b'), target('c')]));
  });

  test('a notification click (force) takes over and returns the current target to the queue head', () => {
    const s = state(target('a'), [target('b'), target('c')]);
    const next = applyEnterFocusRequest(s, { target: target('d'), force: true, exists: true });
    expect(next).toEqual(state(target('d'), [target('a'), target('b'), target('c')]));
  });

  test('a target already focused is a no-op', () => {
    const s = state(target('a'), [target('b')]);
    const next = applyEnterFocusRequest(s, { target: target('a'), exists: true });
    expect(next).toBe(s);
  });

  test('a target already queued is not queued twice and keeps its place', () => {
    const s = state(target('a'), [target('b'), target('c')]);
    const next = applyEnterFocusRequest(s, { target: target('b'), exists: true });
    expect(next).toBe(s);
  });

  test('a force click on a queued target removes it from the queue and focuses it', () => {
    const s = state(target('a'), [target('b'), target('c')]);
    const next = applyEnterFocusRequest(s, { target: target('c'), force: true, exists: true });
    expect(next).toEqual(state(target('c'), [target('a'), target('b')]));
  });

  test('a target that no longer exists never enters, even with force', () => {
    const s = state(target('a'), [target('b')]);
    expect(applyEnterFocusRequest(s, { target: target('gone'), exists: false })).toBe(s);
    expect(applyEnterFocusRequest(s, { target: target('gone'), force: true, exists: false })).toBe(s);
  });
});

describe('isFocusTargetValid', () => {
  test('true for an existing incomplete todo', () => {
    expect(isFocusTargetValid(target('a'), [todo('a')])).toBe(true);
  });

  test('false for a completed todo', () => {
    const item = todo('a');
    item.completed = true;
    expect(isFocusTargetValid(target('a'), [item])).toBe(false);
  });

  test('false for a missing todo', () => {
    expect(isFocusTargetValid(target('a'), [])).toBe(false);
  });

  test('true for an incomplete sub-task', () => {
    const parent = todo('p');
    parent.subTasks = [{ id: 's', text: 's', completed: false }];
    expect(isFocusTargetValid({ kind: 'subtask', parentId: 'p', subTaskId: 's' }, [parent])).toBe(true);
  });

  test('false for a completed sub-task', () => {
    const parent = todo('p');
    parent.subTasks = [{ id: 's', text: 's', completed: true }];
    expect(isFocusTargetValid({ kind: 'subtask', parentId: 'p', subTaskId: 's' }, [parent])).toBe(false);
  });
});

describe('focusKey', () => {
  test('uses id for todo targets', () => {
    expect(focusKey(target('a'))).toBe('a');
  });

  test('uses subTaskId for subtask targets', () => {
    expect(focusKey({ kind: 'subtask', parentId: 'p', subTaskId: 's' })).toBe('s');
  });
});
