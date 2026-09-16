// 五个观察维度的量纲、取值域与校验 —— 全插件唯一真源。
//
// 量纲继承自旧 tay2mel 体系（见 docs/METRICS.md 的「与旧系统的关系」）：
//   MEL    0-200   心智能量（旧系统上限 160/200 二说，取 200）
//   RRI    0-100   现实反馈指数
//   ROI    无界     个人效用净额（元当量点数，可负）
//   ARCTIC 每事件有向步长（旧系统是 21km 递减里程表，新模型改为方向增量）
//   TSA    分钟     该事件消耗的有限时间，可为 null
//
// 全部指标允许 null。Unknown > fabricated precision：拿不准就留空，
// 绝不替用户编一个精确数字。

export const METRICS_VERSION = 1

/** 单值指标规格：min/max 为硬边界（越界即校验错误，不做静默钳制）。 */
export const METRIC_SPECS = Object.freeze({
  mel: Object.freeze({
    min: 0,
    max: 200,
    unit: 'points',
    label: 'MEL',
    name: 'Mental Energy Level',
    question: 'How much usable mental energy is available right now?',
  }),
  roi: Object.freeze({
    min: -1_000_000,
    max: 1_000_000,
    unit: 'utility points',
    label: 'ROI',
    name: 'Return On Investment',
    question: 'What did this exchange return to me relative to what it cost?',
  }),
  arctic: Object.freeze({
    min: -10,
    max: 10,
    unit: 'direction steps',
    label: 'ARCTIC',
    name: 'Direction / Goal Alignment',
    question: 'Did this move me closer to where I actually want to go, or further away?',
  }),
  rri: Object.freeze({
    min: 0,
    max: 100,
    unit: 'points',
    label: 'RRI',
    name: 'Reality Response Index',
    question: 'Did the real world observably move, independently of how it felt?',
  }),
  tsaMinutes: Object.freeze({
    min: 0,
    max: 10_080,
    unit: 'minutes',
    label: 'TSA',
    name: 'Time Spent / Time Scarcity Accounting',
    question: 'How much of a finite day did this consume?',
  }),
})

export const METRIC_KEYS = Object.freeze(['mel', 'roi', 'arctic', 'rri', 'tsaMinutes'])
export const REASON_KEYS = Object.freeze(['melReason', 'roiReason', 'arcticReason', 'rriReason'])
export const NULLABLE_METRICS = METRIC_KEYS

/** 旧系统 MEL 四区（判读用，不是诊断标签）。 */
export const MEL_BANDS = Object.freeze([
  Object.freeze({ key: 'low', label: 'low energy', min: 0, max: 59 }),
  Object.freeze({ key: 'normal', label: 'balanced', min: 60, max: 79 }),
  Object.freeze({ key: 'high', label: 'creative', min: 80, max: 99 }),
  Object.freeze({ key: 'over', label: 'over-limit', min: 100, max: 200 }),
])

/** RRI 五档（沿用旧 tools_rri 的档位名）。 */
export const RRI_BANDS = Object.freeze([
  Object.freeze({ key: 'very_low', label: 'very low', min: 0, max: 20 }),
  Object.freeze({ key: 'low', label: 'low', min: 21, max: 40 }),
  Object.freeze({ key: 'medium', label: 'medium', min: 41, max: 60 }),
  Object.freeze({ key: 'high', label: 'high', min: 61, max: 80 }),
  Object.freeze({ key: 'very_high', label: 'very high', min: 81, max: 100 }),
])

export function bandOf(bands, value) {
  if (value === null || value === undefined || !bands || bands.length === 0) return null
  for (const band of bands) if (value >= band.min && value <= band.max) return band
  return bands[bands.length - 1]
}

export const melBand = (value) => bandOf(MEL_BANDS, value)
export const rriBand = (value) => bandOf(RRI_BANDS, value)

/**
 * Energy-Reality Gap：纯确定性派生量，不入库。
 * 两个维度量纲不同（MEL 可到 200，RRI 封顶 100），因此这里是「原始值之差」，
 * 只在两个值都已知时给出；UI 展示时另行归一化。不表示任何好坏判断。
 */
export function energyRealityGap(mel, rri) {
  if (typeof mel !== 'number' || typeof rri !== 'number') return null
  return Math.round((mel - rri) * 100) / 100
}

/** 把 MEL/RRI 归一到 0-100（仅用于同轴绘图，不改数据库里的原始值）。 */
export function normalizeTo100(value, spec) {
  if (typeof value !== 'number') return null
  const span = spec.max - spec.min
  if (!Number.isFinite(span) || span <= 0) return null
  return Math.max(0, Math.min(100, ((value - spec.min) / span) * 100))
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 校验并规范化一个指标输入。
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 */
export function coerceMetric(key, value) {
  const spec = METRIC_SPECS[key]
  if (!spec) return { ok: false, error: `unknown metric ${JSON.stringify(key)}` }
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    // 模型偶尔把数字写成字符串；接受可解析的数字，别为此报错。
    value = Number(value)
  }
  if (!isFiniteNumber(value)) {
    return { ok: false, error: `${key} must be a number or null, got ${JSON.stringify(value)}` }
  }
  if (value < spec.min || value > spec.max) {
    return {
      ok: false,
      error: `${key} must be between ${spec.min} and ${spec.max} (${spec.unit}); pass null when unsure`,
    }
  }
  return { ok: true, value }
}

/** 校验 tags：字符串数组，去空白、去重、限长限量。 */
export const MAX_TAGS = 8
export const MAX_TAG_CHARS = 32
export function coerceTags(value) {
  if (value === null || value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'tags must be an array of short strings' }
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, error: 'tags must be an array of short strings' }
    const tag = item.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!tag) continue
    if ([...tag].length > MAX_TAG_CHARS) {
      return { ok: false, error: `tag ${JSON.stringify(tag)} exceeds ${MAX_TAG_CHARS} characters` }
    }
    if (!out.includes(tag)) out.push(tag)
  }
  if (out.length > MAX_TAGS) return { ok: false, error: `at most ${MAX_TAGS} tags are allowed` }
  return { ok: true, value: out }
}

export const MAX_RAW_TEXT_CHARS = 8_000
export const MAX_SUMMARY_CHARS = 200
export const MAX_REASON_CHARS = 400

/** 截断到 n 个码位，附省略号（用于有界返回，绝不用于入库前静默截断）。 */
export function truncate(text, limit) {
  const chars = [...String(text ?? '')]
  if (chars.length <= limit) return { text: chars.join(''), truncated: false }
  return { text: `${chars.slice(0, Math.max(0, limit - 1)).join('')}…`, truncated: true }
}

export function coerceText(value, { field, max, required = false }) {
  if (value === null || value === undefined) {
    if (required) return { ok: false, error: `${field} is required` }
    return { ok: true, value: null }
  }
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` }
  const text = value.trim()
  if (!text) {
    if (required) return { ok: false, error: `${field} must not be empty` }
    return { ok: true, value: null }
  }
  if ([...text].length > max) {
    return { ok: false, error: `${field} exceeds ${max} characters; shorten it instead of dumping everything` }
  }
  return { ok: true, value: text }
}

/**
 * 校验一整组指标 + 理由 + 标签。
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function coerceObservation(input = {}) {
  const errors = []
  const value = {}
  for (const key of METRIC_KEYS) {
    const result = coerceMetric(key, input[key])
    if (result.ok) value[key] = result.value
    else errors.push(result.error)
  }
  for (const key of REASON_KEYS) {
    const result = coerceText(input[key], { field: key, max: MAX_REASON_CHARS })
    if (result.ok) value[key] = result.value
    else errors.push(result.error)
  }
  const tags = coerceTags(input.tags)
  if (tags.ok) value.tags = tags.value
  else errors.push(tags.error)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value }
}

/** 分钟 → 紧凑人类可读（122 → 2h02m）。 */
export function formatMinutes(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h${String(mins).padStart(2, '0')}m`
}

/** 有符号数展示（+6 / -3 / 0）。 */
export function signed(value, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Number(value.toFixed(digits))
  const text = digits > 0 ? rounded.toFixed(digits) : String(rounded)
  return rounded > 0 ? `+${text}` : text
}

/** 紧凑固定位展示（86 / 23.4）。 */
export function fixed(value, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value))
}
