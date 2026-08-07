import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScheduledTodoInput, ScheduledTodoRule, TodoItem } from '../shared/types';

/**
 * Minimal localhost HTTP API so external AI tools can manage TODOs and
 * scheduled rules without going through the renderer UI. Binds 127.0.0.1
 * only and requires a per-startup token; the { port, token } pair is written
 * to `infoFile` for AI clients to discover.
 */

export type AiApiTodoStore = {
  list(): Promise<TodoItem[]>;
  add(text: string, deadline?: string): Promise<TodoItem>;
  delete(id: string): Promise<void>;
  setCompleted(id: string, completed: boolean): Promise<TodoItem>;
};

export type AiApiScheduleStore = {
  list(): Promise<ScheduledTodoRule[]>;
  create(input: ScheduledTodoInput): Promise<ScheduledTodoRule>;
  delete(id: string): Promise<void>;
};

export type AiApiDeps = {
  todoStore: AiApiTodoStore;
  scheduleStore: AiApiScheduleStore;
  onTodosChanged(): Promise<void>;
  /** Called after schedule mutations; receives `runDueNow` like the IPC path. */
  onSchedulesChanged(runDueNow: boolean): Promise<void>;
  /** Where { port, token } discovery info is written (e.g. userData/ai-api.json). */
  infoFile: string;
  preferredPort?: number;
};

export type AiApiServer = {
  server: Server;
  port: number;
  token: string;
  close(): Promise<void>;
};

const defaultPort = 27182;
const maxPortAttempts = 10;

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > 64 * 1024) {
      throw new Error('请求体过大。');
    }
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function fail(message: string): never {
  throw new Error(message);
}

/** Resolves a todo by exact id, or by text (exact match first, then substring). */
async function resolveTodoId(store: AiApiTodoStore, body: { id?: unknown; text?: unknown }): Promise<string> {
  if (typeof body.id === 'string' && body.id) {
    return body.id;
  }
  if (typeof body.text !== 'string' || !body.text.trim()) {
    fail('需要提供 id 或 text。');
  }
  const needle = (body.text as string).trim();
  const todos = await store.list();
  const exact = todos.find((item) => item.text === needle);
  const fuzzy = exact ?? todos.find((item) => item.text.includes(needle));
  if (!fuzzy) {
    fail(`找不到匹配的 TODO：${needle}`);
  }
  return fuzzy.id;
}

async function handleRequest(deps: AiApiDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method ?? 'GET';
  const { todoStore, scheduleStore } = deps;

  if (method === 'GET' && url.pathname === '/api/todos') {
    sendJson(response, 200, { ok: true, data: await todoStore.list() });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/todos') {
    const body = (await readBody(request)) as { text?: unknown; deadline?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) {
      fail('text 不能为空。');
    }
    const deadline = typeof body.deadline === 'string' && body.deadline ? body.deadline : undefined;
    const item = await todoStore.add(body.text.trim(), deadline);
    await deps.onTodosChanged();
    sendJson(response, 200, { ok: true, data: item });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/todos/complete') {
    const body = (await readBody(request)) as { id?: unknown; text?: unknown; completed?: unknown };
    const id = await resolveTodoId(todoStore, body);
    const completed = typeof body.completed === 'boolean' ? body.completed : true;
    const item = await todoStore.setCompleted(id, completed);
    await deps.onTodosChanged();
    sendJson(response, 200, { ok: true, data: item });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/todos/delete') {
    const body = (await readBody(request)) as { id?: unknown; text?: unknown };
    const id = await resolveTodoId(todoStore, body);
    await todoStore.delete(id);
    await deps.onTodosChanged();
    sendJson(response, 200, { ok: true });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/schedules') {
    sendJson(response, 200, { ok: true, data: await scheduleStore.list() });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/schedules') {
    const body = (await readBody(request)) as ScheduledTodoInput;
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      fail('text 不能为空。');
    }
    if (body.kind !== 'weekly' && body.kind !== 'one-time') {
      fail('kind 必须是 weekly 或 one-time。');
    }
    const rule = await scheduleStore.create(body);
    await deps.onSchedulesChanged(true);
    sendJson(response, 200, { ok: true, data: rule });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/schedules/delete') {
    const body = (await readBody(request)) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) {
      fail('需要提供 id。');
    }
    await scheduleStore.delete(body.id);
    await deps.onSchedulesChanged(false);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, error: '接口不存在。' });
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/**
 * Starts the AI HTTP API. Tries `preferredPort` and the following few ports.
 * Returns null when no port is available — the app keeps working without it.
 */
export async function startAiApiServer(deps: AiApiDeps): Promise<AiApiServer | null> {
  const token = randomBytes(24).toString('hex');
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.headers['x-ai-token'] !== token) {
          sendJson(response, 401, { ok: false, error: '缺少或错误的 x-ai-token 请求头。' });
          return;
        }
        await handleRequest(deps, request, response);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: (error as Error).message });
      }
    })();
  });

  const base = deps.preferredPort ?? defaultPort;
  let port = -1;
  for (let attempt = 0; attempt < maxPortAttempts; attempt += 1) {
    try {
      await listen(server, base + attempt);
      port = (server.address() as AddressInfo).port;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }
  if (port < 0) {
    server.close();
    return null;
  }

  await mkdir(dirname(deps.infoFile), { recursive: true });
  // 原子写：先写临时文件再重命名，避免进程中途退出留下截断的发现文件
  const tempFile = `${deps.infoFile}.tmp`;
  await writeFile(
    tempFile,
    JSON.stringify({ port, token, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  await rename(tempFile, deps.infoFile);

  return {
    server,
    port,
    token,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
