// 面板的只读数据面：host 插件在 dsh webServer 上自建两条读路由，
// 客户端 fetch 取聚合结果。没有写路由——浏览器永远不能直接改数据库，
// 一切写入都必须经 DSH 模型调 introspect_record/update/delete
// （与 dsh-mindmap 同一条红线）。
const MAX_BODY_BYTES = 64 * 1024

function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.errorCode = code
  return error
}

/**
 * 同源 / loopback fence：只服务本机 web 页面自己发来的请求。
 * Host 必须是 loopback 或与 Origin 同 host；sec-fetch-site=cross-site 一律拒。
 */
export function isTrustedRequest(req) {
  const host = String(req?.headers?.host ?? '')
  if (!host) return false
  const site = String(req?.headers?.['sec-fetch-site'] ?? '')
  if (site === 'cross-site') return false
  const origin = String(req?.headers?.origin ?? '')
  if (!origin) {
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  }
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw httpError(400, 'bad-request', 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw httpError(400, 'bad-request', 'request body is not valid JSON')
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function numberIn(value, { min, max, fallback }) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function tzOffsetIn(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(-840, Math.min(840, Math.round(n)))
}

/**
 * 构造 /introspect/api 的 handler。
 * @param {{db: object, defaults?: {hours?: number}, hostTzOffsetMinutes: () => number,
 *          buildDashboard: Function, getEvent: Function, trimForList: Function}} deps
 */
export function createApiHandler(deps) {
  const { db, buildDashboard, getEvent, trimForList } = deps
  const defaultHours = numberIn(deps?.defaults?.hours, { min: 1, max: 168, fallback: 24 })
  const hostOffset = typeof deps.hostTzOffsetMinutes === 'function' ? deps.hostTzOffsetMinutes() : 0

  return async function handle(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
      return
    }
    try {
      const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice('/introspect/api/'.length)
      if (method !== 'dashboard' && method !== 'event') {
        sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown introspect API method ${JSON.stringify(method)}` } })
        return
      }
      const payload = await readJsonBody(req)
      if (typeof payload.sessionId !== 'string' || !payload.sessionId) {
        sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing or invalid "sessionId"' } })
        return
      }
      const tzOffsetMinutes = tzOffsetIn(payload.tzOffsetMinutes, hostOffset)
      if (method === 'event') {
        const id = Number(payload.id)
        if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'bad-request', 'id must be a positive integer')
        const event = getEvent(db, id)
        if (!event) throw httpError(404, 'not-found', `no introspect event with id ${id}`)
        // 详情里给原文，但有界：面板窄栏装不下八千字，也不该把整段历史灌进浏览器。
        const chars = [...String(event.rawText ?? '')]
        const clipped = chars.length > 4000
        sendJson(res, 200, {
          ok: true,
          value: {
            ...event,
            summary: trimForList(event.summary, 200),
            rawText: clipped ? chars.slice(0, 4000).join('') : event.rawText,
            rawTextTruncated: clipped,
          },
        })
        return
      }
      const hours = numberIn(payload.hours, { min: 1, max: 168, fallback: defaultHours })
      const recentLimit = numberIn(payload.recentLimit, { min: 1, max: 20, fallback: 8 })
      const dashboard = buildDashboard(db, {
        tzOffsetMinutes,
        hours,
        recentLimit,
        seriesLimit: numberIn(payload.seriesLimit, { min: 2, max: 200, fallback: 60 }),
      })
      sendJson(res, 200, { ok: true, value: dashboard })
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 500
      sendJson(res, status, {
        ok: false,
        error: {
          code: typeof error?.errorCode === 'string' ? error.errorCode : 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}
