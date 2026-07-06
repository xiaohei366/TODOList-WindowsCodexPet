export const mouseInputSelector = '.todo-panel, .pet-anchor, .ui-resize-handle, .focus-panel';

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

export function shouldIgnoreWindowMouseEvents(target: EventTarget | null, inputCaptured: boolean): boolean {
  if (inputCaptured) {
    return false;
  }
  if (!hasClosest(target)) {
    return true;
  }
  return !target.closest(mouseInputSelector);
}

function hasClosest(target: EventTarget | null): target is EventTarget & ClosestTarget {
  return Boolean(target && typeof (target as { closest?: unknown }).closest === 'function');
}
