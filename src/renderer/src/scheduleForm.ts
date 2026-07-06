import type { ScheduledTodoInput, ScheduledTodoRule } from '../../shared/types';
import { type AppLanguage, defaultLanguage, t } from '../../shared/i18n';

export const weekdayOptions = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' }
];

export type ScheduleFormState = {
  kind: 'weekly' | 'one-time';
  enabled: boolean;
  text: string;
  hour: string;
  minute: string;
  weekdays: number[];
  year: string;
  month: string;
  day: string;
};

export function createEmptyScheduleForm(): ScheduleFormState {
  return {
    kind: 'weekly',
    enabled: true,
    text: '',
    hour: '',
    minute: '',
    weekdays: [1, 2, 3, 4, 5],
    year: '',
    month: '',
    day: ''
  };
}

export function createDefaultScheduleForm(now = new Date()): ScheduleFormState {
  return {
    ...createEmptyScheduleForm(),
    hour: String(now.getHours()).padStart(2, '0'),
    minute: String(now.getMinutes()).padStart(2, '0'),
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0')
  };
}

export function scheduleRuleToForm(rule: ScheduledTodoRule): ScheduleFormState {
  const dateParts = rule.kind === 'one-time' ? rule.date.split('-') : ['', '', ''];
  return {
    kind: rule.kind,
    enabled: rule.enabled,
    text: rule.text,
    hour: String(rule.hour).padStart(2, '0'),
    minute: String(rule.minute).padStart(2, '0'),
    weekdays: rule.kind === 'weekly' ? rule.weekdays : [1, 2, 3, 4, 5],
    year: dateParts[0],
    month: dateParts[1],
    day: dateParts[2]
  };
}

export function buildScheduleInput(
  form: ScheduleFormState,
  now = new Date(),
  language: AppLanguage = defaultLanguage
): ScheduledTodoInput {
  const text = form.text.trim();
  if (!text) {
    throw new Error(t(language, 'validation.todoRequired'));
  }
  const hour = parseRequiredNumber(form.hour, 0, 23, t(language, 'validation.hourRange'));
  const minute = parseRequiredNumber(form.minute, 0, 59, t(language, 'validation.minuteRange'));

  if (form.kind === 'weekly') {
    return {
      kind: 'weekly',
      enabled: form.enabled,
      text,
      hour,
      minute,
      weekdays: form.weekdays.length > 0 ? form.weekdays : [1, 2, 3, 4, 5]
    };
  }

  const year = parseOptionalNumber(form.year, 1, 9999, t(language, 'validation.invalidYear'));
  const month = parseOptionalNumber(form.month, 1, 12, t(language, 'validation.monthRange'));
  const resolvedYear = year ?? now.getFullYear();
  const resolvedMonth = month ?? now.getMonth() + 1;
  const maxDay = daysInMonth(resolvedYear, resolvedMonth);
  const day = parseOptionalNumber(form.day, 1, maxDay, t(language, 'validation.dayRange', { max: maxDay }));

  return {
    kind: 'one-time',
    enabled: form.enabled,
    text,
    hour,
    minute,
    year,
    month,
    day
  };
}

export function getScheduleFormMaxDay(form: ScheduleFormState, now = new Date()): number {
  const year = parseOptionalDatePart(form.year, 1, 9999) ?? now.getFullYear();
  const month = parseOptionalDatePart(form.month, 1, 12) ?? now.getMonth() + 1;
  return daysInMonth(year, month);
}

export type DeadlineFormParts = { year: string; month: string; day: string };

/**
 * Computes the maximum valid day for the deadline form's current year/month
 * inputs, mirroring {@link getScheduleFormMaxDay} so the day field can clamp
 * its `max` attribute.
 */
export function getDeadlineFormMaxDay(parts: DeadlineFormParts, now = new Date()): number {
  const year = parseOptionalDatePart(parts.year, 1, 9999) ?? now.getFullYear();
  const month = parseOptionalDatePart(parts.month, 1, 12) ?? now.getMonth() + 1;
  return daysInMonth(year, month);
}

/**
 * Validates the year/month/day parts of a TODO (or sub-task) deadline form and
 * returns a normalized `YYYY-MM-DD` string, or `undefined` when all fields are
 * empty (meaning "clear the deadline"). Throws an Error with an i18n message on
 * invalid input, applying the same range and calendar checks as
 * {@link buildScheduleInput}.
 */
export function buildDeadlineInput(
  parts: DeadlineFormParts,
  now = new Date(),
  language: AppLanguage = defaultLanguage
): string | undefined {
  const year = parts.year.trim();
  const month = parts.month.trim();
  const day = parts.day.trim();
  if (!year && !month && !day) {
    return undefined;
  }
  if (!year || !month || !day) {
    throw new Error(t(language, 'validation.dateRequired'));
  }
  const y = parseRequiredNumber(year, 1, 9999, t(language, 'validation.invalidYear'));
  const m = parseRequiredNumber(month, 1, 12, t(language, 'validation.monthRange'));
  const maxDay = daysInMonth(y, m);
  const d = parseRequiredNumber(day, 1, maxDay, t(language, 'validation.dayRange', { max: maxDay }));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatScheduleSummary(rule: ScheduledTodoRule, language: AppLanguage = defaultLanguage): string {
  const time = `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`;
  if (rule.kind === 'one-time') {
    return `${rule.date} ${time}`;
  }
  return `${t(language, 'schedule.weeklyPrefix')} ${rule.weekdays.map((day) => weekdayOptions.find((weekday) => weekday.value === day)?.label ?? day).join('')} ${time}`;
}

function parseRequiredNumber(value: string, min: number, max: number, message: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(message);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(message);
  }
  return parsed;
}

function parseOptionalNumber(value: string, min: number, max: number, message: string): number | null {
  if (!value.trim()) {
    return null;
  }
  return parseRequiredNumber(value, min, max, message);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseOptionalDatePart(value: string, min: number, max: number): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}
