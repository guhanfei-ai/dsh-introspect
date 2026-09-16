// 只读数据面：信任栅栏、方法守卫、数据形状与错误处理。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { openDatabase } from '../src/db/database.js'
import { insertEvent } from '../src/db/store.js'
import { buildDashboard, trimForList } from '../src/db/view.js'
import { getEvent } from '../src/db/store.js'
import { hostTzOffsetMinutes } from '../src/time.js'
import { createApiHandler, isTrustedRequest } from '../src/api.js'

let dir, db, handler

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-api-'))
  db = openDatabase(join(dir, 'events.sqlite3')).db
  insertEvent(db, { rawText: '刚刚把 v1 完成了', summary: 'v1 shipped', mel: 92, rri: 87, roi: 12.4, arctic: 4, tsaMinutes: 40, tags: ['coding'], eventTime: '2026-05-01T02:00:00Z' })
  insertEvent(db, { rawText: '研究 AI 两小时', summary: 'AI tools research', mel: 96, rri: 12, tsaMinutes: 120, tags: ['thinking'], eventTime: '2026-05-01T04:00:00Z' })
  handler = createApiHandler({
    db,
    hostTzOffsetMinutes,
    buildDashboard,
    getEvent,
    trimForList,
    defaults: { hours: 24 },
  })
})

after(() => db?.close())

function fakeReq(method, { body, headers = {} } = {}) {
  const chunks = body != null ? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))] : []
  return {
    method,
    url: '/introspect/api/dashboard',
    headers: { host: '127.0.0.1:4000', origin: 'http://127.0.0.1:4000', ...headers },
    [Symbol.asyncIterator]() { let i = 0; return { next() { return Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }) } } },
  }
}

function fakeRes() {
  let status, body
  const res = {
    writeHead(s, _headers) { status = s },
    end(data) { body = data },
    get status() { return status },
    get body() { return body },
    get parsed() { try { return JSON.parse(body) } catch { return null } },
  }
  return res
}

async function call(method = 'POST', options = {}) {
  const url = options.url ?? '/introspect/api/dashboard'
  const req = fakeReq(method, options)
  req.url = url
  const res = fakeRes()
  await handler(req, res)
  return res
}

describe('trust fence', () => {
  it('rejects a request with no host header', async () => {
    const res = await call('POST', { headers: { host: '' } })
    assert.equal(res.status, 403)
  })

  it('rejects a cross-site request', async () => {
    const res = await call('POST', { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(res.status, 403)
  })

  it('allows a loopback request with no origin', async () => {
    const res = await call('POST', { body: { sessionId: 'test' }, headers: { origin: '' } })
    assert.equal(res.status, 200)
  })

  it('allows an origin that matches the host', async () => {
    const res = await call('POST', { body: { sessionId: 'test' }, headers: { host: 'localhost:9090', origin: 'http://localhost:9090' } })
    assert.equal(res.status, 200)
    assert.equal(res.parsed.ok, true)
  })

  it('rejects an origin that does not match the host', async () => {
    const res = await call('POST', { headers: { host: '127.0.0.1:9090', origin: 'http://evil.example' } })
    assert.equal(res.status, 403)
  })
})

describe('method and routing', () => {
  it('rejects anything except POST', async () => {
    assert.equal((await call('GET')).status, 405)
    assert.equal((await call('DELETE')).status, 405)
  })

  it('rejects an unknown method path', async () => {
    const res = await call('POST', { url: '/introspect/api/nope' })
    assert.equal(res.status, 404)
    assert.equal(res.parsed.error.code, 'not-found')
  })

  it('rejects a missing or non-string sessionId', async () => {
    const res = await call('POST', { body: {} })
    assert.equal(res.status, 400)
    assert.match(res.parsed.error.message, /sessionId/)
  })

  it('rejects an oversized body', async () => {
    const res = await call('POST', { body: 'x'.repeat(70_000) })
    assert.equal(res.status, 400)
  })
})

describe('dashboard route', () => {
  it('returns a bounded, serializable dashboard payload', async () => {
    const res = await call('POST', { body: { sessionId: 'test', tzOffsetMinutes: -480 } })
    assert.equal(res.status, 200)
    const value = res.parsed.value
    assert.equal(res.parsed.ok, true)
    assert.equal(typeof value.generatedAt, 'string')
    assert.ok(Array.isArray(value.series))
    assert.ok(Array.isArray(value.recent))
    assert.ok(Array.isArray(value.tags))
    assert.equal(typeof value.quadrant.measured, 'number')
    assert.equal(value.totals.count, 2)
    assert.ok(Buffer.byteLength(JSON.stringify(res.parsed)) < 20_000)
    assert.ok(value.recent.every((event) => event.summary.length <= 120))
    assert.ok(!('rawText' in value.recent[0]))
  })

  it('honours the hours and recentLimit knobs', async () => {
    const res = await call('POST', { body: { sessionId: 'test', hours: 2, recentLimit: 1 } })
    assert.equal(res.status, 200)
    const value = res.parsed.value
    assert.equal(value.recent.length, 1)
    assert.ok(value.series.length <= 2)
  })

  it('clamps an out-of-range hours value to the nearest bound', async () => {
    const res = await call('POST', { body: { sessionId: 'test', hours: -5 } })
    assert.equal(res.status, 200)
    assert.equal(res.parsed.value.hours, 1, '负值 clamp 到 min')
  })
})

describe('event detail route', () => {
  it('returns the full event by id', async () => {
    const res = await call('POST', { url: '/introspect/api/event', body: { sessionId: 'test', id: 1 } })
    assert.equal(res.status, 200)
    const value = res.parsed.value
    assert.equal(value.id, 1)
    assert.equal(value.rawText, '刚刚把 v1 完成了')
    assert.equal(value.rawTextTruncated, false)
    assert.equal(typeof value.mel, 'number')
    assert.equal('rawText' in value, true, '详情路由才给原文')
    assert.ok(Array.isArray(value.tags))
  })

  it('rejects an invalid id', async () => {
    const res = await call('POST', { url: '/introspect/api/event', body: { sessionId: 'test', id: -1 } })
    assert.equal(res.status, 400)
  })

  it('returns 404 for a non-existent id', async () => {
    const res = await call('POST', { url: '/introspect/api/event', body: { sessionId: 'test', id: 999 } })
    assert.equal(res.status, 404)
  })

  it('clips an abnormally long raw text to keep the response bounded', async () => {
    const long = '段落。'.repeat(1500)
    insertEvent(db, { rawText: long, summary: '长文' })
    const id = db.prepare('SELECT id FROM events ORDER BY id DESC LIMIT 1').get().id
    const res = await call('POST', { url: '/introspect/api/event', body: { sessionId: 'test', id } })
    assert.equal(res.status, 200)
    assert.equal(res.parsed.value.rawTextTruncated, true)
    assert.ok([...res.parsed.value.rawText].length <= 4001)
  })
})
