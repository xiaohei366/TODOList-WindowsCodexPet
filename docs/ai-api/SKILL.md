---
name: todolist-pet-ai-api
description: 通过本地 HTTP API 控制 TOList 桌宠：创建/删除/完成 TODO，创建/删除定时 TODO 与定时提醒。当用户希望用 AI 管理这个桌面 TODO 应用的内容时使用。应用必须正在运行。
---

# TOList 桌宠 AI 接口

TOList 桌宠（Electron 桌面应用）在运行时内置了一个只监听 `127.0.0.1` 的 HTTP API，供 AI 工具管理 TODO 与定时任务。**零依赖**：任何能发 HTTP 请求的环境（curl、fetch、Python requests 等）都能用。

## 第一步：发现连接信息（每次调用前必读）

端口和令牌每次启动应用都会变化，先从发现文件读取：

- Windows：`%APPDATA%\TOList\ai-api.json`（即 `C:\Users\<用户名>\AppData\Roaming\TOList\ai-api.json`）

```json
{ "port": 27182, "token": "<48位hex>", "updatedAt": "..." }
```

- 文件不存在 → 应用未运行或版本过旧，提示用户启动应用。
- 所有请求必须带请求头：`x-ai-token: <token>`，否则返回 401。
- Base URL：`http://127.0.0.1:<port>`

## 接口一览

所有请求/响应均为 JSON。成功：`{ "ok": true, "data": ... }`；失败：`{ "ok": false, "error": "..." }`（HTTP 400/401/404）。

### TODO

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| GET | `/api/todos` | — | 列出当前可见 TODO（含子任务） |
| POST | `/api/todos` | `{ "text": "写周报", "deadline": "2026-08-10" }` | 创建 TODO；`deadline` 可选 |
| POST | `/api/todos/complete` | `{ "id": "..." }` 或 `{ "text": "周报" }`，可加 `"completed": false` 取消完成 | 完成/取消完成 |
| POST | `/api/todos/delete` | `{ "id": "..." }` 或 `{ "text": "周报" }` | 删除 |

**重要：TODO 的 id 不稳定**（完成/重排后 id 会变）。定位 TODO 优先用 `text`：先精确匹配，再子串模糊匹配，命中第一个；不命中返回 400。批量操作建议先 `GET /api/todos` 拿到当前快照再决定。

### 定时任务（定时 TODO / 定时提醒）

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| GET | `/api/schedules` | — | 列出全部定时规则 |
| POST | `/api/schedules` | 见下 | 创建规则 |
| POST | `/api/schedules/delete` | `{ "id": "..." }` | 删除规则（id 从 GET 获取，稳定） |

创建规则字段：

```json
{
  "kind": "weekly",              // "weekly" 每周循环 | "one-time" 单次
  "target": "todo",              // "todo" 到点生成 TODO | "reminder" 到点弹系统通知
  "text": "站起来活动一下",       // 必填
  "hour": 10, "minute": 30,      // 触发时间
  "weekdays": [1, 3, 5],         // 仅 weekly：0=周日 … 6=周六
  "date": "2026-08-10",          // 仅 one-time：YYYY-MM-DD（也可用 year/month/day 数字）
  "deadlineDays": 3,             // 可选：生成的 TODO 截止日期=生成当天起第 N 天
  "enabled": true                // 可选，默认 true
}
```

## 示例

```bash
# bash / curl（先读发现文件）
INFO="$APPDATA/TOList/ai-api.json"   # Git Bash；CMD/PowerShell 用 %APPDATA% 或 $env:APPDATA
PORT=$(node -p "require('$INFO').port")
TOKEN=$(node -p "require('$INFO').token")

# 创建 TODO
curl -s -X POST "http://127.0.0.1:$PORT/api/todos" \
  -H "content-type: application/json" -H "x-ai-token: $TOKEN" \
  -d '{"text":"给客户回邮件"}'

# 按文本完成 TODO
curl -s -X POST "http://127.0.0.1:$PORT/api/todos/complete" \
  -H "content-type: application/json" -H "x-ai-token: $TOKEN" \
  -d '{"text":"回邮件"}'

# 创建每周一三五 10:30 的定时提醒
curl -s -X POST "http://127.0.0.1:$PORT/api/schedules" \
  -H "content-type: application/json" -H "x-ai-token: $TOKEN" \
  -d '{"kind":"weekly","target":"reminder","text":"喝水","hour":10,"minute":30,"weekdays":[1,3,5]}'
```

```js
// Node.js / fetch 最小封装
const info = require(process.env.APPDATA + '/TOList/ai-api.json');
const api = async (path, body) => (await fetch(`http://127.0.0.1:${info.port}${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { 'content-type': 'application/json', 'x-ai-token': info.token },
  body: body ? JSON.stringify(body) : undefined
})).json();

await api('/api/todos', { text: '写总结' });
await api('/api/todos/complete', { text: '总结' });
```

## 注意

- 操作立即生效并同步刷新桌面端 UI。
- 通过 API 完成 TODO **不会**播放桌面端的庆祝特效（特效只在用户手动点击时触发）。
- API 只绑定本机回环地址，令牌每次启动重新生成，外部无法访问。
