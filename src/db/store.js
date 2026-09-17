// events 表的读写层。全部 SQL 都是参数化占位符，字符串只出现在
// 常量表里（排序白名单），永远不把用户输入拼进 SQL。
import { nowIso } from '../time.js'

const COLUMNS = `
  id, created_at, updated_at, event_time, raw_text, summary,
  mel, roi, arctic, tsa_minutes, rri,
  mel_reason, roi_reason, arctic_reason, rri_reason,
  tags_json, metadata_json, source, session_id`

/** 排序白名单：值→SQL 片段，绝不接受外部拼串。 */
export const SORTS = Object.freeze({
  time_desc: 'event_time DESC, id DESC',
  time_asc: 'event_time ASC, id ASC',
  mel_desc: 'mel IS NULL, mel DESC, id DESC',
  mel_asc: 'mel IS NULL, mel ASC, id ASC',
  rri_desc: 'rri IS NULL, rri DESC, id DESC',
  rri_asc: 'rri IS NULL, rri ASC, id ASC',
  roi_desc: 'roi IS NULL, roi DESC, id DESC',
  arctic_desc: 'arctic IS NULL, arctic DESC, id DESC',
  tsa_desc: 'tsa_minutes IS NULL, tsa_minutes DESC, id DESC',
})

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text)
    return value === null || value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

/** SQLite 行（snake_case、null 原型）→ 领域对象（camelCase、普通对象）。 */
export function rowToEvent(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventTime: row.event_time,
    rawText: row.raw_text,
    summary: row.summary,
    mel: row.mel,
    roi: row.roi,
    arctic: row.arctic,
    tsaMinutes: row.tsa_minutes,
    rri: row.rri,
    melReason: row.mel_reason,
    roiReason: row.roi_reason,
    arcticReason: row.arctic_reason,
    rriReason: row.rri_reason,
    tags: parseJson(row.tags_json, []),
    metadata: parseJson(row.metadata_json, {}),
    source: row.source,
    sessionId: row.session_id,
  }
}

function toJson(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback)
  } catch {
    return JSON.stringify(fallback)
  }
}

/**
 * 插入一条事件。event 已经过 metrics 层校验与规范化。
 * @returns 完整事件（含 id 与时间戳）
 */
export function insertEvent(db, event) {
  const createdAt = event.createdAt ?? nowIso()
  const updatedAt = event.updatedAt ?? createdAt
  const eventTime = event.eventTime ?? createdAt
  const info = db
    .prepare(`INSERT INTO events (
        created_at, updated_at, event_time, raw_text, summary,
        mel, roi, arctic, tsa_minutes, rri,
        mel_reason, roi_reason, arctic_reason, rri_reason,
        tags_json, metadata_json, source, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      createdAt,
      updatedAt,
      eventTime,
      event.rawText,
      event.summary,
      event.mel ?? null,
      event.roi ?? null,
      event.arctic ?? null,
      event.tsaMinutes ?? null,
      event.rri ?? null,
      event.melReason ?? null,
      event.roiReason ?? null,
      event.arcticReason ?? null,
      event.rriReason ?? null,
      toJson(event.tags, []),
      toJson(event.metadata, {}),
      event.source ?? 'dsh',
      event.sessionId ?? null,
    )
  return getEvent(db, Number(info.lastInsertRowid))
}

export function getEvent(db, id) {
  const row = db.prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`).get(Number(id))
  return rowToEvent(row)
}

export function eventExists(db, id) {
  const row = db.prepare('SELECT 1 AS hit FROM events WHERE id = ?').get(Number(id))
  return Boolean(row)
}

/** 可更新字段白名单（camelCase → 列名）。 */
const UPDATABLE = Object.freeze({
  rawText: 'raw_text',
  summary: 'summary',
  eventTime: 'event_time',
  mel: 'mel',
  roi: 'roi',
  arctic: 'arctic',
  tsaMinutes: 'tsa_minutes',
  rri: 'rri',
  melReason: 'mel_reason',
  roiReason: 'roi_reason',
  arcticReason: 'arctic_reason',
  rriReason: 'rri_reason',
  tags: 'tags_json',
  metadata: 'metadata_json',
})

/**
 * 局部更新；只写真正传入的字段，其余保持不变。updated_at 总是刷新。
 * @returns 更新后的完整事件，找不到返回 null
 */
export function updateEvent(db, id, patch = {}) {
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error('event id must be a positive integer')
  if (!eventExists(db, numericId)) return null
  const sets = []
  const args = []
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const value = patch[key]
    if (key === 'tags' || key === 'metadata') {
      args.push(toJson(value, key === 'tags' ? [] : {}))
    } else {
      args.push(value === undefined ? null : value)
    }
    sets.push(`${column} = ?`)
  }
  if (sets.length === 0) return getEvent(db, numericId)
  args.push(nowIso(), numericId)
  db.prepare(`UPDATE events SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args)
  return getEvent(db, numericId)
}

/** 删除单条事件（数据主权属于用户，调用方需已过确认）。 */
export function deleteEvent(db, id) {
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error('event id must be a positive integer')
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(numericId)
  return Number(info.changes) > 0
}

/** 时间窗 + 标签的 WHERE 片段与参数（内部工具，两处查询共用）。 */
function buildFilter({ from, to, tags, sessionId }) {
  const where = []
  const args = []
  if (from) {
    where.push('event_time >= ?')
    args.push(from)
  }
  if (to) {
    where.push('event_time < ?')
    args.push(to)
  }
  if (sessionId) {
    where.push('session_id = ?')
    args.push(String(sessionId))
  }
  for (const tag of tags ?? []) {
    // EXISTS + json_each：精确匹配单个标签，不做 LIKE 子串糊弄。
    where.push('EXISTS (SELECT 1 FROM json_each(events.tags_json) j WHERE j.value = ?)')
    args.push(String(tag))
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
}

export function queryEvents(db, options = {}) {
  const limit = clampLimit(options.limit, 20, 100)
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  const order = SORTS[options.sort] ?? SORTS.time_desc
  const { clause, args } = buildFilter(options)
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM events ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
  return rows.map(rowToEvent)
}

export function countEvents(db, options = {}) {
  const { clause, args } = buildFilter(options)
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`).get(...args)
  return Number(row?.n ?? 0)
}

function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/** 最近 n 条（按发生时间倒序），用于面板 Recent 与曲线。 */
export function recentEvents(db, limit = 20) {
  return queryEvents(db, { limit: clampLimit(limit, 20, 200), sort: 'time_desc' })
}

/**
 * 窗口内某列最近一个非空值（lastNonNull 语义）。
 * 每个指标独立取——记录一条只含 RRI 的事件不应让 MEL 消失。
 * whereExtra 应以 "WHERE" 或 "... AND" 结尾（由 buildFilter 生成）。
 */
function lastNonNullMetric(db, column, whereExtra, args) {
  const row = db.prepare(
    `SELECT ${column} AS v, event_time AS t FROM events ${whereExtra} ${column} IS NOT NULL ORDER BY event_time DESC, id DESC LIMIT 1`,
  ).get(...args)
  return row ? { value: Number(row.v), time: row.t } : null
}

/**
 * 窗口聚合。每个指标按自己的语义聚合（见 docs/METRICS.md）：
 * MEL/RRI 取 lastNonNull + avg，ROI/ARCTIC 取当日累计，TSA 取 SUM。
 * 趋势 = 最近两个 non-null MEL 之差。
 */
export function aggregateWindow(db, options = {}) {
  const { clause, args } = buildFilter(options)
  const whereExtra = clause ? `${clause} AND` : 'WHERE'
  const row = db.prepare(`
    SELECT
      COUNT(*)                       AS n,
      MAX(event_time)                AS last_time,
      AVG(mel)                       AS mel_avg,
      AVG(rri)                       AS rri_avg,
      AVG(roi)                       AS roi_avg,
      SUM(roi)                       AS roi_sum,
      SUM(arctic)                    AS arctic_sum,
      SUM(tsa_minutes)               AS tsa_sum,
      COUNT(mel)                     AS mel_seen,
      COUNT(rri)                     AS rri_seen,
      COUNT(tsa_minutes)             AS tsa_seen
    FROM events ${clause}`).get(...args)
  const count = Number(row?.n ?? 0)
  const melLnn = lastNonNullMetric(db, 'mel', whereExtra, args)
  const rriLnn = lastNonNullMetric(db, 'rri', whereExtra, args)
  const roiLnn = lastNonNullMetric(db, 'roi', whereExtra, args)
  const arcticLnn = lastNonNullMetric(db, 'arctic', whereExtra, args)
  const tsaLnn = lastNonNullMetric(db, 'tsa_minutes', whereExtra, args)
  // MEL 趋势：窗口内最近两个 non-null MEL 之差
  const melTwo = db.prepare(
    `SELECT mel FROM events ${clause ? `${clause} AND` : 'WHERE'} mel IS NOT NULL ORDER BY event_time DESC, id DESC LIMIT 2`,
  ).all(...args)
  const melLatest = melTwo.length >= 1 ? Number(melTwo[0].mel) : null
  const melPrevious = melTwo.length >= 2 ? Number(melTwo[1].mel) : null
  return {
    count,
    mel: melLnn ? melLnn.value : null,
    melPrevious: melPrevious,
    melAvg: round(row?.mel_avg),
    rri: rriLnn ? rriLnn.value : null,
    rriAvg: round(row?.rri_avg),
    roi: round(row?.roi_sum),
    roiAvg: round(row?.roi_avg),
    arctic: round(row?.arctic_sum),
    tsaMinutes: round(row?.tsa_sum),
    tsaLatest: tsaLnn ? tsaLnn.value : null,
    arcticLatest: arcticLnn ? arcticLnn.value : null,
    roiLatest: roiLnn ? roiLnn.value : null,
    lastEventTime: row?.last_time ?? null,
  }
}

function round(value, digits = 2) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const factor = 10 ** digits
  return Math.round(n * factor) / factor
}

/** 同一条时间线上，latest 之前的那一条（用于 MEL 趋势箭头）。 */
function priorEvent(db, latest) {
  const row = db.prepare(`
    SELECT id FROM events
    WHERE event_time < ? OR (event_time = ? AND id < ?)
    ORDER BY event_time DESC, id DESC LIMIT 1`).get(latest.eventTime, latest.eventTime, latest.id)
  if (!row) return null
  return getEvent(db, Number(row.id))
}

/** 标签分布：GROUP BY 标签值，按次数倒序。 */
export function tagCounts(db, options = {}) {
  const limit = clampLimit(options.limit, 8, 30)
  const { clause, args } = buildFilter(options)
  const where = clause ? `${clause} AND` : 'WHERE'
  const rows = db.prepare(`
    SELECT j.value AS tag, COUNT(*) AS n
    FROM events, json_each(events.tags_json) j
    ${where} j.value IS NOT NULL AND j.value <> ''
    GROUP BY j.value
    ORDER BY n DESC, j.value ASC
    LIMIT ?`).all(...args, limit)
  return rows.map((row) => ({ tag: String(row.tag), count: Number(row.n) }))
}

/**
 * MEL × RRI 四象限计数（高低以 60 为界：MEL 旧体系的「正常能量区」下沿，
 * RRI 的 medium 下沿）。两个维度都已知的事件才参与统计。
 */
export const QUADRANT_THRESHOLD = Object.freeze({ mel: 60, rri: 40 })

export function quadrantCounts(db, options = {}) {
  const { clause, args } = buildFilter(options)
  const rows = db.prepare(`
    SELECT
      CASE WHEN mel >= ? THEN 'high' ELSE 'low' END AS mel_side,
      CASE WHEN rri >= ? THEN 'high' ELSE 'low' END AS rri_side,
      COUNT(*) AS n
    FROM events
    ${clause ? `${clause} AND` : 'WHERE'} mel IS NOT NULL AND rri IS NOT NULL
    GROUP BY mel_side, rri_side`).all(QUADRANT_THRESHOLD.mel, QUADRANT_THRESHOLD.rri, ...args)
  const out = { high_high: 0, high_low: 0, low_high: 0, low_low: 0, measured: 0 }
  for (const row of rows) {
    const key = `${row.mel_side}_${row.rri_side}`
    const count = Number(row.n)
    if (key in out) out[key] += count
    out.measured += count
  }
  return out
}

export function totalEvents(db) {
  const row = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first_at FROM events').get()
  return { count: Number(row?.n ?? 0), firstCreatedAt: row?.first_at ?? null }
}
