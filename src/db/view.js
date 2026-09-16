// 事件 → 观察投影。所有聚合语义都集中在这里，指标本身不被修改
// （数据库永远存原始值，Energy-Reality Gap 一类的派生量只在读出时算）。
import { METRIC_SPECS, energyRealityGap, fixed, formatMinutes, melBand, signed } from '../metrics.js'
import { localClock, localStamp, todayBounds } from '../time.js'
import { aggregateWindow, countEvents, queryEvents, recentEvents, tagCounts, totalEvents, quadrantCounts } from './store.js'

export const MAX_SUMMARY_IN_LIST = 120

/** 有界展示用的截断（码位安全，附省略号）。 */
export function trimForList(text, limit = MAX_SUMMARY_IN_LIST) {
  const chars = [...String(text ?? '')]
  if (chars.length <= limit) return String(text ?? '')
  return `${chars.slice(0, limit - 1).join('')}…`
}

/** 面板/时间线用的轻量事件视图（含派生 gap，不含 raw_text）。 */
export function listView(event) {
  return {
    id: event.id,
    time: event.eventTime,
    clock: localClock(event.eventTime),
    stamp: localStamp(event.eventTime),
    summary: trimForList(event.summary),
    mel: event.mel,
    rri: event.rri,
    roi: event.roi,
    arctic: event.arctic,
    tsaMinutes: event.tsaMinutes,
    melBand: melBand(event.mel)?.key ?? null,
    gap: energyRealityGap(event.mel, event.rri),
    tags: Array.isArray(event.tags) ? event.tags.slice(0, 8) : [],
  }
}

/** 时间升序的 MEL × RRI 曲线数据（面板核心图）。 */
export function buildSeries(db, { hours = 24, limit = 60, nowMs = Date.now() }) {
  const window = hours * 3_600_000
  const from = new Date(nowMs - window).toISOString()
  const to = new Date(nowMs + 60_000).toISOString()
  const rows = queryEvents(db, { from, to, limit, sort: 'time_asc' })
  return rows.map((event) => ({
    id: event.id,
    time: event.eventTime,
    mel: event.mel,
    rri: event.rri,
    roi: event.roi,
    arctic: event.arctic,
    tsaMinutes: event.tsaMinutes,
    summary: trimForList(event.summary, 60),
    gap: energyRealityGap(event.mel, event.rri),
  }))
}

/** 今日聚合（面板顶部五个指标 + introspect_status 的原料）。 */
export function buildToday(db, { nowMs = Date.now(), tzOffsetMinutes }) {
  const bounds = todayBounds(nowMs, tzOffsetMinutes)
  const aggregate = aggregateWindow(db, { from: bounds.startIso, to: bounds.endIso })
  const trend = aggregate.mel !== null && aggregate.melPrevious !== null
    ? Math.round((aggregate.mel - aggregate.melPrevious) * 100) / 100
    : null
  return {
    date: localStamp(bounds.startIso, tzOffsetMinutes).slice(0, 5),
    ...aggregate,
    melTrend: trend,
    melDirection: trend === null ? 'flat' : trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
    gap: energyRealityGap(aggregate.mel, aggregate.rri),
    tsaText: formatMinutes(aggregate.tsaMinutes) ?? '0m',
  }
}

/** 面板一屏所需的全部数据：状态 + 曲线 + Recent + 标签 + 象限。 */
export function buildDashboard(db, options = {}) {
  const {
    nowMs = Date.now(),
    tzOffsetMinutes = new Date().getTimezoneOffset(),
    hours = 24,
    recentLimit = 8,
    seriesLimit = 60,
  } = options
  const today = buildToday(db, { nowMs, tzOffsetMinutes })
  const windowStart = new Date(nowMs - hours * 3_600_000).toISOString()
  const windowEnd = new Date(nowMs + 60_000).toISOString()
  const windowOptions = { from: windowStart, to: windowEnd }
  return {
    ok: true,
    op: 'dashboard',
    generatedAt: new Date(nowMs).toISOString(),
    hours,
    totals: totalEvents(db),
    today,
    window: aggregateWindow(db, windowOptions),
    series: buildSeries(db, { hours, limit: seriesLimit, nowMs }),
    recent: recentEvents(db, recentLimit).map(listView),
    tags: tagCounts(db, { ...windowOptions, limit: 6 }),
    quadrant: quadrantCounts(db, windowOptions),
  }
}

/** 今日时间线（introspect_today）：默认 20 条，超出置 truncated。 */
export function buildTodayTimeline(db, { nowMs = Date.now(), tzOffsetMinutes, limit = 20 } = {}) {
  const bounds = todayBounds(nowMs, tzOffsetMinutes)
  const capped = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)))
  const rows = queryEvents(db, { from: bounds.startIso, to: bounds.endIso, limit: capped + 1, sort: 'time_asc' })
  const truncated = rows.length > capped
  const timeline = rows.slice(0, capped).map(listView)
  const aggregate = aggregateWindow(db, { from: bounds.startIso, to: bounds.endIso })
  return {
    ok: true,
    op: 'today',
    date: localStamp(bounds.startIso, tzOffsetMinutes).slice(0, 5),
    events: aggregate.count,
    truncated,
    mel: aggregate.mel,
    melAvg: aggregate.melAvg,
    rri: aggregate.rri,
    rriAvg: aggregate.rriAvg,
    roi: aggregate.roi,
    arctic: aggregate.arctic,
    tsaMinutes: aggregate.tsaMinutes,
    tsaText: formatMinutes(aggregate.tsaMinutes) ?? '0m',
    gap: energyRealityGap(aggregate.mel, aggregate.rri),
    timeline,
  }
}

/**
 * introspect_status 的紧凑文本视图（agent-friendly、有界）。
 * 只呈现事实与聚合值，不写评语。
 */
export function statusText(db, { nowMs = Date.now(), tzOffsetMinutes = new Date().getTimezoneOffset(), hours = 24 } = {}) {
  const today = buildToday(db, { nowMs, tzOffsetMinutes })
  const totals = totalEvents(db)
  const lines = [
    'TODAY',
    `MEL      ${fixed(today.mel) ?? '-'}   band ${melBand(today.mel)?.label ?? '-'}   trend ${today.melDirection}`,
    `RRI      ${fixed(today.rri) ?? '-'}   avg ${fixed(today.rriAvg) ?? '-'}`,
    `ROI      ${signed(today.roi, 1) ?? '-'}   (sum of the day)`,
    `ARCTIC   ${signed(today.arctic) ?? '-'}   (cumulative direction)`,
    `TSA      ${today.tsaText}`,
    '',
    `Events   ${today.count} today / ${totals.count} total`,
    `Gap      ${signed(today.gap) ?? '-'}   (energy - reality, raw units)`,
  ]
  if (today.count === 0) {
    lines.push('', 'Nothing recorded today yet.')
  }
  lines.push('', `Window: last ${hours}h carries ${countEvents(db, { from: new Date(nowMs - hours * 3_600_000).toISOString(), to: new Date(nowMs + 60_000).toISOString() })} events.`)
  return lines.join('\n')
}

/** 曲线两轴的量纲说明（面板与工具共用，避免各处硬编码）。 */
export const SERIES_AXES = Object.freeze({
  mel: Object.freeze({ min: METRIC_SPECS.mel.min, max: METRIC_SPECS.mel.max, label: 'MEL' }),
  rri: Object.freeze({ min: METRIC_SPECS.rri.min, max: METRIC_SPECS.rri.max, label: 'RRI' }),
})
