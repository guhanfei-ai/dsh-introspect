// 七个 introspect_* 工具：插件只做存储、校验、聚合、查询；
// 理解自然语言与按 rubric 打分是 DSH 模型的活（插件自己不调 LLM）。
//
// schema description 里带的是从旧 tay2mel 提炼出的极简 rubric，
// 完整定义在 docs/METRICS.md。
//
// 参数 schema 只用单一类型（number/string/array），不写 union type：
// 「未知」靠省略字段表达（record）或 clear 数组表达（update），
// 这样对 provider 的结构化输出约束最友好。运行时仍然对 null 宽容。
import {
  MAX_RAW_TEXT_CHARS,
  MAX_SUMMARY_CHARS,
  METRIC_SPECS,
  coerceObservation,
  coerceText,
  energyRealityGap,
} from './metrics.js'
import { coerceBound, hostTzOffsetMinutes, nowIso } from './time.js'
import { deleteEvent, getEvent, insertEvent, queryEvents, updateEvent } from './db/store.js'
import { buildTodayTimeline, listView, statusText, trimForList } from './db/view.js'

const TOOL_TIMEOUT_MS = 15_000
const REASON_MAX = 400
export const CLEARABLE_FIELDS = Object.freeze(['mel', 'roi', 'arctic', 'tsaMinutes', 'rri', 'melReason', 'roiReason', 'arcticReason', 'rriReason'])

export function textOut(value) {
  return [{ type: 'text', text: String(value) }]
}

const METRIC_PROPERTIES = {
  mel: {
    type: 'number',
    minimum: METRIC_SPECS.mel.min,
    maximum: METRIC_SPECS.mel.max,
    description: 'Mental Energy Level 0-200: how much usable mental energy this state shows. 0-59 depleted / inner friction; 60-79 balanced; 80-99 creative flow; 100+ above baseline (a delivery just landed, or constructive anger charging up). Not physical fitness. Omit when unknowable.',
  },
  rri: {
    type: 'number',
    minimum: METRIC_SPECS.rri.min,
    maximum: METRIC_SPECS.rri.max,
    description: 'Reality Response Index 0-100: did the real world observably move, independently of how it felt? 0-20 purely internal (thinking, planning, feeling); 21-40 a faint trace (draft, plan shared, first ping); 41-60 a concrete external action landed (sent, committed, answered); 61-80 a real external response (adopted, approved, shipped and used); 81-100 a verifiable consequence (downloads, revenue, merged, published). Judge only physical/social/observable feedback — never whether it felt good, never long-term potential. Be conservative: when unsure, score lower. Omit when unknowable.',
  },
  roi: {
    type: 'number',
    description: `Personal utility balance of this exchange, in ${METRIC_SPECS.roi.unit} (元-equivalent points, not money): what came back now plus a conservatively discounted future return, minus what it cost in time / money / feeling / energy. Positive = net gain for you, near zero = wash, negative = it cost more than it returned. Deliberately personal, not financial ROI, and not a verdict on the worth of the event. Omit when unknowable.`,
  },
  arctic: {
    type: 'number',
    minimum: METRIC_SPECS.arctic.min,
    maximum: METRIC_SPECS.arctic.max,
    description: 'Direction step on -10..+10: did this move you toward where you actually want to go (+), away from it (-), or sideways (0)? Direction only — high energy and strong reality feedback can still point the wrong way. Omit when unknowable.',
  },
  tsaMinutes: {
    type: 'number',
    minimum: METRIC_SPECS.tsaMinutes.min,
    maximum: METRIC_SPECS.tsaMinutes.max,
    description: `Minutes of a finite day this consumed (${METRIC_SPECS.tsaMinutes.unit}). Only when the user actually said how long, explicitly or as a clear "about two hours". If the duration was not stated, omit it — never invent a precise number.`,
  },
  melReason: { type: 'string', maxLength: REASON_MAX, description: 'One short sentence: why this MEL value, in the terms the user used.' },
  rriReason: { type: 'string', maxLength: REASON_MAX, description: 'One short sentence: the external evidence behind the RRI score, or why none is visible.' },
  roiReason: { type: 'string', maxLength: REASON_MAX, description: 'One short sentence: what was paid and what came back.' },
  arcticReason: { type: 'string', maxLength: REASON_MAX, description: 'One short sentence: which direction this points and why.' },
  tags: {
    type: 'array',
    items: { type: 'string', maxLength: 32 },
    maxItems: 8,
    description: 'Up to 8 short lowercase topic tags, e.g. ["coding","project"]. Words from the event itself, never sentences.',
  },
}

const RAW_TEXT_PROPERTY = {
  type: 'string',
  maxLength: MAX_RAW_TEXT_CHARS,
  description: 'What the user said happened, kept verbatim as far as practical. This is the primary artifact: every metric can be re-derived from it later, so never replace it with an interpretation.',
}

const SUMMARY_PROPERTY = {
  type: 'string',
  maxLength: MAX_SUMMARY_CHARS,
  description: 'A short neutral label for the event (what happened, no verdict). Derived from the opening of rawText when omitted.',
}

const HAPPENED_AT_PROPERTY = {
  type: 'string',
  description: 'When it happened: ISO-8601 (with offset or Z) or "YYYY-MM-DD HH:mm" in the user\'s local time. Only when the user was explicit about the time; omit otherwise.',
}

/**
 * 校验 record 输入 → 可直接入库的事件对象。
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function buildRecord(args = {}, context = {}) {
  const errors = []
  const raw = coerceText(args.rawText, { field: 'rawText', max: MAX_RAW_TEXT_CHARS, required: true })
  const rawText = raw.ok ? raw.value : null
  if (!raw.ok) errors.push(raw.error)

  let summary = null
  if (args.summary === undefined || args.summary === null || String(args.summary).trim() === '') {
    // 模型没给 summary：取原文前 60 码位做标签，不额外编造措辞。
    summary = trimForList(rawText ?? '', 60)
  } else {
    const checked = coerceText(args.summary, { field: 'summary', max: MAX_SUMMARY_CHARS, required: true })
    if (checked.ok) summary = checked.value
    else errors.push(checked.error)
  }

  const observation = coerceObservation(args)
  if (!observation.ok) {
    errors.push(...observation.errors)
    observation.value = { tags: [] }
  }

  let eventTime = null
  if (args.happenedAt !== undefined && args.happenedAt !== null && String(args.happenedAt).trim() !== '') {
    const bound = coerceBound(args.happenedAt, { tzOffsetMinutes: context.tzOffsetMinutes ?? hostTzOffsetMinutes() })
    if (bound.ok) eventTime = bound.value
    else errors.push(bound.error)
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...observation.value,
      rawText,
      summary,
      eventTime: eventTime ?? nowIso(),
      source: context.source ?? 'dsh',
      sessionId: context.sessionId ?? null,
    },
  }
}

/**
 * update 的补丁校验：只处理真正出现的键（clear 里的字段显式置 null）。
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function buildPatch(args = {}, context = {}) {
  const patch = {}
  const errors = []
  const has = (key) => Object.prototype.hasOwnProperty.call(args, key)

  if (has('rawText')) {
    const checked = coerceText(args.rawText, { field: 'rawText', max: MAX_RAW_TEXT_CHARS, required: true })
    if (checked.ok) patch.rawText = checked.value
    else errors.push(checked.error)
  }
  if (has('summary')) {
    const checked = coerceText(args.summary, { field: 'summary', max: MAX_SUMMARY_CHARS, required: true })
    if (checked.ok) patch.summary = checked.value
    else errors.push(checked.error)
  }
  if (has('happenedAt')) {
    const bound = coerceBound(args.happenedAt, { tzOffsetMinutes: context.tzOffsetMinutes ?? hostTzOffsetMinutes() })
    if (bound.ok) patch.eventTime = bound.value
    else errors.push(bound.error)
  }
  for (const key of ['mel', 'roi', 'arctic', 'tsaMinutes', 'rri']) {
    if (!has(key) || args[key] === undefined) continue
    const spec = METRIC_SPECS[key]
    const numeric = typeof args[key] === 'string' && args[key].trim() !== '' ? Number(args[key]) : args[key]
    if (numeric === null) {
      patch[key] = null
    } else if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
      errors.push(`${key} must be a number, null, or listed in clear`)
    } else if (numeric < spec.min || numeric > spec.max) {
      errors.push(`${key} must be between ${spec.min} and ${spec.max} (${spec.unit}); use clear to drop it`)
    } else {
      patch[key] = numeric
    }
  }
  for (const key of ['melReason', 'roiReason', 'arcticReason', 'rriReason']) {
    if (!has(key) || args[key] === undefined) continue
    if (args[key] === null) {
      patch[key] = null
      continue
    }
    const checked = coerceText(args[key], { field: key, max: REASON_MAX })
    if (checked.ok) patch[key] = checked.value
    else errors.push(checked.error)
  }
  if (has('tags')) {
    const checked = coerceObservation({ tags: args.tags })
    if (checked.ok) patch.tags = checked.value.tags
    else errors.push(...checked.errors)
  }
  if (has('clear')) {
    if (!Array.isArray(args.clear)) errors.push('clear must be an array of field names')
    else {
      for (const key of args.clear) {
        if (!CLEARABLE_FIELDS.includes(key)) {
          errors.push(`clear accepts only ${CLEARABLE_FIELDS.join(', ')}`)
          continue
        }
        if (has(key)) errors.push(`cannot both set and clear ${key}`)
        else patch[key] = null
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  if (Object.keys(patch).length === 0) return { ok: false, errors: ['nothing to update: pass at least one field to change'] }
  return { ok: true, value: patch }
}

function positiveId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error('id must be a positive integer (take it from introspect_history or introspect_today).')
  return id
}

function fail(errors) {
  throw new Error(`introspect validation failed: ${errors.join('; ')}`)
}

function sessionOf(exec) {
  const session = exec?.agent?.session
  const id = session?.id ?? session?.header?.id ?? exec?.agent?.id
  return typeof id === 'string' && id ? id : null
}

/** 记录结果里的今日摘要（模型据此回应；面板另走只读路由取全量）。 */
function compactToday(db, context) {
  const timeline = buildTodayTimeline(db, { tzOffsetMinutes: context.tzOffsetMinutes, limit: 1 })
  return {
    events: timeline.events,
    mel: timeline.mel,
    rri: timeline.rri,
    roi: timeline.roi,
    arctic: timeline.arctic,
    tsaText: timeline.tsaText,
    gap: timeline.gap,
  }
}

/**
 * 组装七个工具定义。
 * @param {object} db node:sqlite 连接
 * @param {{tzOffsetMinutes?: number, chartHours?: number}} options
 */
export function defineTools(db, options = {}) {
  const context = { tzOffsetMinutes: options.tzOffsetMinutes ?? hostTzOffsetMinutes(), chartHours: options.chartHours ?? 24 }

  return [
    {
      name: 'introspect_record',
      description: 'Record one real event into the local personal telemetry store (SQLite) and project it onto five observation axes. Call it ONLY when the user explicitly asks to record or save something ("记录一下", "记一笔", "帮我保存", "把这个记下来", "/self ..."). Never call it for ordinary chat, never invent an event, never record on the user\'s behalf without being asked. You produce summary and metric scores from the rubrics below; the plugin validates and stores them. Unknown is better than fabricated precision: omit any axis the description cannot support.',
      parameters: {
        type: 'object',
        properties: { rawText: RAW_TEXT_PROPERTY, summary: SUMMARY_PROPERTY, happenedAt: HAPPENED_AT_PROPERTY, ...METRIC_PROPERTIES },
        required: ['rawText'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args, exec) {
        const built = buildRecord(args, { sessionId: sessionOf(exec), tzOffsetMinutes: context.tzOffsetMinutes })
        if (!built.ok) fail(built.errors)
        const event = insertEvent(db, built.value)
        const view = listView(event)
        return JSON.stringify({
          ok: true,
          op: 'record',
          event: {
            id: view.id,
            summary: view.summary,
            mel: view.mel,
            rri: view.rri,
            roi: view.roi,
            arctic: view.arctic,
            tsaMinutes: view.tsaMinutes,
            gap: energyRealityGap(event.mel, event.rri),
            tags: view.tags,
          },
          today: compactToday(db, context),
          note: 'Stored locally; the Introspect panel refreshes on its own. Nothing was uploaded.',
        })
      },
    },
    {
      name: 'introspect_status',
      description: 'Read the compact current state of the personal telemetry: today\'s MEL / RRI / ROI / ARCTIC / TSA, event counts and the energy-reality gap. The cheap first call for "what is my state now". Read-only.',
      parameters: {
        type: 'object',
        properties: { hours: { type: 'number', minimum: 1, maximum: 720, description: 'Window in hours for the trailing count (default 24).' } },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args) {
        const hours = Number.isFinite(Number(args?.hours)) && Number(args.hours) > 0 ? Number(args.hours) : context.chartHours
        return statusText(db, { tzOffsetMinutes: context.tzOffsetMinutes, hours })
      },
    },
    {
      name: 'introspect_today',
      description: 'Read today\'s aggregation and timeline (the local-timezone day, oldest first, up to 20 events with a truncated flag beyond that). For "what did I record today" and "where did today go". Read-only.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', minimum: 1, maximum: 50, description: 'Timeline length cap (default 20).' } },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args) {
        return JSON.stringify(buildTodayTimeline(db, { tzOffsetMinutes: context.tzOffsetMinutes, limit: args?.limit }))
      },
    },
    {
      name: 'introspect_history',
      description: 'Query recorded events across days: filter by date range and tags, order by any axis, bounded result count. SQLite does the filtering, sorting and aggregation; you do the reading. "What cost the most time in the last 7 days" → from + to + sort tsa_desc. "Which events had high energy but little reality feedback" → sort mel_desc, then compare rri. "How did MEL change recently" → sort time_asc. raw_text is not included here; use introspect_get for the verbatim original. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start bound: "YYYY-MM-DD" (the user\'s local day) or ISO-8601. Inclusive.' },
          to: { type: 'string', description: 'End bound, same formats; a bare date means its last moment.' },
          tags: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 4, description: 'Only events carrying ALL of these tags.' },
          sort: { type: 'string', enum: ['time_desc', 'time_asc', 'mel_desc', 'mel_asc', 'rri_desc', 'rri_asc', 'roi_desc', 'arctic_desc', 'tsa_desc'], description: 'Ordering (default time_desc = newest first).' },
          limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max rows (default 20, hard cap 100).' },
          offset: { type: 'number', minimum: 0, description: 'Skip this many rows (paging).' },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args) {
        const from = coerceBound(args?.from, { tzOffsetMinutes: context.tzOffsetMinutes })
        const to = coerceBound(args?.to, { end: true, tzOffsetMinutes: context.tzOffsetMinutes })
        if (!from.ok) fail([from.error])
        if (!to.ok) fail([to.error])
        const tags = Array.isArray(args?.tags) ? args.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 4) : []
        const sort = args?.sort ?? 'time_desc'
        const rows = queryEvents(db, { from: from.value, to: to.value, tags, sort, limit: args?.limit ?? 20, offset: args?.offset ?? 0 })
        return JSON.stringify({
          ok: true,
          op: 'history',
          filters: { from: from.value, to: to.value, tags, sort },
          returned: rows.length,
          offset: Math.max(0, Math.floor(Number(args?.offset) || 0)),
          events: rows.map(listView),
        })
      },
    },
    {
      name: 'introspect_get',
      description: 'Read one event in full: verbatim raw_text, summary, all five axes with their reasons, tags, timestamps and metadata. Take the id from introspect_history or introspect_today first. Read-only.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: 'Event id.' } },
        required: ['id'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args) {
        const id = positiveId(args?.id)
        const event = getEvent(db, id)
        if (!event) throw new Error(`No introspect event with id ${id}.`)
        const raw = [...event.rawText]
        const truncated = raw.length > MAX_RAW_TEXT_CHARS
        return JSON.stringify({
          ok: true,
          op: 'get',
          event: {
            ...event,
            rawText: truncated ? raw.slice(0, MAX_RAW_TEXT_CHARS).join('') : event.rawText,
            rawTextTruncated: truncated,
            gap: energyRealityGap(event.mel, event.rri),
          },
        })
      },
    },
    {
      name: 'introspect_update',
      description: 'Correct a recorded event. The user overriding a score is the normal case ("不对，RRI 应该是 20 不是 80") — re-record nothing, patch this row. Only the fields you pass change; list a field in `clear` to make it unknown again. Keep rawText as what actually happened. updated_at is bumped; there is deliberately no revision history.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Event id to correct.' },
          rawText: RAW_TEXT_PROPERTY,
          summary: SUMMARY_PROPERTY,
          happenedAt: HAPPENED_AT_PROPERTY,
          clear: { type: 'array', items: { type: 'string', enum: [...CLEARABLE_FIELDS] }, maxItems: CLEARABLE_FIELDS.length, description: 'Fields to set back to unknown instead of giving a value.' },
          ...METRIC_PROPERTIES,
        },
        required: ['id'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args) {
        const id = positiveId(args?.id)
        const patch = buildPatch(args, { tzOffsetMinutes: context.tzOffsetMinutes })
        if (!patch.ok) fail(patch.errors)
        const event = updateEvent(db, id, patch.value)
        if (!event) throw new Error(`No introspect event with id ${id}.`)
        return JSON.stringify({ ok: true, op: 'update', event: { ...listView(event), updatedAt: event.updatedAt } })
      },
    },
    {
      name: 'introspect_delete',
      description: 'Delete one recorded event permanently. It is the user\'s own data and deleting is legitimate — but never on your own initiative and never in bulk: only after the user clearly asked to remove a specific event, having named which one (id + summary), with confirm: true. The host shows a native approval prompt; if it is not granted, nothing is deleted.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Event id to delete.' },
          confirm: { type: 'boolean', description: 'Must be true: the user explicitly asked to delete this specific event.' },
        },
        required: ['id', 'confirm'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args) {
        if (args?.confirm !== true) throw new Error('introspect_delete requires confirm: true, set only after the user explicitly asked to delete this event.')
        const id = positiveId(args?.id)
        const event = getEvent(db, id)
        if (!event) throw new Error(`No introspect event with id ${id}.`)
        deleteEvent(db, id)
        return JSON.stringify({ ok: true, op: 'delete', deleted: { id, summary: trimForList(event.summary, 80), eventTime: event.eventTime } })
      },
    },
  ]
}

/** 删除必须过原生审批（工具层的 confirm 只是第一道防线）。 */
export function deleteApprovalReason(args) {
  const id = Number(args?.id)
  const label = Number.isInteger(id) && id > 0 ? `#${id}` : '(unknown id)'
  return `Delete introspect event ${label} from the local SQLite store permanently? Its raw text goes with it and this plugin cannot recover it.`
}

export const GUIDANCE = `## Introspection (dsh-introspect)

Personal self-observability, local-first: real events go into a local SQLite database, five observation axes are projected from them, and the right-side Introspect panel shows what is happening. Observe, do not judge.

Event first, metrics second. \`raw_text\` is the primary record and must be what actually happened. Metrics are a projection that can be re-derived later; never overwrite the raw account with an interpretation.

Tools:
- introspect_record(rawText, summary?, mel?, roi?, arctic?, tsaMinutes?, rri?, *Reason?, tags?, happenedAt?) — store one event.
- introspect_status() — today's compact state block.
- introspect_today() — today's counts and timeline.
- introspect_history(from?, to?, tags?, sort?, limit?, offset?) — bounded multi-day query; SQLite filters, sorts and aggregates.
- introspect_get(id) — one event with its verbatim raw text.
- introspect_update(id, ...) — correct a score when the user says it is wrong.
- introspect_delete(id, confirm: true) — remove one event, only when the user explicitly asked.

When to record: only on an explicit request ("记录一下", "记一笔", "帮我保存", "把这个记下来", "/self"). Ordinary conversation is never recorded and nothing is captured in the background: this plugin has no automatic chat capture and you must not build one. When the user simply talks about their day, talk with them; offer to record at most once.

How to score: read the axis descriptions in the tool schema and stay conservative.
- Unknown > fabricated precision. Omit any axis the description cannot support — above all tsaMinutes when no duration was mentioned. Never invent a minute count.
- RRI measures whether the real world observably moved: a physical change, another person's response, a verifiable outcome. It is independent of how the event felt, of whether it was worth doing, and of which way it pointed. Thinking hard about a brilliant idea can be MEL 95 / RRI 15; shipping something boring can be MEL 54 / RRI 91. Report both honestly instead of aligning them into a nicer story.
- These five axes are a personal observation model — not a scientific scale, a medical measure, a psychological diagnosis, or a verdict on the person. Never turn a number into self-criticism or praise. The panel deliberately shows no success colours.

Answering questions: prefer introspect_status and introspect_history over reasoning from memory, and quote stored values rather than rounding them into vagueness. Present an axis with its number ("MEL 92 · RRI 87") and leave the reading to the user.

Storage is local: $DSH_HOME/introspect/events.sqlite3 unless configured otherwise. This plugin uploads nothing, sends no telemetry, and makes no external AI call of its own.`
