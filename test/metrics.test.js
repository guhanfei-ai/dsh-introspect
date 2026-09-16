// 量纲、取值域与「未知优先于编造」的校验行为。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_RAW_TEXT_CHARS,
  METRIC_KEYS,
  METRIC_SPECS,
  bandOf,
  coerceMetric,
  coerceObservation,
  coerceTags,
  coerceText,
  energyRealityGap,
  fixed,
  formatMinutes,
  melBand,
  normalizeTo100,
  rriBand,
  signed,
  truncate,
} from '../src/metrics.js'
import {
  coerceBound,
  hostTzOffsetMinutes,
  localClock,
  localDayStartUtc,
  localStamp,
  nowIso,
  todayBounds,
} from '../src/time.js'

describe('metric ranges keep the old dimensions', () => {
  it('MEL runs to 200 and RRI to 100', () => {
    assert.deepEqual([METRIC_SPECS.mel.min, METRIC_SPECS.mel.max], [0, 200])
    assert.deepEqual([METRIC_SPECS.rri.min, METRIC_SPECS.rri.max], [0, 100])
    assert.deepEqual([METRIC_SPECS.arctic.min, METRIC_SPECS.arctic.max], [-10, 10])
    assert.deepEqual([METRIC_SPECS.tsaMinutes.min, METRIC_SPECS.tsaMinutes.max], [0, 10_080])
    assert.ok(METRIC_SPECS.roi.max > 1000, 'ROI stays an open personal-utility scale')
  })

  it('accepts in-range values and rejects out-of-range ones loudly', () => {
    assert.deepEqual(coerceMetric('mel', 87), { ok: true, value: 87 })
    assert.deepEqual(coerceMetric('mel', 200), { ok: true, value: 200 })
    assert.equal(coerceMetric('mel', 201).ok, false)
    assert.equal(coerceMetric('mel', -1).ok, false)
    assert.equal(coerceMetric('rri', 101).ok, false)
    assert.equal(coerceMetric('arctic', 11).ok, false)
    assert.equal(coerceMetric('rri', 'NaN').ok, false)
    assert.equal(coerceMetric('nope', 1).ok, false)
    // 越界绝不静默钳制：错误信息里带上量纲与 null 提示
    const error = coerceMetric('mel', 300).error
    assert.match(error, /between 0 and 200/)
    assert.match(error, /pass null when unsure/)
  })

  it('treats missing, empty and null as unknown rather than zero', () => {
    for (const key of METRIC_KEYS) {
      for (const value of [null, undefined, '']) {
        assert.deepEqual(coerceMetric(key, value), { ok: true, value: null }, `${key}=${String(value)}`)
      }
    }
  })

  it('accepts a numeric string a model may emit', () => {
    assert.deepEqual(coerceMetric('mel', '87.5'), { ok: true, value: 87.5 })
  })
})

describe('bands', () => {
  it('maps MEL onto the four legacy zones', () => {
    assert.equal(melBand(0).key, 'low')
    assert.equal(melBand(59).key, 'low')
    assert.equal(melBand(60).key, 'normal')
    assert.equal(melBand(79).key, 'normal')
    assert.equal(melBand(80).key, 'high')
    assert.equal(melBand(99).key, 'high')
    assert.equal(melBand(100).key, 'over')
    assert.equal(melBand(160).key, 'over')
    assert.equal(melBand(null), null)
  })

  it('maps RRI onto the five legacy levels', () => {
    assert.equal(rriBand(20).key, 'very_low')
    assert.equal(rriBand(21).key, 'low')
    assert.equal(rriBand(40).key, 'low')
    assert.equal(rriBand(41).key, 'medium')
    assert.equal(rriBand(60).key, 'medium')
    assert.equal(rriBand(61).key, 'high')
    assert.equal(rriBand(81).key, 'very_high')
    assert.equal(bandOf([], 5), null)
  })
})

describe('derived observation', () => {
  it('computes the energy-reality gap only when both sides are known', () => {
    assert.equal(energyRealityGap(92, 18), 74)
    assert.equal(energyRealityGap(54, 91), -37)
    assert.equal(energyRealityGap(90, 90), 0)
    assert.equal(energyRealityGap(null, 90), null)
    assert.equal(energyRealityGap(90, undefined), null)
  })

  it('normalizes to a shared 0-100 axis for drawing without touching stored values', () => {
    assert.equal(normalizeTo100(200, METRIC_SPECS.mel), 100)
    assert.equal(normalizeTo100(100, METRIC_SPECS.mel), 50)
    assert.equal(normalizeTo100(87, METRIC_SPECS.rri), 87)
    assert.equal(normalizeTo100(null, METRIC_SPECS.rri), null)
    assert.equal(normalizeTo100(500, METRIC_SPECS.mel), 100)
  })

  it('formats durations and signed values compactly', () => {
    assert.equal(formatMinutes(42), '42m')
    assert.equal(formatMinutes(120), '2h')
    assert.equal(formatMinutes(222), '3h42m')
    assert.equal(formatMinutes(0), null)
    assert.equal(formatMinutes(null), null)
    assert.equal(signed(6), '+6')
    assert.equal(signed(-3), '-3')
    assert.equal(signed(12.34, 1), '+12.3')
    assert.equal(signed(null), null)
    assert.equal(fixed(86.6), '87')
    assert.equal(fixed(86.64, 1), '86.6')
  })
})

describe('text and tag guards', () => {
  it('requires raw text and caps its length', () => {
    assert.equal(coerceText('', { field: 'rawText', max: 100, required: true }).ok, false)
    assert.equal(coerceText('x'.repeat(MAX_RAW_TEXT_CHARS + 1), { field: 'rawText', max: MAX_RAW_TEXT_CHARS }).ok, false)
    assert.deepEqual(coerceText('  hi  ', { field: 'rawText', max: 100 }), { ok: true, value: 'hi' })
  })

  it('truncates for display without pretending', () => {
    assert.deepEqual(truncate('abcdef', 10), { text: 'abcdef', truncated: false })
    assert.deepEqual(truncate('中文abcdef', 4), { text: '中文a…', truncated: true })
    assert.equal([...truncate('中文abcdef', 4).text].length, 4)
  })

  it('normalizes tags and refuses junk', () => {
    assert.deepEqual(coerceTags([' Coding ', 'coding', '项目']), { ok: true, value: ['coding', '项目'] })
    assert.deepEqual(coerceTags(null), { ok: true, value: [] })
    assert.equal(coerceTags('coding').ok, false)
    assert.equal(coerceTags([123]).ok, false)
    assert.equal(coerceTags(['a'.repeat(33)]).ok, false)
    assert.equal(coerceTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).ok, false)
  })

  it('collects every problem in one report instead of failing on the first', () => {
    const result = coerceObservation({ mel: 300, rri: -5, tags: 'nope', melReason: 'x'.repeat(500) })
    assert.equal(result.ok, false)
    assert.equal(result.errors.length, 4)
    const good = coerceObservation({ mel: 87, rriReason: 'committed and pushed' })
    assert.equal(good.ok, true)
    assert.equal(good.value.mel, 87)
    assert.equal(good.value.roi, null)
    assert.deepEqual(good.value.tags, [])
  })
})

describe('timezone handling', () => {
  const utcNoon = Date.parse('2026-03-05T12:00:00Z')

  it('UTC+8 local midnight is the previous 16:00 UTC', () => {
    const bounds = todayBounds(utcNoon, -480)
    assert.equal(bounds.startIso, '2026-03-04T16:00:00.000Z')
    assert.equal(bounds.endIso, '2026-03-05T16:00:00.000Z')
  })

  it('UTC-5 local midnight is 05:00 UTC', () => {
    assert.equal(todayBounds(utcNoon, 300).startIso, '2026-03-05T05:00:00.000Z')
  })

  it('a local date at 00:30 still belongs to that local day', () => {
    const justAfterMidnight = Date.parse('2026-03-04T16:30:00Z') // 00:30 (+8)
    const bounds = todayBounds(justAfterMidnight, -480)
    assert.equal(bounds.startIso, '2026-03-04T16:00:00.000Z')
    assert.equal(new Date(justAfterMidnight) >= new Date(bounds.startIso), true)
    assert.equal(new Date(justAfterMidnight) < new Date(bounds.endIso), true)
  })

  it('localDayStartUtc is idempotent', () => {
    const start = localDayStartUtc(utcNoon, -480)
    assert.equal(localDayStartUtc(start, -480), start)
  })

  it('parses date-only bounds in the caller timezone, day end inclusive', () => {
    assert.equal(coerceBound('2026-03-05', { tzOffsetMinutes: -480 }).value, '2026-03-04T16:00:00.000Z')
    assert.equal(coerceBound('2026-03-05', { end: true, tzOffsetMinutes: -480 }).value, '2026-03-05T15:59:59.999Z')
    assert.equal(coerceBound(null).value, null)
    assert.equal(coerceBound('  ').value, null)
    assert.equal(coerceBound('yesterday').ok, false)
    assert.equal(coerceBound(20260305).ok, false)
    assert.equal(coerceBound('2026-03-05T10:00:00Z').value, '2026-03-05T10:00:00.000Z')
    assert.equal(coerceBound('2026-03-05 10:00', { tzOffsetMinutes: -480 }).value, '2026-03-05T02:00:00.000Z')
  })

  it('renders local stamps for the caller timezone', () => {
    assert.equal(localStamp('2026-03-05T00:30:00Z', -480), '03-05 08:30')
    assert.equal(localClock('2026-03-05T00:30:00Z', -480), '08:30')
    assert.equal(localStamp('nonsense', -480), '')
    assert.equal(localClock(null, -480), '')
  })

  it('nowIso drops the millisecond noise', () => {
    assert.match(nowIso(new Date(utcNoon)), /^2026-03-05T12:00:00Z$/)
  })

  it('host offset is a sane minutes value', () => {
    const offset = hostTzOffsetMinutes()
    assert.ok(Number.isFinite(offset))
    assert.ok(offset >= -840 && offset <= 840)
  })
})
