import { describe, expect, test } from 'vitest';
import {
  buildDeadlineInput,
  buildScheduleInput,
  createDefaultScheduleForm,
  createEmptyScheduleForm,
  formatScheduleSummary,
  getDeadlineFormMaxDay,
  getScheduleFormMaxDay,
  weekdayOptions
} from '../src/renderer/src/scheduleForm';

describe('schedule form helpers', () => {
  test('uses numeric weekday labels for the compact weekday picker', () => {
    expect(weekdayOptions.map((weekday) => weekday.label)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  test('rejects impossible calendar dates before sending schedule input', () => {
    const form = {
      ...createEmptyScheduleForm(),
      kind: 'one-time' as const,
      text: 'Leap day check',
      hour: '9',
      minute: '30',
      year: '2026',
      month: '2',
      day: '29'
    };

    expect(() => buildScheduleInput(form)).toThrow('日期需为 1-28。');
  });

  test('rejects out-of-range schedule time', () => {
    expect(() =>
      buildScheduleInput({ ...createEmptyScheduleForm(), text: 'Bad hour', hour: '24', minute: '0' })
    ).toThrow('小时需为 0-23。');
    expect(() =>
      buildScheduleInput({ ...createEmptyScheduleForm(), text: 'Bad minute', hour: '23', minute: '60' })
    ).toThrow('分钟需为 0-59。');
  });

  test('computes max day from the selected year and month', () => {
    expect(getScheduleFormMaxDay({ ...createEmptyScheduleForm(), year: '2026', month: '2' })).toBe(28);
    expect(getScheduleFormMaxDay({ ...createEmptyScheduleForm(), year: '2028', month: '2' })).toBe(29);
  });

  test('defaults new schedule forms to the current local date and time', () => {
    expect(createDefaultScheduleForm(new Date(2026, 4, 28, 16, 7))).toMatchObject({
      hour: '16',
      minute: '07',
      year: '2026',
      month: '05',
      day: '28'
    });
  });

  test('prefixes weekly schedule summaries with Chinese weekly text', () => {
    expect(
      formatScheduleSummary({
        id: 'rule',
        kind: 'weekly',
        enabled: true,
        text: 'Daily',
        hour: 9,
        minute: 5,
        weekdays: [1, 2, 3],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z'
      })
    ).toBe('每周 123 09:05');
  });

  test('formats schedule summaries and validation messages in English', () => {
    expect(
      formatScheduleSummary(
        {
          id: 'rule',
          kind: 'weekly',
          enabled: true,
          text: 'Daily',
          hour: 9,
          minute: 5,
          weekdays: [1, 2, 3],
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z'
        },
        'en-US'
      )
    ).toBe('Weekly 123 09:05');

    expect(() =>
      buildScheduleInput({ ...createEmptyScheduleForm(), text: 'Bad minute', hour: '23', minute: '60' }, new Date(), 'en-US')
    ).toThrow('Minute must be 0-59.');
  });

  test('does not show a done suffix for one-time schedule summaries', () => {
    expect(
      formatScheduleSummary({
        id: 'rule',
        kind: 'one-time',
        enabled: true,
        text: 'Submit report',
        hour: 15,
        minute: 30,
        date: '2026-05-28',
        fired: true,
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z'
      })
    ).toBe('2026-05-28 15:30');
  });
});

describe('deadline form helpers', () => {
  test('returns undefined when all date parts are empty (clears the deadline)', () => {
    expect(buildDeadlineInput({ year: '', month: '', day: '' })).toBeUndefined();
  });

  test('normalizes a valid date into a zero-padded YYYY-MM-DD string', () => {
    expect(buildDeadlineInput({ year: '2026', month: '4', day: '9' })).toBe('2026-04-09');
  });

  test('rejects partial date input with a dateRequired message', () => {
    expect(() => buildDeadlineInput({ year: '2026', month: '', day: '9' })).toThrow('请填写完整的年、月、日。');
    expect(() => buildDeadlineInput({ year: '2026', month: '4', day: '' })).toThrow('请填写完整的年、月、日。');
  });

  test('rejects impossible calendar dates for the deadline', () => {
    expect(() => buildDeadlineInput({ year: '2026', month: '2', day: '29' })).toThrow('日期需为 1-28。');
    expect(() => buildDeadlineInput({ year: '2026', month: '13', day: '1' })).toThrow('月份需为 1-12。');
  });

  test('reports deadline validation errors in English', () => {
    expect(() => buildDeadlineInput({ year: '2026', month: '2', day: '29' }, new Date(), 'en-US')).toThrow(
      'Day must be 1-28.'
    );
    expect(() => buildDeadlineInput({ year: '2026', month: '', day: '9' }, new Date(), 'en-US')).toThrow(
      'Please fill in the full year, month, and day.'
    );
  });

  test('computes max day for the deadline form from year and month', () => {
    expect(getDeadlineFormMaxDay({ year: '2026', month: '2', day: '' })).toBe(28);
    expect(getDeadlineFormMaxDay({ year: '2028', month: '2', day: '' })).toBe(29);
    expect(getDeadlineFormMaxDay({ year: '', month: '', day: '' }, new Date(2026, 0, 15))).toBe(31);
  });
});
