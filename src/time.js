// 时间边界：数据库一律存 UTC ISO-8601（带 Z），「今天」一律按调用方所在时区算。
//
// tzOffsetMinutes 采用 JS Date.getTimezoneOffset() 的语义：UTC = local + offset，
// 即 UTC+8 传 -480。客户端把自己浏览器的偏移量传给 host，面板上的「今天」
// 就跟着看的人走，而不是跟着服务器走。
//
// ponytail: 窗口内不做 DST 细分——整段窗口用同一个偏移量。中国无 DST；
// 有 DST 的地区在切换那一天可能偏一小时。升级路径：改用 IANA tz 名 + Intl
// 计算每天的偏移。

export const MINUTE_MS = 60_000
export const DAY_MS = 86_400_000

export function nowIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 本机（host 进程）偏移量，语义同 getTimezoneOffset()。 */
export function hostTzOffsetMinutes() {
  const offset = new Date().getTimezoneOffset()
  return Number.isFinite(offset) ? offset : 0
}

/** 把偏移量入参清洗成有限整数（非法值回退本机偏移）。 */
export function normalizeTzOffset(value, fallback = hostTzOffsetMinutes()) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(-840, Math.min(840, Math.round(value)))
  }
  return fallback
}

export function localDayStartUtc(nowMs, tzOffsetMinutes) {
  const localMs = nowMs - tzOffsetMinutes * MINUTE_MS
  return Math.floor(localMs / DAY_MS) * DAY_MS + tzOffsetMinutes * MINUTE_MS
}

/** [今天 00:00, 明天 00:00) 的 UTC 区间。 */
export function todayBounds(nowMs = Date.now(), tzOffsetMinutes = hostTzOffsetMinutes()) {
  const start = localDayStartUtc(nowMs, tzOffsetMinutes)
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + DAY_MS).toISOString(), startMs: start }
}

/**
 * 解析查询边界：接受 'YYYY-MM-DD'（按调用方时区的当天 00:00 / 23:59:59.999）
 * 或任意可被 Date 解析的 ISO 串。
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function coerceBound(value, { end = false, tzOffsetMinutes = hostTzOffsetMinutes() } = {}) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'date bounds must be strings' }
  const text = value.trim()
  if (!text) return { ok: true, value: null }
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
  if (dayOnly) {
    const dayStartLocal = Date.parse(`${text}T00:00:00Z`)
    if (!Number.isFinite(dayStartLocal)) return { ok: false, error: `cannot parse date ${JSON.stringify(text)}` }
    const utcMs = dayStartLocal + tzOffsetMinutes * MINUTE_MS + (end ? DAY_MS - 1 : 0)
    return { ok: true, value: new Date(utcMs).toISOString() }
  }
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return { ok: false, error: `cannot parse date ${JSON.stringify(text)}` }
  return { ok: true, value: new Date(parsed).toISOString() }
}

/** ISO(UTC) → 调用方时区的 'MM-DD HH:mm'。用于工具里的紧凑文本输出。 */
export function localStamp(iso, tzOffsetMinutes = hostTzOffsetMinutes()) {
  const ms = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(ms)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const d = new Date(ms - tzOffsetMinutes * MINUTE_MS)
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** ISO(UTC) → 调用方时区的 'HH:mm'。 */
export function localClock(iso, tzOffsetMinutes = hostTzOffsetMinutes()) {
  const stamp = localStamp(iso, tzOffsetMinutes)
  return stamp ? stamp.slice(-5) : ''
}
