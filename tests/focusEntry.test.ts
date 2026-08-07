import { describe, expect, test } from 'vitest';
import { shouldEnterTodoFocus } from '../src/renderer/src/focusEntry';

describe('shouldEnterTodoFocus', () => {
  test('a scheduled reminder enters focus when nothing is being focused', () => {
    expect(shouldEnterTodoFocus({ id: 'a' }, false, true)).toBe(true);
  });

  test('a scheduled reminder does not interrupt an active focus session', () => {
    expect(shouldEnterTodoFocus({ id: 'b' }, true, true)).toBe(false);
  });

  test('a notification click (force) overrides an active focus session', () => {
    expect(shouldEnterTodoFocus({ id: 'b', force: true }, true, true)).toBe(true);
  });

  test('a stale id never enters, even with force', () => {
    expect(shouldEnterTodoFocus({ id: 'gone' }, false, false)).toBe(false);
    expect(shouldEnterTodoFocus({ id: 'gone', force: true }, true, false)).toBe(false);
  });
});
