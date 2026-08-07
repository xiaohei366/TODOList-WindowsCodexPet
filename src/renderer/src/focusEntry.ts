import type { EnterTodoFocusPayload } from '../../shared/types';

/**
 * Decides whether an incoming ui:enterTodoFocus event may take over the focus
 * panel. A reminder firing on schedule (force=false) never interrupts an
 * active focus session; an explicit notification click (force=true) always
 * does. Stale ids (the todo list changed since the reminder fired) never enter.
 */
export function shouldEnterTodoFocus(
  payload: EnterTodoFocusPayload,
  isFocusing: boolean,
  todoExists: boolean
): boolean {
  if (!todoExists) {
    return false;
  }
  if (isFocusing && !payload.force) {
    return false;
  }
  return true;
}
