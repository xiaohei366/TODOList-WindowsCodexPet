import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ImportResult, TodoItem, TodoSubTask } from '../shared/types';

type ParsedTodo = TodoItem & {
  order: number;
};

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function selectVisibleTodos(items: TodoItem[], todayKey: string): TodoItem[] {
  const withOverdue = items.map((item) => ({
    ...item,
    overdue: !item.completed && item.date < todayKey
  }));
  const active = withOverdue
    .filter((item) => !item.completed && (item.overdue || item.date === todayKey))
    .sort((left, right) => compareVisibleActiveTodos(left, right, todayKey));
  const completedToday = withOverdue.filter(
    (item) => item.completed && (item.completedDate ?? item.date) === todayKey
  );
  return [...active, ...completedToday];
}

export function parseTodoMarkdown(content: string, todayKey: string): ParsedTodo[] {
  const lines = content.split(/\r?\n/);
  const items: ParsedTodo[] = [];
  let currentDate: string | undefined;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const heading = /^###\s+(\d{4}-\d{2}-\d{2})(?:\s+.*)?$/.exec(line.trim());
    if (heading) {
      currentDate = heading[1];
      index += 1;
      continue;
    }

    if (!currentDate) {
      index += 1;
      continue;
    }

    const todo = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (!todo) {
      index += 1;
      continue;
    }

    const completed = todo[1].toLowerCase() === 'x';
    const parsed = parseTodoBody(todo[2], completed);
    const sourceLine = index + 1;
    const order = items.length;

    // Collect sub-task lines (indented checkbox: "  - [ ] xxx" / "  - [x] xxx")
    const subTasks: TodoSubTask[] = [];
    let subIndex = index + 1;
    while (subIndex < lines.length) {
      const subMatch = /^  - \[([ xX])\] (.+)$/.exec(lines[subIndex]);
      if (subMatch) {
        const subCompleted = subMatch[1].toLowerCase() === 'x';
        const subParsed = parseTodoBody(subMatch[2], subCompleted);
        subTasks.push({
          id: `${createTodoId(currentDate, sourceLine, parsed.text, completed, parsed.highlighted)}::${subTasks.length}`,
          text: subParsed.text,
          completed: subCompleted,
          completedDate: subParsed.completedDate,
          deadline: subParsed.deadline,
          displayOrder: subTasks.length + 1
        });
        subIndex += 1;
      } else {
        break;
      }
    }

    // Collect note lines (indented plain text: "  - note text", no checkbox)
    const noteLines: string[] = [];
    let noteIndex = subIndex;
    while (noteIndex < lines.length) {
      const noteMatch = /^  - (.+)$/.exec(lines[noteIndex]);
      if (noteMatch) {
        noteLines.push(noteMatch[1].trim());
        noteIndex += 1;
      } else {
        break;
      }
    }

    items.push({
      id: createTodoId(currentDate, sourceLine, parsed.text, completed, parsed.highlighted),
      date: currentDate,
      text: parsed.text,
      completed,
      completedDate: parsed.completedDate,
      highlighted: parsed.highlighted,
      displayOrder: parsed.displayOrder,
      overdue: !completed && currentDate < todayKey,
      sourceLine,
      order,
      notes: noteLines.join('\n'),
      deadline: parsed.deadline,
      tag: parsed.tag,
      subTasks
    });

    index = noteIndex;
  }

  return items;
}

export function renderTodoMarkdown(items: TodoItem[]): string {
  const sortedDates = Array.from(new Set(items.map((item) => item.date))).sort();
  const lines: string[] = [];

  let renderedYear = '';
  let renderedMonth = '';

  for (const date of sortedDates) {
    const year = date.slice(0, 4);
    const month = date.slice(0, 7);
    const dayItems = items.filter((item) => item.date === date);
    const orderedDayItems = [
      ...dayItems.filter((item) => !item.completed),
      ...dayItems.filter((item) => item.completed)
    ];

    if (renderedYear !== year) {
      if (lines.length > 0 && lines.at(-1) !== '') {
        lines.push('');
      }
      lines.push(`# ${year}`, '');
      renderedYear = year;
      renderedMonth = '';
    }

    if (renderedMonth !== month) {
      lines.push(`## ${month}`, '');
      renderedMonth = month;
    }

    lines.push(`### ${date} ${weekdayName(date)}`, '');
    for (const item of orderedDayItems) {
      lines.push(formatTodoLine(item));
      for (const sub of item.subTasks) {
        lines.push(formatSubTaskLine(sub));
      }
      if (item.notes) {
        for (const note of item.notes.split('\n')) {
          lines.push(`  - ${note}`);
        }
      }
    }
    lines.push('');
  }

  return lines.length === 0 ? '' : lines.join('\n');
}

export class TodoMarkdownStore {
  constructor(
    private readonly filePath: string,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async list(): Promise<TodoItem[]> {
    return selectVisibleTodos(await this.listAll(), formatDateKey(this.clock()));
  }

  async listAll(): Promise<TodoItem[]> {
    return this.readItems();
  }

  async add(text: string, deadline?: string): Promise<TodoItem> {
    const cleaned = cleanTodoText(text);
    if (!cleaned) {
      throw new Error('Todo text is required.');
    }

    const date = formatDateKey(this.clock());
    const items = await this.readItems();
    items.push({
      id: '',
      date,
      text: cleaned,
      completed: false,
      highlighted: false,
      overdue: false,
      sourceLine: 0,
      order: items.length,
      notes: '',
      tag: undefined,
      subTasks: [],
      deadline: deadline || undefined
    });
    await this.writeItems(items);
    const updated = await this.readItems();
    const created = [...updated].reverse().find((item) => item.date === date && item.text === cleaned);
    if (!created) {
      throw new Error('Failed to create todo.');
    }
    return created;
  }

  async delete(id: string): Promise<void> {
    const items = await this.readItems();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      throw new Error('Todo not found.');
    }
    await this.writeItems(next);
  }

  async setCompleted(id: string, completed: boolean): Promise<TodoItem> {
    const items = await this.readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error('Todo not found.');
    }

    const target = {
      ...items[index],
      completed,
      completedDate: completed ? formatDateKey(this.clock()) : undefined
    };
    if (completed) {
      delete target.displayOrder;
    }
    const next = items.filter((item) => item.id !== id);
    next.push(target);
    await this.writeItems(next);
    return this.findUpdated(target);
  }

  async setHighlighted(id: string, highlighted: boolean): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const next = items.map((item) => (item.id === id ? { ...item, highlighted } : item));
    await this.writeItems(next);
    return this.findUpdated({ ...target, highlighted });
  }

  async updateText(id: string, text: string): Promise<TodoItem> {
    const cleaned = cleanTodoText(text);
    if (!cleaned) {
      throw new Error('Todo text is required.');
    }

    const items = await this.readItems();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const updated = { ...target, text: cleaned };
    const next = items.map((item) => (item.id === id ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async updateNotes(id: string, notes: string): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const cleaned = notes.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const updated = { ...target, notes: cleaned };
    const next = items.map((item) => (item.id === id ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async setDeadline(id: string, deadline: string | undefined): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const updated = { ...target, deadline: deadline || undefined };
    const next = items.map((item) => (item.id === id ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async updateTag(id: string, tag: string | undefined): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const updated = { ...target, tag: cleanTodoTag(tag) };
    const next = items.map((item) => (item.id === id ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async addSubTask(parentId: string, text: string): Promise<TodoItem> {
    const cleaned = cleanTodoText(text);
    if (!cleaned) {
      throw new Error('Sub-task text is required.');
    }

    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const subTask: TodoSubTask = {
      id: `${parentId}::${target.subTasks.length}`,
      text: cleaned,
      completed: false,
      displayOrder: target.subTasks.length + 1
    };
    const updated = { ...target, subTasks: [...target.subTasks, subTask] };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async updateSubTask(parentId: string, subTaskId: string, text: string): Promise<TodoItem> {
    const cleaned = cleanTodoText(text);
    if (!cleaned) {
      throw new Error('Sub-task text is required.');
    }

    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const subTasks = target.subTasks.map((sub) =>
      sub.id === subTaskId ? { ...sub, text: cleaned } : sub
    );
    const updated = { ...target, subTasks };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async setSubTaskCompleted(parentId: string, subTaskId: string, completed: boolean): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const subTasks = target.subTasks.map((sub) =>
      sub.id === subTaskId
        ? { ...sub, completed, completedDate: completed ? formatDateKey(this.clock()) : undefined }
        : sub
    );
    const updated = { ...target, subTasks };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async setSubTaskDeadline(parentId: string, subTaskId: string, deadline: string | undefined): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const subTasks = target.subTasks.map((sub) =>
      sub.id === subTaskId ? { ...sub, deadline: deadline || undefined } : sub
    );
    const updated = { ...target, subTasks };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async deleteSubTask(parentId: string, subTaskId: string): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const subTasks = target.subTasks.filter((sub) => sub.id !== subTaskId);
    const updated = { ...target, subTasks };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async moveSubTask(parentId: string, subTaskId: string, direction: 'up' | 'down'): Promise<TodoItem> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const active = target.subTasks.filter((sub) => !sub.completed);
    const idx = active.findIndex((sub) => sub.id === subTaskId);
    if (idx < 0) {
      return this.findUpdated(target);
    }

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= active.length) {
      return this.findUpdated(target);
    }

    // Find actual indices in the full subTasks array and swap positions
    const actualIdx = target.subTasks.findIndex((sub) => sub.id === active[idx].id);
    const actualSwapIdx = target.subTasks.findIndex((sub) => sub.id === active[swapIdx].id);
    const subTasks = [...target.subTasks];
    [subTasks[actualIdx], subTasks[actualSwapIdx]] = [subTasks[actualSwapIdx], subTasks[actualIdx]];

    const updated = { ...target, subTasks };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.findUpdated(updated);
  }

  async reorderSubTasks(parentId: string, ids: string[]): Promise<TodoItem[]> {
    const items = await this.readItems();
    const target = items.find((item) => item.id === parentId);
    if (!target) {
      throw new Error('Todo not found.');
    }

    const active = target.subTasks.filter((sub) => !sub.completed);
    const completed = target.subTasks.filter((sub) => sub.completed);
    const byId = new Map(active.map((sub) => [sub.id, sub]));
    const reorderedActive = ids.map((id) => byId.get(id)).filter((sub): sub is TodoSubTask => Boolean(sub));
    const missingActive = active.filter((sub) => !ids.includes(sub.id));
    const nextSubTasks = [...reorderedActive, ...missingActive, ...completed];

    const updated = { ...target, subTasks: nextSubTasks };
    const next = items.map((item) => (item.id === parentId ? updated : item));
    await this.writeItems(next);
    return this.list();
  }

  async importMarkdown(importPath: string): Promise<ImportResult> {
    const content = await readFile(importPath, 'utf8');
    return this.importMarkdownFromContent(content);
  }

  async importMarkdownFromContent(content: string): Promise<ImportResult> {
    const todayKey = formatDateKey(this.clock());
    const current = await this.readItems();
    const imported = parseTodoMarkdown(content, todayKey);
    const seen = new Set(current.map(todoMergeKey));
    let added = 0;
    let skipped = 0;
    const next: TodoItem[] = [...current];

    for (const item of imported) {
      const key = todoMergeKey(item);
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      next.push({
        ...item,
        id: '',
        sourceLine: 0
      });
      added += 1;
    }

    await this.writeItems(next);
    return { added, skipped };
  }

  async reorder(date: string, ids: string[]): Promise<TodoItem[]> {
    const items = await this.readItems();
    const dayItems = items.filter((item) => item.date === date);
    const active = dayItems.filter((item) => !item.completed);
    const completed = dayItems.filter((item) => item.completed);
    const byId = new Map(active.map((item) => [item.id, item]));
    const reorderedActive = ids.map((id) => byId.get(id)).filter((item): item is ParsedTodo => Boolean(item));
    const missingActive = active.filter((item) => !ids.includes(item.id));
    const nextDay = [...reorderedActive, ...missingActive, ...completed];
    const next = [...items.filter((item) => item.date !== date), ...nextDay];

    await this.writeItems(next);
    return this.list();
  }

  async reorderVisible(ids: string[]): Promise<TodoItem[]> {
    const todayKey = formatDateKey(this.clock());
    const items = await this.readItems();
    const activeVisible = selectVisibleTodos(items, todayKey).filter((item) => !item.completed);
    const byId = new Map(activeVisible.map((item) => [item.id, item]));
    const uniqueIds = Array.from(new Set(ids));
    const ordered = uniqueIds.map((id) => byId.get(id)).filter((item): item is TodoItem => Boolean(item));
    const missing = activeVisible.filter((item) => !uniqueIds.includes(item.id));
    const nextOrderById = new Map([...ordered, ...missing].map((item, index) => [item.id, index + 1]));
    const next = items.map((item) => {
      const displayOrder = nextOrderById.get(item.id);
      if (!displayOrder) {
        return item;
      }
      return { ...item, displayOrder };
    });

    await this.writeItems(next);
    return this.list();
  }

  async openPath(): Promise<string> {
    await this.ensureParent();
    try {
      await readFile(this.filePath, 'utf8');
    } catch {
      await writeFile(this.filePath, '', 'utf8');
    }
    return this.filePath;
  }

  async readSourceContent(): Promise<string> {
    await this.ensureParent();
    try {
      return await readFile(this.filePath, 'utf8');
    } catch {
      return '';
    }
  }

  private async findUpdated(target: TodoItem): Promise<TodoItem> {
    const updated = await this.readItems();
    const match = updated.find(
      (item) =>
        item.date === target.date &&
        item.text === target.text &&
        item.completed === target.completed &&
        item.highlighted === target.highlighted &&
        item.tag === target.tag
    );
    if (!match) {
      throw new Error('Updated todo not found.');
    }
    return match;
  }

  private async readItems(): Promise<ParsedTodo[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return parseTodoMarkdown(content, formatDateKey(this.clock()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeItems(items: TodoItem[]): Promise<void> {
    await this.ensureParent();
    await writeFile(this.filePath, renderTodoMarkdown(items), 'utf8');
  }

  private async ensureParent(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
  }
}

function parseTodoBody(
  rawBody: string,
  completed: boolean
): { highlighted: boolean; completedDate?: string; displayOrder?: number; deadline?: string; tag?: string; text: string } {
  let body = rawBody.trim();
  let highlighted = false;
  let completedDate: string | undefined;
  let displayOrder: number | undefined;
  let deadline: string | undefined;
  let tag: string | undefined;

  let parsedMarker = true;
  while (parsedMarker) {
    parsedMarker = false;
    if (/^\[!\](?:\s+|$)/.test(body)) {
      highlighted = true;
      body = body.replace(/^\[!\]\s*/, '');
      parsedMarker = true;
      continue;
    }

    const order = /^\[order:(\d+)\](?:\s+|$)/.exec(body);
    if (order) {
      displayOrder = Number(order[1]);
      body = body.replace(/^\[order:\d+\]\s*/, '');
      parsedMarker = true;
      continue;
    }

    const ddl = /^\[ddl:(\d{4}-\d{2}-\d{2})\](?:\s+|$)/.exec(body);
    if (ddl) {
      deadline = ddl[1];
      body = body.replace(/^\[ddl:\d{4}-\d{2}-\d{2}\]\s*/, '');
      parsedMarker = true;
      continue;
    }

    const tagMatch = /^\[tag:([^\]]+)\](?:\s+|$)/.exec(body);
    if (tagMatch) {
      tag = cleanTodoTag(tagMatch[1]);
      body = body.replace(/^\[tag:[^\]]+\]\s*/, '');
      parsedMarker = true;
      continue;
    }

    const done = /^\[done:(\d{4}-\d{2}-\d{2})\](?:\s+|$)/.exec(body);
    if (done) {
      completedDate = done[1];
      body = body.replace(/^\[done:\d{4}-\d{2}-\d{2}\]\s*/, '');
      parsedMarker = true;
    }
  }

  if (completed && body.startsWith('~~') && body.endsWith('~~') && body.length >= 4) {
    body = body.slice(2, -2);
  }

  return { highlighted, completedDate, displayOrder, deadline, tag, text: body.trim() };
}

function formatTodoLine(item: TodoItem): string {
  const checkbox = item.completed ? 'x' : ' ';
  const order = item.displayOrder && !item.completed ? `[order:${item.displayOrder}] ` : '';
  const ddl = item.deadline ? `[ddl:${item.deadline}] ` : '';
  const tag = item.tag ? `[tag:${item.tag}] ` : '';
  const done = item.completed && item.completedDate ? `[done:${item.completedDate}] ` : '';
  const marker = item.highlighted ? '[!] ' : '';
  const text = item.completed ? `~~${item.text}~~` : item.text;
  return `- [${checkbox}] ${order}${ddl}${tag}${done}${marker}${text}`;
}

function formatSubTaskLine(sub: TodoSubTask): string {
  const checkbox = sub.completed ? 'x' : ' ';
  const ddl = sub.deadline ? `[ddl:${sub.deadline}] ` : '';
  const done = sub.completed && sub.completedDate ? `[done:${sub.completedDate}] ` : '';
  const text = sub.completed ? `~~${sub.text}~~` : sub.text;
  return `  - [${checkbox}] ${ddl}${done}${text}`;
}

function compareVisibleActiveTodos(left: TodoItem, right: TodoItem, todayKey: string): number {
  const leftOrder = left.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.displayOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftGroup = left.date < todayKey ? 0 : 1;
  const rightGroup = right.date < todayKey ? 0 : 1;
  if (leftGroup !== rightGroup) {
    return leftGroup - rightGroup;
  }
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }
  return left.sourceLine - right.sourceLine;
}

function cleanTodoText(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTodoTag(tag: string | undefined): string | undefined {
  const cleaned = (tag ?? '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function todoMergeKey(item: TodoItem): string {
  return [
    item.date,
    item.text,
    item.completed ? '1' : '0',
    item.highlighted ? '1' : '0',
    item.completedDate ?? '',
    item.tag ?? ''
  ].join('\0');
}

function weekdayName(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(year, month - 1, day));
}

function createTodoId(
  date: string,
  sourceLine: number,
  text: string,
  completed: boolean,
  highlighted: boolean
): string {
  return `${date}:${sourceLine}:${hash(`${date}\0${sourceLine}\0${text}\0${completed}\0${highlighted}`)}`;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16);
}
