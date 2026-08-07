import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startAiApiServer, type AiApiServer } from '../src/main/aiApi';
import type { TodoItem } from '../src/shared/types';

function makeTodo(id: string, text: string, completed = false): TodoItem {
  return { id, date: '2026-08-06', text, completed, highlighted: false, overdue: false, sourceLine: 1, notes: '', subTasks: [] };
}

function makeDeps(infoFile: string) {
  const todos: TodoItem[] = [];
  const schedules: unknown[] = [];
  const events: string[] = [];
  let nextId = 1;
  return {
    todos,
    schedules,
    events,
    deps: {
      todoStore: {
        list: async () => todos,
        add: async (text: string) => {
          const item = makeTodo(`t${nextId++}`, text);
          todos.push(item);
          return item;
        },
        delete: async (id: string) => {
          const index = todos.findIndex((t) => t.id === id);
          if (index < 0) throw new Error('Todo not found.');
          todos.splice(index, 1);
        },
        setCompleted: async (id: string, completed: boolean) => {
          const item = todos.find((t) => t.id === id);
          if (!item) throw new Error('Todo not found.');
          item.completed = completed;
          return item;
        }
      },
      scheduleStore: {
        list: async () => schedules as never,
        create: async (input: unknown) => {
          const rule = { id: `r${schedules.length + 1}`, ...(input as object) };
          schedules.push(rule);
          return rule as never;
        },
        delete: async (id: string) => {
          const index = schedules.findIndex((r) => (r as { id: string }).id === id);
          if (index < 0) throw new Error('定时规则不存在。');
          schedules.splice(index, 1);
        }
      },
      onTodosChanged: async () => { events.push('todos'); },
      onSchedulesChanged: async () => { events.push('schedules'); },
      infoFile,
      preferredPort: 0
    }
  };
}

describe('aiApi server', () => {
  let workDir: string;
  let api: AiApiServer | null;
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'aiapi-test-'));
    ctx = makeDeps(join(workDir, 'ai-api.json'));
    api = await startAiApiServer(ctx.deps);
  });

  afterEach(async () => {
    await api?.close();
    await rm(workDir, { recursive: true, force: true });
  });

  function call(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
    return fetch(`http://127.0.0.1:${api!.port}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        'x-ai-token': options.token ?? api!.token
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  }

  test('writes discovery info file with port and token', async () => {
    const info = JSON.parse(await readFile(join(workDir, 'ai-api.json'), 'utf8'));
    expect(info.port).toBe(api!.port);
    expect(info.token).toBe(api!.token);
  });

  test('rejects requests without the token', async () => {
    const response = await call('/api/todos', { token: 'wrong' });
    expect(response.status).toBe(401);
  });

  test('creates, lists, completes and deletes todos, emitting change events', async () => {
    const created = await (await call('/api/todos', { method: 'POST', body: { text: '写周报' } })).json();
    expect(created.ok).toBe(true);
    expect(created.data.text).toBe('写周报');

    const listed = await (await call('/api/todos')).json();
    expect(listed.data).toHaveLength(1);

    const completed = await (await call('/api/todos/complete', { method: 'POST', body: { text: '周报' } })).json();
    expect(completed.ok).toBe(true);
    expect(ctx.todos[0].completed).toBe(true);

    const deleted = await (await call('/api/todos/delete', { method: 'POST', body: { id: ctx.todos[0].id } })).json();
    expect(deleted.ok).toBe(true);
    expect(ctx.todos).toHaveLength(0);
    expect(ctx.events).toEqual(['todos', 'todos', 'todos']);
  });

  test('resolves todos by exact then fuzzy text match', async () => {
    ctx.todos.push(makeTodo('a', '吃药'), makeTodo('b', '吃晚饭前吃药'));
    const response = await (await call('/api/todos/complete', { method: 'POST', body: { text: '吃药' } })).json();
    expect(response.ok).toBe(true);
    expect(ctx.todos[0].completed).toBe(true);
    expect(ctx.todos[1].completed).toBe(false);
  });

  test('returns a useful error when no todo matches', async () => {
    const response = await call('/api/todos/complete', { method: 'POST', body: { text: '不存在' } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('找不到');
  });

  test('creates and deletes scheduled rules', async () => {
    const created = await (await call('/api/schedules', {
      method: 'POST',
      body: { kind: 'weekly', target: 'reminder', text: '站起来活动', hour: 10, minute: 30, weekdays: [1, 3, 5] }
    })).json();
    expect(created.ok).toBe(true);
    expect(created.data.id).toBe('r1');

    const deleted = await (await call('/api/schedules/delete', { method: 'POST', body: { id: 'r1' } })).json();
    expect(deleted.ok).toBe(true);
    expect(ctx.schedules).toHaveLength(0);
    expect(ctx.events).toEqual(['schedules', 'schedules']);
  });

  test('rejects invalid schedule payloads', async () => {
    const response = await call('/api/schedules', { method: 'POST', body: { kind: 'daily', text: 'x' } });
    expect(response.status).toBe(400);
  });

  test('unknown routes return 404', async () => {
    const response = await call('/api/nope');
    expect(response.status).toBe(404);
  });
});
