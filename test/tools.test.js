// host 侧：七个工具的真实行为、审批门与有界返回。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply, internals as hostInternals } from '../index.js'
import { openDatabase } from '../src/db/database.js'
import { insertEvent } from '../src/db/store.js'
import { buildPatch, buildRecord, defineTools } from '../src/tools.js'

const TOOL_NAMES = [
  'introspect_record',
  'introspect_status',
  'introspect_today',
  'introspect_history',
  'introspect_get',
  'introspect_update',
  'introspect_delete',
]

function createContext() {
  const tools = []
  const sections = []
  const routes = []
  const listeners = new Map()
  const disposers = []
  const ctx = {
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    systemPrompt: { section: (section) => sections.push(section) },
    tools: { register: (tool) => { tools.push(tool); return () => {} } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn) {
      disposers.push(fn())
      return () => {}
    },
  }
  return {
    ctx,
    tools,
    sections,
    routes,
    listeners,
    dispose: () => disposers.filter((d) => typeof d === 'function').forEach((d) => d()),
    tool: (name) => {
      const found = tools.find((item) => item.name === name)
      if (!found) throw new Error(`tool ${name} was not registered`)
      return found
    },
  }
}

let dir
let file
let host

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-tools-'))
  file = join(dir, 'events.sqlite3')
  host = createContext()
  apply(host.ctx, { dbPath: file, chartHours: 24 })
})

after(() => {
  host.dispose()
  return rm(dir, { recursive: true, force: true })
})

const exec = { agent: { id: 'sess-1', session: { id: 'sess-1', header: { cwd: dir } } }, signal: new AbortController().signal }
const asJson = (text) => JSON.parse(text)

describe('registration', () => {
  it('registers exactly the seven introspect tools', () => {
    assert.deepEqual(host.tools.map((tool) => tool.name), TOOL_NAMES)
  })

  it('gives every tool a JSON-schema face, an output renderer and a timeout', () => {
    for (const tool of host.tools) {
      assert.equal(tool.parameters.type, 'object')
      assert.equal(tool.parameters.additionalProperties, false, tool.name)
      assert.equal(typeof tool.execute, 'function')
      assert.equal(typeof tool.output.render, 'function')
      assert.equal(typeof tool.description, 'string')
      assert.ok(tool.description.length > 60, tool.name)
      assert.equal(tool.timeoutMs, 15_000)
      assert.deepEqual(tool.output.render({}, 'text'), [{ type: 'text', text: 'text' }])
    }
  })

  it('declares ranges and rubrics in the parameter schema so the model fills them correctly', () => {
    const record = host.tool('introspect_record').parameters.properties
    assert.equal(record.mel.maximum, 200)
    assert.equal(record.rri.maximum, 100)
    assert.equal(record.arctic.minimum, -10)
    assert.equal(record.tsaMinutes.maximum, 10_080)
    assert.match(record.rri.description, /phys|observable/i)
    assert.match(record.tsaMinutes.description, /never invent/i)
    assert.match(record.mel.description, /0-59/)
    assert.match(record.rawText.description, /verbatim/)
    assert.deepEqual(host.tool('introspect_record').parameters.required, ['rawText'])
    assert.deepEqual(host.tool('introspect_delete').parameters.required, ['id', 'confirm'])
    assert.deepEqual(host.tool('introspect_get').parameters.required, ['id'])
  })

  it('tells the model to record only on an explicit request', () => {
    const guidance = host.sections[0].text
    assert.equal(host.sections[0].name, 'tool:introspect')
    assert.match(guidance, /only on an explicit request/)
    assert.match(guidance, /Ordinary conversation is never recorded/)
    assert.match(guidance, /no automatic chat capture/)
    assert.match(guidance, /Unknown > fabricated precision|Unknown is better than fabricated/)
    assert.match(guidance, /not a scientific scale/)
    // 工具清单与实现必须同步，否则提示词会教模型调用不存在的工具
    for (const name of TOOL_NAMES) assert.ok(guidance.includes(`- ${name}(`), name)
  })

  it('registers only read routes', () => {
    assert.equal(host.routes.length, 1)
    assert.equal(host.routes[0].kind, 'prefix')
    assert.equal(host.routes[0].path, '/introspect/api')
  })
})

describe('introspect_record', () => {
  it('stores a full observation and answers with the id and today', async () => {
    const result = asJson(await host.tool('introspect_record').execute({
      rawText: '刚刚把 dsh-searchops 第一版写完了，大概花了 40 分钟，感觉特别兴奋，已经 commit 并推到了 GitHub。',
      summary: 'SearchOps v1 完成',
      mel: 92,
      rri: 87,
      roi: 12.4,
      arctic: 4,
      tsaMinutes: 40,
      melReason: '交付带来的创造状态',
      rriReason: '代码已推送，产生真实仓库产物',
      tags: ['Coding', ' project ', 'coding'],
    }, exec))
    assert.equal(result.ok, true)
    assert.equal(result.op, 'record')
    assert.ok(result.event.id >= 1)
    assert.equal(result.event.mel, 92)
    assert.equal(result.event.gap, 5)
    assert.deepEqual(result.event.tags, ['coding', 'project'], '标签去重、去空白、小写')
    assert.equal(result.today.events >= 1, true)
    assert.match(result.note, /locally/)
  })

  it('records an event with nothing but raw text and never invents numbers', async () => {
    const result = asJson(await host.tool('introspect_record').execute({ rawText: '下午发了会儿呆' }, exec))
    for (const key of ['mel', 'rri', 'roi', 'arctic', 'tsaMinutes']) assert.equal(result.event[key], null, key)
    assert.ok(result.event.summary.length <= 61)
    assert.equal(result.event.gap, null)
  })

  it('refuses out-of-range metrics without writing them', async () => {
    const eventsLine = async () => (await host.tool('introspect_status').execute({}, exec)).split('\n').find((line) => line.startsWith('Events'))
    const before = await eventsLine()
    await assert.rejects(
      () => host.tool('introspect_record').execute({ rawText: '状态爆棚', mel: 250 }, exec),
      /between 0 and 200/,
    )
    await assert.rejects(() => host.tool('introspect_record').execute({ rawText: 'x', rri: 101 }, exec), /between 0 and 100/)
    await assert.rejects(() => host.tool('introspect_record').execute({ rawText: 'x', tsaMinutes: -5 }, exec), /between 0 and 10080/)
    await assert.rejects(() => host.tool('introspect_record').execute({ summary: '没有原文' }, exec), /rawText/)
    await assert.rejects(() => host.tool('introspect_record').execute({ rawText: '   ' }, exec), /must not be empty/)
    await assert.rejects(
      () => host.tool('introspect_record').execute({ rawText: 'x', tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }, exec),
      /at most 8 tags/,
    )
    assert.equal(await eventsLine(), before, '失败的记录不应改变计数')
  })

  it('reports every problem at once so the model can fix them in one retry', async () => {
    await assert.rejects(
      () => host.tool('introspect_record').execute({ rawText: 'x', mel: 300, rri: -1, tags: 'nope' }, exec),
      (error) => {
        const parts = error.message.split('; ')
        assert.ok(parts.length >= 4, error.message)
        return true
      },
    )
  })

  it('keeps a stated time of occurrence and rejects a bogus one', async () => {
    const result = asJson(await host.tool('introspect_record').execute(
      { rawText: '昨天下午三点开的会', summary: '会议', happenedAt: '2026-05-01T15:00:00Z' },
      exec,
    ))
    const read = asJson(await host.tool('introspect_get').execute({ id: result.event.id }, exec))
    assert.equal(read.event.eventTime, '2026-05-01T15:00:00.000Z')
    await assert.rejects(() => host.tool('introspect_record').execute({ rawText: 'x', happenedAt: '昨天下午' }, exec), /cannot parse/)
  })

  it('stores hostile-looking text as plain data', async () => {
    const evil = "'); DROP TABLE events; -- 记录一下"
    const result = asJson(await host.tool('introspect_record').execute({ rawText: evil, summary: "'); DELETE FROM events; --" }, exec))
    const read = asJson(await host.tool('introspect_get').execute({ id: result.event.id }, exec))
    assert.equal(read.event.rawText, evil)
    assert.ok(asJson(await host.tool('introspect_today').execute({}, exec)).events >= 1)
  })

  it('refuses oversized payloads instead of silently truncating them', async () => {
    await assert.rejects(
      () => host.tool('introspect_record').execute({ rawText: 'x'.repeat(8001) }, exec),
      /exceeds 8000 characters/,
    )
  })

  it('binds the session that recorded the event', async () => {
    const result = asJson(await host.tool('introspect_record').execute({ rawText: '带会话的记录' }, exec))
    const read = asJson(await host.tool('introspect_get').execute({ id: result.event.id }, exec))
    assert.equal(read.event.sessionId, 'sess-1')
  })
})

describe('read tools', () => {
  it('status returns the compact block', async () => {
    const text = await host.tool('introspect_status').execute({}, exec)
    assert.match(text, /^TODAY\nMEL/)
    assert.match(text, /Events\s+\d+ today \/ \d+ total/)
    assert.ok(text.length < 800)
    const custom = await host.tool('introspect_status').execute({ hours: 3 }, exec)
    assert.match(custom, /last 3h/)
  })

  it('today returns a bounded timeline with a truncated flag', async () => {
    for (let i = 0; i < 25; i += 1) await host.tool('introspect_record').execute({ rawText: `批量 ${i}`, summary: `batch ${i}` }, exec)
    const value = asJson(await host.tool('introspect_today').execute({}, exec))
    assert.ok(value.events >= 25)
    assert.equal(value.timeline.length, 20)
    assert.equal(value.truncated, true)
    assert.ok(value.timeline.every((event) => event.summary.length <= 120))
    assert.equal('rawText' in value.timeline[0], false)
  })

  it('history filters, sorts and pages', async () => {
    const all = asJson(await host.tool('introspect_history').execute({}, exec))
    assert.ok(all.returned <= 20)
    assert.equal(all.filters.sort, 'time_desc')
    const window = asJson(await host.tool('introspect_history').execute({ from: '2026-05-01', to: '2026-05-01', limit: 50 }, exec))
    assert.ok(window.events.length >= 1)
    assert.ok(window.events.every((event) => event.stamp.startsWith('05-01')))
    const tagged = asJson(await host.tool('introspect_history').execute({ tags: ['coding'], limit: 50 }, exec))
    assert.ok(tagged.events.every((event) => event.tags.includes('coding')))
    const page1 = asJson(await host.tool('introspect_history').execute({ limit: 3, sort: 'time_asc' }, exec))
    const page2 = asJson(await host.tool('introspect_history').execute({ limit: 3, offset: 3, sort: 'time_asc' }, exec))
    assert.notEqual(page1.events[0].id, page2.events[0].id)
    assert.equal(page2.offset, 3)
    const capped = asJson(await host.tool('introspect_history').execute({ limit: 5000 }, exec))
    assert.ok(capped.returned <= 100)
    await assert.rejects(() => host.tool('introspect_history').execute({ from: '昨天' }, exec), /cannot parse/)
  })

  it('history answers the questions the panel is for', async () => {
    const spinEvent = asJson(await host.tool('introspect_record').execute({ rawText: '研究了两小时 AI 工具，脑子兴奋，但没产出任何代码或文档', summary: 'AI tools research 2h', mel: 96, rri: 12, tsaMinutes: 120, tags: ['thinking'] }, exec))
    assert.equal(spinEvent.event.gap, 84)
    const busy = asJson(await host.tool('introspect_history').execute({ sort: 'tsa_desc', limit: 1 }, exec))
    assert.equal(busy.events[0].tsaMinutes, 120)
    const highEnergy = asJson(await host.tool('introspect_history').execute({ sort: 'mel_desc', limit: 100 }, exec))
    const scores = highEnergy.events.map((event) => event.mel ?? -1)
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
    const spinning = highEnergy.events.filter((event) => event.mel !== null && event.rri !== null && event.gap > 40)
    assert.ok(spinning.length >= 1, '高能量低现实反馈的对照样本应该查得出来')
    assert.equal(spinning[0].mel >= 90, true)
    assert.equal(spinning[0].rri <= 20, true)
  })

  it('get returns the verbatim original with a truncation flag', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '完整原文', summary: 'full', mel: 70 }, exec))
    const detail = asJson(await host.tool('introspect_get').execute({ id: recorded.event.id }, exec))
    assert.equal(detail.op, 'get')
    assert.equal(detail.event.rawText, '完整原文')
    assert.equal(detail.event.rawTextTruncated, false)
    assert.equal(detail.event.melReason, null)
    assert.equal(detail.event.gap, null)
    await assert.rejects(() => host.tool('introspect_get').execute({ id: 999999 }, exec), /No introspect event/)
    await assert.rejects(() => host.tool('introspect_get').execute({ id: 'abc' }, exec), /positive integer/)
  })
})

describe('introspect_update', () => {
  it('lets the user correct a score', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '想明白一个新项目', summary: 'idea', mel: 88, rri: 80, tsaMinutes: 30 }, exec))
    const updated = asJson(await host.tool('introspect_update').execute({ id: recorded.event.id, rri: 20, rriReason: '只在脑子里发生' }, exec))
    assert.equal(updated.op, 'update')
    assert.equal(updated.event.rri, 20)
    assert.equal(updated.event.mel, 88, '未传的字段保持原值')
    assert.equal(updated.event.tsaMinutes, 30)
    assert.notEqual(updated.event.updatedAt, undefined)
    const detail = asJson(await host.tool('introspect_get').execute({ id: recorded.event.id }, exec))
    assert.equal(detail.event.rriReason, '只在脑子里发生')
  })

  it('clears axes through the clear list', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '时间没说过', summary: 'no tsa', tsaMinutes: 45, mel: 60 }, exec))
    const cleared = asJson(await host.tool('introspect_update').execute({ id: recorded.event.id, clear: ['tsaMinutes', 'mel'] }, exec))
    assert.equal(cleared.event.tsaMinutes, null)
    assert.equal(cleared.event.mel, null)
    await assert.rejects(() => host.tool('introspect_update').execute({ id: recorded.event.id, clear: ['rawText'] }, exec), /clear accepts only/)
    await assert.rejects(() => host.tool('introspect_update').execute({ id: recorded.event.id, mel: 50, clear: ['mel'] }, exec), /cannot both set and clear/)
  })

  it('refuses an empty patch, a bad id and out-of-range values', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '待修改', summary: 'patch me' }, exec))
    await assert.rejects(() => host.tool('introspect_update').execute({ id: recorded.event.id }, exec), /nothing to update/)
    await assert.rejects(() => host.tool('introspect_update').execute({ id: 424242, mel: 50 }, exec), /No introspect event/)
    await assert.rejects(() => host.tool('introspect_update').execute({ id: recorded.event.id, mel: 900 }, exec), /between 0 and 200/)
  })

  it('validates the patch before touching the database', () => {
    assert.equal(buildPatch({ mel: 300 }).ok, false)
    assert.equal(buildPatch({}).ok, false)
    assert.deepEqual(buildPatch({ mel: 50 }).value, { mel: 50 })
    assert.deepEqual(buildPatch({ rri: null }).value, { rri: null })
    assert.equal(buildRecord({ rawText: '' }).ok, false)
  })
})

describe('introspect_delete', () => {
  it('requires an explicit confirm flag', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '打算删掉', summary: 'to delete' }, exec))
    await assert.rejects(() => host.tool('introspect_delete').execute({ id: recorded.event.id, confirm: false }, exec), /confirm: true/)
    await assert.rejects(() => host.tool('introspect_delete').execute({ id: recorded.event.id }, exec), /confirm: true/)
    assert.ok(asJson(await host.tool('introspect_get').execute({ id: recorded.event.id }, exec)))
  })

  it('deletes one event and names it in the result', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '确认删除', summary: 'delete me' }, exec))
    const result = asJson(await host.tool('introspect_delete').execute({ id: recorded.event.id, confirm: true }, exec))
    assert.equal(result.deleted.id, recorded.event.id)
    assert.equal(result.deleted.summary, 'delete me')
    await assert.rejects(() => host.tool('introspect_get').execute({ id: recorded.event.id }, exec), /No introspect event/)
  })

  it('asks the human before any delete runs', async () => {
    const hook = host.listeners.get('tools/pre-execute')
    assert.equal(typeof hook, 'function')
    const allow = { kind: 'allow' }
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '要审批的删除', summary: 'approve me' }, exec))
    const decision = await hook({ name: 'introspect_delete', arguments: { id: recorded.event.id, confirm: true } }, async () => allow)
    assert.equal(decision.kind, 'ask')
    assert.match(decision.reason, /permanently/)
    assert.match(decision.reason, new RegExp(`#${recorded.event.id}`))
    const recordDecision = await hook({ name: 'introspect_record', arguments: {} }, async () => allow)
    assert.deepEqual(recordDecision, allow, '记录本身不打扰用户')
    const denied = await hook({ name: 'introspect_delete', arguments: { id: 1 } }, async () => ({ kind: 'deny', reason: 'no' }))
    assert.equal(denied.kind, 'deny', '上游已经拒绝时不再追加确认')
  })

  it('never bulk-deletes: the schema has no such parameter', () => {
    const properties = host.tool('introspect_delete').parameters.properties
    assert.deepEqual(Object.keys(properties).sort(), ['confirm', 'id'])
  })
})

describe('persistence across restarts', () => {
  it('reads back what a previous connection wrote', async () => {
    const recorded = asJson(await host.tool('introspect_record').execute({ rawText: '重启之后还在', summary: 'survivor', mel: 61 }, exec))
    const reopened = openDatabase(file)
    const stored = reopened.db.prepare('SELECT raw_text, mel FROM events WHERE id = ?').get(recorded.event.id)
    assert.equal(stored.raw_text, '重启之后还在')
    assert.equal(stored.mel, 61)
    reopened.db.close()
  })

  it('exposes the resolved database path', () => {
    assert.equal(hostInternals.defaultDbPath({ DSH_HOME: '/x' }, '/h'), join('/x', 'introspect', 'events.sqlite3'))
    assert.match(hostInternals.GUIDANCE, /events\.sqlite3/)
  })
})

describe('timezone-aware tool output', () => {
  it('computes today by the given offset, not by the host clock', async () => {
    const db = openDatabase(join(dir, 'tz.sqlite3')).db
    const tools = defineTools(db, { tzOffsetMinutes: -480 })
    const today = tools.find((tool) => tool.name === 'introspect_today')
    const now = new Date().toISOString()
    insertEvent(db, { rawText: '今天的事', summary: 'today', mel: 70, eventTime: now })
    insertEvent(db, { rawText: '三十小时前的事', summary: 'long ago', mel: 71, eventTime: new Date(Date.parse(now) - 30 * 3_600_000).toISOString() })
    const value = asJson(await today.execute({}, exec))
    assert.deepEqual(value.timeline.map((event) => event.summary), ['today'])
    assert.equal(value.events, 1)
    // 同一个连接换成 UTC 视角时，两条都可能落进「今天」——边界确实跟着偏移量走
    const utc = defineTools(db, { tzOffsetMinutes: 0 }).find((tool) => tool.name === 'introspect_today')
    const asUtc = asJson(await utc.execute({}, exec))
    assert.ok(asUtc.events >= value.events)
    db.close()
  })
})
