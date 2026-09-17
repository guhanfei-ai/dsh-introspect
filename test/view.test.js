// 投影层：MEL × RRI 曲线数据、今日聚合、Recent、面板数据包与有界性。
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { openDatabase } from '../src/db/database.js'
import { insertEvent } from '../src/db/store.js'
import { buildDashboard, buildSeries, buildToday, buildTodayTimeline, listView, statusText, trimForList } from '../src/db/view.js'

let db

before(() => {
  db = openDatabase(':memory:').db
  // 三天数据，第三天（本地 2026-05-03）就是「今天」的基准。
  const rows = [
    ['2026-05-01T02:00:00Z', '研究 AI 工具两个小时', 96, 12, -3, -1, 120, ['thinking']],
    ['2026-05-01T09:00:00Z', '把第一版发布出去', 54, 91, 20, 6, 45, ['ship']],
    ['2026-05-02T03:00:00Z', '读了一篇长文', 70, 21, 1, 1, 30, ['reading']],
    ['2026-05-03T01:10:00Z', '写完并 commit', 92, 87, 12.4, 4, 40, ['coding', 'project']],
    ['2026-05-03T02:30:00Z', '又刷了一会信息流', null, null, null, -2, 25, ['drift']],
  ]
  for (const [eventTime, summary, mel, rri, roi, arctic, tsaMinutes, tags] of rows) {
    insertEvent(db, { rawText: `${summary}（原始描述）`, summary, mel, rri, roi, arctic, tsaMinutes, tags, eventTime })
  }
})

after(() => db?.close())

const TZ = -480 // UTC+8，本地 2026-05-03 的窗口
const NOON = Date.parse('2026-05-03T12:00:00Z') // 本地 20:00

describe('list view', () => {
  it('carries the axes and a derived gap but never the raw text', () => {
    const view = listView({ id: 1, eventTime: '2026-05-03T01:10:00Z', summary: 'x', mel: 92, rri: 87, roi: 12.4, arctic: 4, tsaMinutes: 40, tags: ['coding'] })
    assert.deepEqual(Object.keys(view).sort(), ['arctic', 'clock', 'gap', 'id', 'mel', 'melBand', 'roi', 'rri', 'stamp', 'summary', 'tags', 'time', 'tsaMinutes'])
    assert.equal(view.gap, 5)
    assert.equal(view.melBand, 'high')
    assert.equal(view.clock, '09:10')
    assert.equal('rawText' in view, false, '列表视图不携带原文，正文只在 introspect_get / 详情路由里给')
  })

  it('trims long summaries with an ellipsis', () => {
    assert.equal(trimForList('a'.repeat(200)).length, 120)
    assert.equal(trimForList('短', 5), '短')
  })
})

describe('today aggregation', () => {
  it('uses the caller local day boundary', () => {
    const today = buildToday(db, { nowMs: NOON, tzOffsetMinutes: TZ })
    assert.equal(today.date, '05-03')
    assert.equal(today.count, 2)
    assert.equal(today.mel, 92, 'lastNonNull: 最新一条没有 MEL，取上一条的 92')
    assert.equal(today.melPrevious, null, '窗口内只有一个 non-null MEL，无前驱')
    assert.equal(today.rri, 87, 'lastNonNull: 最新一条没有 RRI，取上一条的 87')
    assert.equal(today.roi, 12.4)
    assert.equal(today.arctic, 2)
    assert.equal(today.tsaMinutes, 65)
    assert.equal(today.tsaText, '1h05m')
    assert.equal(today.gap, 5, 'gap = 92 - 87 = 5')
  })

  it('moves the boundary with the timezone instead of the server clock', () => {
    const asUtc = buildToday(db, { nowMs: NOON, tzOffsetMinutes: 0 })
    assert.equal(asUtc.date, '05-03')
    const asUtcMinus = buildToday(db, { nowMs: Date.parse('2026-05-03T01:00:00Z'), tzOffsetMinutes: -480 })
    assert.equal(asUtcMinus.date, '05-03')
    const shifted = buildToday(db, { nowMs: Date.parse('2026-05-03T15:00:00Z'), tzOffsetMinutes: -480 })
    assert.equal(shifted.date, '05-03', '本地 23:00 仍属于同一天')
    assert.equal(buildToday(db, { nowMs: Date.parse('2026-05-03T16:30:00Z'), tzOffsetMinutes: -480 }).date, '05-04')
  })

  it('reports a trend direction from the previous event', () => {
    const today = buildToday(db, { nowMs: Date.parse('2026-05-01T10:00:00Z'), tzOffsetMinutes: TZ })
    assert.equal(today.mel, 54)
    assert.equal(today.melPrevious, 96)
    assert.equal(today.melTrend, -42)
    assert.equal(today.melDirection, 'down')
  })
})

describe('MEL x RRI series', () => {
  it('returns an ascending, bounded series with both axes', () => {
    const series = buildSeries(db, { hours: 24 * 10, limit: 60, nowMs: Date.parse('2026-05-04T00:00:00Z') })
    assert.equal(series.length, 5)
    assert.ok(series[0].time < series[series.length - 1].time)
    for (const point of series) {
      for (const key of ['id', 'time', 'mel', 'rri', 'roi', 'arctic', 'tsaMinutes', 'summary', 'gap']) assert.ok(key in point, key)
    }
    // 核心对照：高能量 / 低现实反馈与低能量 / 高现实反馈都能原样出现在同一轴上
    assert.deepEqual({ mel: series[0].mel, rri: series[0].rri, gap: series[0].gap }, { mel: 96, rri: 12, gap: 84 })
    assert.deepEqual({ mel: series[1].mel, rri: series[1].rri }, { mel: 54, rri: 91 })
  })

  it('keeps unknown points as null instead of interpolating', () => {
    const series = buildSeries(db, { hours: 24 * 10, limit: 60, nowMs: Date.parse('2026-05-04T00:00:00Z') })
    const last = series[series.length - 1]
    assert.equal(last.mel, null)
    assert.equal(last.rri, null)
    assert.equal(last.arctic, -2)
  })

  it('respects the window and the limit', () => {
    assert.equal(buildSeries(db, { hours: 2, limit: 60, nowMs: NOON }).length, 0)
    assert.equal(buildSeries(db, { hours: 24, limit: 60, nowMs: NOON }).length, 2)
    assert.equal(buildSeries(db, { hours: 24 * 10, limit: 2, nowMs: Date.parse('2026-05-04T00:00:00Z') }).length, 2)
  })

  it('cannot be pushed past the hard result cap', () => {
    const series = buildSeries(db, { hours: 24 * 10, limit: 100000, nowMs: Date.parse('2026-05-04T00:00:00Z') })
    assert.ok(series.length <= 100)
  })
})

describe('dashboard payload', () => {
  const dashboard = () => buildDashboard(db, { nowMs: NOON, tzOffsetMinutes: TZ, hours: 24, recentLimit: 3 })

  it('answers the panel three questions in one call', () => {
    const value = dashboard()
    assert.equal(value.ok, true)
    assert.equal(value.today.count, 2)
    assert.equal(value.window.count, 2)
    assert.ok(value.series.length <= 60)
    assert.equal(value.recent.length, 3)
    assert.equal(value.recent[0].summary, '又刷了一会信息流')
    assert.equal(value.totals.count, 5)
    assert.ok(Array.isArray(value.tags))
    assert.equal(value.quadrant.measured, 1, '24h 窗口里只有「写完并 commit」两个维度都已知')
    assert.equal(value.quadrant.high_high, 1)
  })

  it('stays small enough for a narrow panel', () => {
    const bytes = Buffer.byteLength(JSON.stringify(dashboard()))
    assert.ok(bytes < 16_000, `dashboard payload was ${bytes} bytes`)
  })

  it('is serializable (no null-prototype rows leaking out)', () => {
    const round = JSON.parse(JSON.stringify(dashboard()))
    assert.equal(round.recent[1].summary, '写完并 commit')
    assert.deepEqual(Object.getPrototypeOf(round.today), Object.prototype)
  })
})

describe('today timeline', () => {
  it('lists today oldest-first and flags truncation', () => {
    const value = buildTodayTimeline(db, { nowMs: NOON, tzOffsetMinutes: TZ, limit: 20 })
    assert.equal(value.events, 2)
    assert.equal(value.truncated, false)
    assert.deepEqual(value.timeline.map((e) => e.summary), ['写完并 commit', '又刷了一会信息流'])
    const capped = buildTodayTimeline(db, { nowMs: NOON, tzOffsetMinutes: TZ, limit: 1 })
    assert.equal(capped.truncated, true)
    assert.equal(capped.timeline.length, 1)
    assert.equal(capped.timeline[0].summary, '写完并 commit')
  })

  it('never returns more than 50 rows however large the limit', () => {
    assert.ok(buildTodayTimeline(db, { nowMs: NOON, tzOffsetMinutes: TZ, limit: 9000 }).timeline.length <= 50)
  })
})

describe('status text', () => {
  it('is compact, factual and bounded', () => {
    const text = statusText(db, { nowMs: NOON, tzOffsetMinutes: TZ, hours: 24 })
    assert.match(text, /^TODAY\n/)
    // lastNonNull：最新一条没有 MEL，取上一条的 92；窗口内只有一个 non-null MEL，trend flat
    assert.match(text, /MEL\s+92\s+band creative\s+trend flat/)
    assert.match(text, /RRI\s+87\s+avg 87/, 'lastNonNull 取上一条的 87')
    assert.match(text, /ROI\s+\+12\.4/)
    assert.match(text, /TSA\s+1h05m/)
    assert.match(text, /Events\s+2 today \/ 5 total/)
    assert.match(text, /Gap\s+\+5\s+\(energy - reality, raw units\)/)
    assert.ok(text.split('\n').length <= 14)
    assert.ok(Buffer.byteLength(text) < 700)
    assert.doesNotMatch(text, /good|bad|should|failed|success/i)
  })

  it('says so when a day is empty instead of inventing zeros', () => {
    const empty = statusText(db, { nowMs: Date.parse('2026-06-01T12:00:00Z'), tzOffsetMinutes: TZ, hours: 24 })
    assert.match(empty, /Nothing recorded today yet\./)
    const scored = statusText(db, { nowMs: Date.parse('2026-05-03T03:00:00Z'), tzOffsetMinutes: TZ, hours: 24 })
    void scored
  })
})
