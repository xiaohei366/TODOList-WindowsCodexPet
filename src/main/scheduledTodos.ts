import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ImportResult, ScheduledTodoInput, ScheduledTodoRule } from '../shared/types';
import { formatDateKey } from './todoStore';

const scheduleDocumentVersion = 1;
const defaultWeekdays = [1, 2, 3, 4, 5];

type ScheduleDocument = {
  version: 1;
  rules: ScheduledTodoRule[];
};

export type ScheduledTodoAdder = {
  add(text: string, deadline?: string): Promise<unknown>;
};

export class ScheduledTodoStore {
  constructor(
    private readonly filePath: string,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async list(): Promise<ScheduledTodoRule[]> {
    return (await this.readDocument()).rules;
  }

  async create(input: ScheduledTodoInput): Promise<ScheduledTodoRule> {
    const now = this.clock().toISOString();
    const rule = this.normalizeInput(input, {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    });
    const document = await this.readDocument();
    document.rules.push(rule);
    await this.writeDocument(document);
    return rule;
  }

  async update(id: string, input: ScheduledTodoInput): Promise<ScheduledTodoRule> {
    const document = await this.readDocument();
    const existing = document.rules.find((rule) => rule.id === id);
    if (!existing) {
      throw new Error('定时规则不存在。');
    }
    const updated = this.normalizeInput(input, {
      id,
      createdAt: existing.createdAt,
      updatedAt: this.clock().toISOString(),
      lastGeneratedDate: existing.lastGeneratedDate,
      fired: existing.kind === 'one-time' ? existing.fired : undefined
    });
    document.rules = document.rules.map((rule) => (rule.id === id ? updated : rule));
    await this.writeDocument(document);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const document = await this.readDocument();
    const next = document.rules.filter((rule) => rule.id !== id);
    if (next.length === document.rules.length) {
      throw new Error('定时规则不存在。');
    }
    await this.writeDocument({ ...document, rules: next });
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTodoRule> {
    const document = await this.readDocument();
    const target = document.rules.find((rule) => rule.id === id);
    if (!target) {
      throw new Error('定时规则不存在。');
    }
    const updated = { ...target, enabled, updatedAt: this.clock().toISOString() } as ScheduledTodoRule;
    document.rules = document.rules.map((rule) => (rule.id === id ? updated : rule));
    await this.writeDocument(document);
    return updated;
  }

  async markGenerated(id: string, date: string): Promise<ScheduledTodoRule> {
    const document = await this.readDocument();
    const target = document.rules.find((rule) => rule.id === id);
    if (!target) {
      throw new Error('定时规则不存在。');
    }
    const updated = {
      ...target,
      lastGeneratedDate: date,
      fired: target.kind === 'one-time' ? true : undefined
    } as ScheduledTodoRule;
    document.rules = document.rules.map((rule) => (rule.id === id ? updated : rule));
    await this.writeDocument(document);
    return updated;
  }

  async exportJson(targetPath: string): Promise<void> {
    await this.ensureFile();
    await copyFile(this.filePath, targetPath);
  }

  async readSourceContent(): Promise<string> {
    await this.ensureFile();
    try {
      return await readFile(this.filePath, 'utf8');
    } catch {
      return '[]';
    }
  }

  async importJson(importPath: string): Promise<ImportResult> {
    const content = await readFile(importPath, 'utf8');
    return this.importJsonFromContent(content);
  }

  async importJsonFromContent(content: string): Promise<ImportResult> {
    const imported = parseScheduleDocument(content).rules.map(normalizeStoredRule);
    const document = await this.readDocument();
    const next = [...document.rules];
    const semanticKeys = new Set(next.map(semanticScheduleKey));
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const rule of imported) {
      const idIndex = next.findIndex((existing) => existing.id === rule.id);
      if (idIndex >= 0) {
        if (new Date(rule.updatedAt).getTime() > new Date(next[idIndex].updatedAt).getTime()) {
          next[idIndex] = rule;
          semanticKeys.add(semanticScheduleKey(rule));
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const semanticKey = semanticScheduleKey(rule);
      if (semanticKeys.has(semanticKey)) {
        skipped += 1;
        continue;
      }

      next.push(rule);
      semanticKeys.add(semanticKey);
      added += 1;
    }

    await this.writeDocument({ version: scheduleDocumentVersion, rules: next });
    return { added, updated, skipped };
  }

  private normalizeInput(
    input: ScheduledTodoInput,
    metadata: {
      id: string;
      createdAt: string;
      updatedAt: string;
      lastGeneratedDate?: string;
      fired?: boolean;
    }
  ): ScheduledTodoRule {
    const text = cleanScheduleText(input.text);
    if (!text) {
      throw new Error('TODO 内容必填。');
    }
    const hour = normalizeTimePart(input.hour, 0, 23, '小时需为 0-23。');
    const minute = normalizeTimePart(input.minute, 0, 59, '分钟需为 0-59。');
    const deadlineDays = normalizeDeadlineDays(input.deadlineDays);

    if (input.kind === 'weekly') {
      return withoutUndefined({
        id: metadata.id,
        kind: 'weekly',
        enabled: input.enabled ?? true,
        text,
        hour,
        minute,
        weekdays: normalizeWeekdays(input.weekdays),
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        lastGeneratedDate: metadata.lastGeneratedDate,
        deadlineDays
      }) as ScheduledTodoRule;
    }

    return withoutUndefined({
      id: metadata.id,
      kind: 'one-time',
      enabled: input.enabled ?? true,
      text,
      hour,
      minute,
      date: normalizeOneTimeDate(input, this.clock()),
      fired: metadata.fired,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      lastGeneratedDate: metadata.lastGeneratedDate,
      deadlineDays
    }) as ScheduledTodoRule;
  }

  private async readDocument(): Promise<ScheduleDocument> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return {
        version: scheduleDocumentVersion,
        rules: parseScheduleDocument(content).rules.map(normalizeStoredRule)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: scheduleDocumentVersion, rules: [] };
      }
      throw error;
    }
  }

  private async writeDocument(document: ScheduleDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const normalized = {
      version: scheduleDocumentVersion,
      rules: document.rules.map(normalizeStoredRule)
    };
    await writeFile(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  }

  private async ensureFile(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await this.writeDocument({ version: scheduleDocumentVersion, rules: [] });
    }
  }
}

export async function runDueScheduledTodos(
  store: ScheduledTodoStore,
  todoAdder: ScheduledTodoAdder,
  now = new Date()
): Promise<number> {
  const todayKey = formatDateKey(now);
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const todayWeekday = toScheduleWeekday(now);
  let generated = 0;

  for (const rule of await store.list()) {
    if (!rule.enabled || rule.lastGeneratedDate === todayKey || rule.hour * 60 + rule.minute > currentMinute) {
      continue;
    }

    const due =
      rule.kind === 'weekly'
        ? rule.weekdays.includes(todayWeekday)
        : !rule.fired && rule.date === todayKey;
    if (!due) {
      continue;
    }

    const deadline = rule.deadlineDays
      ? formatDateKey(addDays(now, rule.deadlineDays))
      : undefined;
    await todoAdder.add(rule.text, deadline);
    if (rule.kind === 'one-time') {
      await store.delete(rule.id);
    } else {
      await store.markGenerated(rule.id, todayKey);
    }
    generated += 1;
  }

  return generated;
}

export function getNextScheduledRunDate(rules: ScheduledTodoRule[], now = new Date()): Date | null {
  const candidates = rules.flatMap((rule) => getRuleRunCandidates(rule, now));
  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0];
}

function getRuleRunCandidates(rule: ScheduledTodoRule, now: Date): Date[] {
  if (!rule.enabled) {
    return [];
  }
  if (rule.kind === 'one-time') {
    if (rule.fired) {
      return [];
    }
    const candidate = dateAtLocalTime(rule.date, rule.hour, rule.minute);
    return candidate.getTime() > now.getTime() ? [candidate] : [];
  }

  const candidates: Date[] = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, rule.hour, rule.minute);
    if (candidate.getTime() <= now.getTime()) {
      continue;
    }
    if (rule.weekdays.includes(toScheduleWeekday(candidate))) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function parseScheduleDocument(content: string): ScheduleDocument {
  const parsed = JSON.parse(content || '{"version":1,"rules":[]}') as unknown;
  if (Array.isArray(parsed)) {
    return { version: scheduleDocumentVersion, rules: parsed as ScheduledTodoRule[] };
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { rules?: unknown }).rules)) {
    throw new Error('定时 TODO JSON 无效。');
  }
  return { version: scheduleDocumentVersion, rules: (parsed as { rules: ScheduledTodoRule[] }).rules };
}

function normalizeStoredRule(rule: ScheduledTodoRule): ScheduledTodoRule {
  if (!rule || typeof rule !== 'object') {
    throw new Error('定时规则无效。');
  }
  const base = {
    id: String(rule.id || randomUUID()),
    enabled: rule.enabled !== false,
    text: cleanScheduleText(rule.text),
    hour: normalizeTimePart(rule.hour, 0, 23, '小时需为 0-23。'),
    minute: normalizeTimePart(rule.minute, 0, 59, '分钟需为 0-59。'),
    createdAt: normalizeIso(rule.createdAt),
    updatedAt: normalizeIso(rule.updatedAt),
    lastGeneratedDate: rule.lastGeneratedDate,
    deadlineDays: normalizeDeadlineDays(rule.deadlineDays)
  };
  if (!base.text) {
    throw new Error('TODO 内容必填。');
  }

  if (rule.kind === 'weekly') {
    return withoutUndefined({
      ...base,
      kind: 'weekly',
      weekdays: normalizeWeekdays(rule.weekdays)
    }) as ScheduledTodoRule;
  }
  if (rule.kind === 'one-time') {
    return withoutUndefined({
      ...base,
      kind: 'one-time',
      date: normalizeDateKey(rule.date),
      fired: Boolean(rule.fired)
    }) as ScheduledTodoRule;
  }
  throw new Error('定时类型无效。');
}

function normalizeTimePart(value: number | null | undefined, min: number, max: number, rangeMessage: string): number {
  if (value === null || value === undefined) {
    throw new Error('定时时间必填。');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(rangeMessage);
  }
  return parsed;
}

function normalizeDeadlineDays(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9999) {
    throw new Error('截止天数需为 1-9999。');
  }
  return parsed;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function normalizeWeekdays(weekdays: number[] | undefined): number[] {
  const normalized = Array.from(
    new Set((weekdays && weekdays.length > 0 ? weekdays : defaultWeekdays).filter((day) => Number.isInteger(day)))
  )
    .filter((day) => day >= 1 && day <= 7)
    .sort((left, right) => left - right);
  return normalized.length > 0 ? normalized : defaultWeekdays;
}

function normalizeOneTimeDate(input: ScheduledTodoInput, now: Date): string {
  if (input.date) {
    return normalizeDateKey(input.date);
  }
  const year = input.year ?? now.getFullYear();
  const month = input.month ?? now.getMonth() + 1;
  const day = input.day ?? now.getDate();
  return normalizeDateKey(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

function normalizeDateKey(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('定时日期无效。');
  }
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new Error('定时日期无效。');
  }
  return date;
}

function normalizeIso(value: string | undefined): string {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return new Date().toISOString();
  }
  return value;
}

function cleanScheduleText(text: string): string {
  return String(text ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function semanticScheduleKey(rule: ScheduledTodoRule): string {
  const base = [rule.kind, rule.text, String(rule.hour), String(rule.minute)];
  if (rule.kind === 'weekly') {
    base.push(rule.weekdays.join(','));
  } else {
    base.push(rule.date);
  }
  return base.join('\0');
}

function dateAtLocalTime(dateKey: string, hour: number, minute: number): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function toScheduleWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
