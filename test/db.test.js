// SQLite 层：初始化、迁移、持久化、编码、边界与注入防御。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { DB_FILE_NAME, defaultDbPath, openDatabase, resolveDbPath } from '../src/db/database.js'
import { MIGRATIONS, SCHEMA_VERSION, currentVersion, migrate } from '../src/db/schema.js'
import {
  aggregateWindow,
  countEvents,
  deleteEvent,
  eventExists,
  getEvent,
  insertEvent,
  quadrantCounts,
  queryEvents,
  recentEvents,
  rowToEvent,
  tagCounts,
  totalEvents,
  updateEvent,
} from '../src/db/store.js'

let dir
let file
let db

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-db-'))
  file = join(dir, DB_FILE_NAME)
  db = openDatabase(file).db
})

after(async () => {
  db?.close()
  await rm(dir, { recursive: true, force: true })
})

/** 独立内存库：聚合语义测试要确定性，不能受别的用例残留数据影响。 */
function memory() {
  return openDatabase(':memory:').db
}

const base = {
  rawText: '刚刚把 dsh-searchops 第一版开发完成并 commit，花了 40 分钟，挺兴奋。',
  summary: 'SearchOps v1 shipped',
  mel: 87,
  rri: 62,
  roi: 6.5,
  arctic: 4,
  tsaMinutes: 40,
  tags: ['coding', 'project'],
}

describe('schema', () => {
  it('creates the events table at the current version', () => {
    assert.equal(currentVersion(db), SCHEMA_VERSION)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    assert.ok(tables.includes('events'))
    const columns = db.prepare('PRAGMA table_info(events)').all().map((row) => row.name)
    for (const column of ['raw_text', 'summary', 'mel', 'roi', 'arctic', 'tsa_minutes', 'rri', 'mel_reason', 'rri_reason', 'tags_json', 'metadata_json', 'source', 'session_id', 'created_at', 'updated_at', 'event_time']) {
      assert.ok(columns.includes(column), column)
    }
  })

  it('migrate is idempotent', () => {
    const again = migrate(db)
    assert.deepEqual(again.applied, [])
    assert.equal(again.to, SCHEMA_VERSION)
    assert.equal(MIGRATIONS[0].version, 1)
  })

  it('refuses a database newer than the plugin', () => {
    const future = openDatabase(join(dir, 'future.sqlite3'))
    future.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    assert.throws(() => migrate(future.db), /newer/)
    future.db.close()
  })

  it('turns on WAL and a busy timeout', () => {
    assert.equal(Object.values(db.prepare('PRAGMA journal_mode').get())[0], 'wal')
    assert.ok(Number(Object.values(db.prepare('PRAGMA busy_timeout').get())[0]) >= 1000)
  })
})

describe('paths', () => {
  it('defaults under $DSH_HOME/introspect and falls back to ~/.dsh', () => {
    assert.equal(defaultDbPath({ DSH_HOME: '/tmp/dsh' }, '/home/u'), join('/tmp/dsh', 'introspect', DB_FILE_NAME))
    assert.equal(defaultDbPath({}, '/home/u'), join('/home/u', '.dsh', 'introspect', DB_FILE_NAME))
  })

  it('expands ~ and resolves relative paths inside the plugin data dir', () => {
    assert.equal(resolveDbPath('~/custom.db', {}, '/home/u'), join('/home/u', 'custom.db'))
    assert.equal(resolveDbPath('rel.db', { DSH_HOME: '/dsh' }, '/home/u'), join('/dsh', 'introspect', 'rel.db'))
    assert.equal(resolveDbPath('   ', {}, '/home/u'), defaultDbPath({}, '/home/u'))
    assert.equal(resolveDbPath('/abs/x.sqlite3', {}, '/home/u'), join('/abs', 'x.sqlite3'))
  })

  it('creates a missing directory on open', () => {
    const nested = join(dir, 'a', 'b', 'c.sqlite3')
    const opened = openDatabase(nested)
    assert.ok(existsSync(nested))
    opened.db.close()
  })
})

describe('crud', () => {
  it('inserts, reads back and defaults timestamps', () => {
    const event = insertEvent(db, base)
    assert.ok(event.id > 0)
    assert.match(event.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    assert.equal(event.eventTime, event.createdAt)
    assert.equal(event.updatedAt, event.createdAt)
    assert.equal(event.source, 'dsh')
    assert.equal(event.sessionId, null)
    assert.equal(event.rawText, base.rawText)
    assert.deepEqual(event.tags, ['coding', 'project'])
    assert.deepEqual(event.metadata, {})
    assert.equal(getEvent(db, event.id).summary, base.summary)
  })

  it('keeps null metrics as null, not zero', () => {
    const check = memory()
    insertEvent(check, { rawText: '想到一个新方向', summary: 'Idea only' })
    const stored = queryEvents(check, { limit: 1 })[0]
    for (const key of ['mel', 'roi', 'arctic', 'tsaMinutes', 'rri']) assert.equal(stored[key], null, key)
    const empty = aggregateWindow(check, {})
    assert.equal(empty.mel, null)
    assert.equal(empty.melAvg, null)
    assert.equal(empty.roi, null)
    assert.equal(empty.tsaMinutes, null)
    assert.equal(empty.count, 1)
    check.close()
  })

  it('round-trips unicode, emoji and long raw text', () => {
    const long = '能量。'.repeat(1500) + ' 💾 — ok'
    const event = insertEvent(db, { rawText: long, summary: '中文 · Emoji 💾', mel: 100 })
    const read = getEvent(db, event.id)
    assert.equal(read.rawText, long)
    assert.equal([...read.rawText].length, 4507)
    assert.equal(read.summary, '中文 · Emoji 💾')
  })

  it('survives reopening the same file', () => {
    const beforeTotals = totalEvents(db)
    assert.ok(beforeTotals.count > 0)
    db.close()
    const reopened = openDatabase(file).db
    assert.deepEqual(totalEvents(reopened), beforeTotals)
    db = reopened
  })

  it('updates only what is passed and bumps updated_at', async () => {
    const event = insertEvent(db, base)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const updated = updateEvent(db, event.id, { rri: 20, rriReason: '用户纠正', tags: ['thinking'] })
    assert.equal(updated.rri, 20)
    assert.equal(updated.rriReason, '用户纠正')
    assert.deepEqual(updated.tags, ['thinking'])
    assert.equal(updated.mel, base.mel)
    assert.equal(updated.rawText, base.rawText)
    assert.notEqual(updated.updatedAt, event.updatedAt)
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(event.updatedAt))
  })

  it('returns the row unchanged for an empty patch', () => {
    const event = insertEvent(db, base)
    assert.deepEqual(updateEvent(db, event.id, {}), event)
  })

  it('clears a metric with null and refuses an unknown id', () => {
    const event = insertEvent(db, base)
    assert.equal(updateEvent(db, event.id, { mel: null }).mel, null)
    assert.equal(updateEvent(db, 999999, { mel: 10 }), null)
    assert.throws(() => updateEvent(db, 'abc', { mel: 10 }), /positive integer/)
    assert.throws(() => deleteEvent(db, -3), /positive integer/)
  })

  it('deletes exactly one row', () => {
    const event = insertEvent(db, base)
    assert.equal(eventExists(db, event.id), true)
    assert.equal(deleteEvent(db, event.id), true)
    assert.equal(eventExists(db, event.id), false)
    assert.equal(getEvent(db, event.id), null)
    assert.equal(deleteEvent(db, event.id), false)
  })
})

describe('queries', () => {
  it('filters by tag exactly, not by substring', () => {
    const check = memory()
    insertEvent(check, { ...base, summary: 'A', tags: ['coding', 'thinking'] })
    insertEvent(check, { ...base, summary: 'B', tags: ['project'] })
    insertEvent(check, { ...base, summary: 'C', tags: [] })
    assert.equal(queryEvents(check, { tags: ['coding'], limit: 50 }).length, 1)
    assert.equal(queryEvents(check, { tags: ['cod'], limit: 50 }).length, 0)
    assert.equal(queryEvents(check, { tags: ['coding', 'project'], limit: 50 }).length, 0)
    assert.equal(queryEvents(check, { tags: ['中文'], limit: 50 }).length, 0)
    assert.equal(countEvents(check, {}), 3)
    check.close()
  })

  it('treats tag filters as data, never as SQL', () => {
    const check = memory()
    insertEvent(check, { ...base, summary: 'A' })
    const evil = ["'; DROP TABLE events; --", 'OR 1=1 --', '" UNION SELECT * FROM events --', '%']
    for (const tag of evil) assert.equal(queryEvents(check, { tags: [tag], limit: 10 }).length, 0, tag)
    assert.equal(countEvents(check, {}), 1)
    const stored = insertEvent(check, { rawText: "Robert'); DROP TABLE events;--", summary: "'); DELETE FROM events WHERE 1=1; --" })
    assert.equal(getEvent(check, stored.id).rawText, "Robert'); DROP TABLE events;--")
    assert.equal(countEvents(check, {}), 2)
    check.close()
  })

  it('honours time bounds and sort orders', () => {
    const check = memory()
    insertEvent(check, { ...base, summary: 'A', mel: 95, rri: 12, tsaMinutes: 120, eventTime: '2026-01-01T10:00:00Z' })
    insertEvent(check, { ...base, summary: 'B', mel: 60, rri: 90, tsaMinutes: 30, eventTime: '2026-01-02T10:00:00Z' })
    insertEvent(check, { ...base, summary: 'C', mel: null, rri: null, tsaMinutes: null, eventTime: '2026-01-03T10:00:00Z' })
    assert.deepEqual(queryEvents(check, { limit: 50, sort: 'time_asc' }).map((e) => e.summary), ['A', 'B', 'C'])
    assert.deepEqual(queryEvents(check, { limit: 50, sort: 'time_desc' }).map((e) => e.summary), ['C', 'B', 'A'])
    assert.deepEqual(queryEvents(check, { limit: 2, sort: 'tsa_desc' }).map((e) => e.summary), ['A', 'B'])
    assert.deepEqual(queryEvents(check, { limit: 2, sort: 'mel_desc' }).map((e) => e.summary), ['A', 'B'])
    assert.deepEqual(queryEvents(check, { limit: 2, sort: 'rri_asc' }).map((e) => e.summary), ['A', 'B'])
    assert.equal(queryEvents(check, { from: '2100-01-01T00:00:00Z', limit: 5 }).length, 0)
    assert.equal(queryEvents(check, { to: '2000-01-01T00:00:00Z', limit: 5 }).length, 0)
    assert.equal(queryEvents(check, { from: '2026-01-02T00:00:00Z', to: '2026-01-03T00:00:00Z', limit: 5 }).length, 1)
    assert.equal(recentEvents(check, 1)[0].summary, 'C')
    assert.ok(queryEvents(check, { limit: 10_000, offset: -5 }).length <= 100)
    check.close()
  })

  it('maps null-prototype rows into plain objects', () => {
    const row = db.prepare('SELECT * FROM events LIMIT 1').get()
    assert.equal(Object.getPrototypeOf(row), null)
    const mapped = rowToEvent(row)
    assert.equal(Object.getPrototypeOf(mapped), Object.prototype)
    assert.ok(Array.isArray(mapped.tags))
  })
})

describe('aggregation semantics', () => {
  /** 三条事件：最新一条 MEL 96 / RRI 12，前一条 MEL 92 —— 趋势可判。 */
  function seeded() {
    const check = memory()
    insertEvent(check, { ...base, summary: 'old', mel: 50, rri: 50, roi: 2, arctic: 1, tsaMinutes: 10, eventTime: '2026-05-01T01:00:00Z' })
    insertEvent(check, { ...base, summary: 'ship', mel: 92, rri: 87, roi: 12.4, arctic: 4, tsaMinutes: 40, eventTime: '2026-05-01T02:00:00Z' })
    insertEvent(check, { ...base, summary: 'spin', mel: 96, rri: 12, roi: -3, arctic: -1, tsaMinutes: 120, eventTime: '2026-05-01T04:00:00Z' })
    return check
  }

  it('MEL and RRI read the latest value; ROI and ARCTIC accumulate; TSA sums', () => {
    const check = seeded()
    const window = aggregateWindow(check, {})
    assert.equal(window.count, 3)
    assert.equal(window.mel, 96)
    assert.equal(window.melPrevious, 92)
    assert.equal(window.rri, 12)
    assert.equal(window.roi, 11.4)
    assert.equal(window.arctic, 4)
    assert.equal(window.tsaMinutes, 170)
    // 聚合值按 2 位小数落盘，避免把浮点噪声写进观察数据
    assert.equal(window.melAvg, 79.33)
    assert.equal(window.rriAvg, 49.67)
    assert.equal(window.lastEventTime, '2026-05-01T04:00:00Z')
    check.close()
  })

  it('respects the window so a stale event cannot pollute today', () => {
    const check = seeded()
    const today = aggregateWindow(check, { from: '2026-05-01T02:00:00Z', to: '2026-05-01T05:00:00Z' })
    assert.equal(today.count, 2)
    assert.equal(today.mel, 96)
    assert.equal(today.melPrevious, 92)
    assert.equal(today.tsaMinutes, 160)
    check.close()
  })

  it('finds the trend predecessor across the whole timeline, not just the window', () => {
    const check = seeded()
    const onlyLatest = aggregateWindow(check, { from: '2026-05-01T03:00:00Z', to: '2026-05-01T05:00:00Z' })
    assert.equal(onlyLatest.count, 1)
    assert.equal(onlyLatest.melPrevious, 92)
    check.close()
  })

  it('counts the four MEL x RRI quadrants over the measured events only', () => {
    const check = seeded()
    insertEvent(check, { ...base, summary: 'unknown', mel: null, rri: null, eventTime: '2026-05-01T05:00:00Z' })
    const quad = quadrantCounts(check, {})
    // mel>=60 & rri>=40 → ship(92,87) + old(50,50 否) …
    assert.equal(quad.measured, 3)
    assert.equal(quad.high_high, 1)
    assert.equal(quad.high_low, 1)
    assert.equal(quad.low_high, 1)
    assert.equal(quad.low_low, 0)
    check.close()
  })

  it('groups tags with counts', () => {
    const check = memory()
    insertEvent(check, { ...base, tags: ['coding', 'project'] })
    insertEvent(check, { ...base, tags: ['coding'] })
    insertEvent(check, { ...base, tags: [] })
    const tags = tagCounts(check, { limit: 5 })
    assert.deepEqual(tags, [{ tag: 'coding', count: 2 }, { tag: 'project', count: 1 }])
    check.close()
  })
})
