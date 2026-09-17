// 客户端纯函数：ModuleLoader 入口、会话数据检测、图表几何、展示格式化。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function loadClient() {
  let definition
  const window = {
    __ModuleLoader__: {
      load(value) { definition = value },
    },
  }
  const context = vm.createContext({ URL, window, document: undefined, localStorage: undefined, fetch: undefined })
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context)
  assert.equal(definition.id, 'dsh-introspect')
  const runtime = definition.factory((id) => {
    if (id === 'react/jsx-runtime') return {
      jsx(type, props, key) { return { type, props: props || {}, key } },
      jsxs(type, props, key) { return { type, props: props || {}, key } },
      Fragment: {},
    }
    if (id === 'react') return { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, useCallback }
    throw new Error(`Unexpected browser dependency: ${id}`)
  })
  return { runtime, definition, context }
}

const capturedRefs = []
function useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] }
function useEffect() {}
function useLayoutEffect() {}
function useMemo(factory) { return factory() }
function useRef(value) { const ref = { current: value }; capturedRefs.push(ref); return ref }
function useSyncExternalStore(subscribe, getSnapshot) { if (typeof subscribe === 'function') subscribe(() => {}); return typeof getSnapshot === 'function' ? getSnapshot() : undefined }
function useCallback(fn) { return fn }

const { runtime } = loadClient()
const {
  conversationNodesOf,
  introspectFingerprint,
  latestRecordedId,
  normalizeTo100,
  formatMinutes,
  signed,
  trimForList,
  resultTextOfBlocks,
  buildChartPaths,
  generateWindowTicks,
  scaleTimeX,
  localClock,
  localTimeFull,
  CHART_HOURS_OPTIONS,
  DEFAULT_CHART_HOURS,
  formatHoursLabel,
  makeTimeWindow,
  INTROSPECT_TOOLS,
} = runtime.internals

test('ModuleLoader entry loads with the expected id', () => assert.equal(loadClient().definition.id, 'dsh-introspect'))

test('apply and internals are exported', () => {
  assert.equal(typeof loadClient().runtime.apply, 'function')
  assert.ok(loadClient().runtime.internals)
})

test('recognises every tool name used by the host', () => {
  for (const name of ['introspect_record', 'introspect_status', 'introspect_today', 'introspect_history', 'introspect_get', 'introspect_update', 'introspect_delete']) {
    assert.ok(INTROSPECT_TOOLS.has(name), name)
  }
})

test('conversationNodesOf tolerates legacy and modern snapshot shapes', () => {
  assert.equal(conversationNodesOf(null).length, 0)
  assert.equal(conversationNodesOf({}).length, 0)
  assert.deepEqual(conversationNodesOf({ nodes: [1] }), [1])
  assert.deepEqual(conversationNodesOf({ legacy: { nodes: [2] } }), [2])
  assert.deepEqual(conversationNodesOf({ nodes: [0], legacy: { nodes: [3] } }), [3])
})

test('introspectFingerprint changes only when an introspect result arrives', () => {
  const makeNode = (name, callId) => ({ kind: 'tool-result', call: { name }, callId, content: [{ type: 'text', text: '{}' }] })
  const empty = introspectFingerprint([])
  const noMatch = introspectFingerprint([makeNode('other_tool', 'a')])
  assert.notEqual(noMatch, empty, '长度变化仍会改变指纹')
  const one = introspectFingerprint([makeNode('introspect_record', 'b')])
  assert.notEqual(one, empty)
  assert.notEqual(one, noMatch, 'introspect 结果与非 introspect 结果的指纹不同')
  assert.notEqual(one, noMatch)
  const same = introspectFingerprint([makeNode('introspect_record', 'b')])
  assert.equal(same, one, '相同 callId 指纹稳定')
  const sub = introspectFingerprint([{ kind: 'code', subCalls: [makeNode('introspect_record', 'c')] }])
  assert.notEqual(sub, empty)
  const deeper = introspectFingerprint([{ kind: 'code', subCalls: [{ kind: 'code', subCalls: [makeNode('introspect_record', 'd')] }] }])
  assert.notEqual(deeper, empty)
})

test('latestRecordedId walks subCalls and returns the newest id', () => {
  assert.equal(latestRecordedId(null), null)
  assert.equal(latestRecordedId([{ kind: 'other' }]), null)
  assert.equal(latestRecordedId([{ kind: 'tool-result', call: { name: 'introspect_record' }, callId: '1', content: [{ type: 'text', text: '{"ok":true,"event":{"id":7}}' }] }]), 7)
  const nested = [{ kind: 'code', subCalls: [{ kind: 'tool-result', call: { name: 'introspect_record' }, callId: 'x2', content: [{ type: 'text', text: '{"ok":true,"event":{"id":42}}' }] }] }]
  assert.equal(latestRecordedId(nested), 42)
  assert.equal(latestRecordedId([{ kind: 'tool-result', call: { name: 'introspect_record' }, callId: 'y', isError: true, content: [{ type: 'text', text: '{"ok":true,"event":{"id":99}}' }] }]), null, '错误结果不误认')
})

test('formatMinutes and signed produce compact, readable output', () => {
  assert.equal(formatMinutes(42), '42m')
  assert.equal(formatMinutes(120), '2h')
  assert.equal(formatMinutes(222), '3h42m')
  assert.equal(formatMinutes(0), null)
  assert.equal(formatMinutes(null), null)
  assert.equal(signed(6), '+6')
  assert.equal(signed(-3), '-3')
  assert.equal(signed(12.34, 1), '+12.3')
  assert.equal(signed(null), null)
})

test('normalizeTo100 maps onto a 0-100 axis for the chart', () => {
  assert.equal(normalizeTo100(200, 200), 100)
  assert.equal(normalizeTo100(100, 200), 50)
  assert.equal(normalizeTo100(87, 100), 87)
  assert.equal(normalizeTo100(300, 200), 100)
  assert.equal(normalizeTo100(null, 200), null)
  assert.equal(normalizeTo100(50, null), null, 'null max 应返回 null 而非默认 100')
})

test('trimForList is boundary-safe and code-point-aware', () => {
  assert.equal(trimForList('abcdef', 10), 'abcdef')
  assert.equal(trimForList('中文abcdef', 5), '中文ab…')
  assert.equal(trimForList(null, 3), '')
  assert.equal(trimForList('短', 5), '短')
})

test('localClock returns HH:mm in the browser timezone', () => {
  assert.match(localClock('2026-03-05T10:30:00Z'), /^\d{2}:\d{2}$/)
  assert.equal(localClock('not-a-date'), '')
  assert.equal(localClock(null), '')
})

test('buildChartPaths generates time-based plottable lines with ticks and endpoints', () => {
  const startMs = Date.parse('2026-05-01T00:00:00Z')
  const endMs = Date.parse('2026-05-01T04:00:00Z')
  const tw = { startMs, endMs, hours: 4 }
  const series = [
    { time: '2026-05-01T01:00:00Z', mel: 96, rri: 12, summary: 'A' },
    { time: '2026-05-01T02:00:00Z', mel: 60, rri: 90, summary: 'B' },
    { time: '2026-05-01T03:00:00Z', mel: 92, rri: null, summary: 'C' },
  ]
  const chart = buildChartPaths(series, 300, 160, tw)
  assert.equal(chart.empty, false)
  assert.match(chart.mel.path, /^M/)
  assert.match(chart.rri.path, /^M/)
  assert.ok(chart.xTicks.length >= 2, 'should have time axis ticks from window')
  assert.ok(chart.yGrid.length >= 2, 'should have Y axis grid')
  assert.ok(chart.current.length >= 1)
  assert.ok(chart.hoverData.length === 3, 'hover data for each point')
  assert.match(chart.viewBox, /0 0 300 160/)
  // Empty window still has ticks
  const empty = buildChartPaths([], 300, 160, tw)
  assert.equal(empty.empty, true)
  assert.ok(empty.xTicks.length >= 4, 'empty window still has full time axis')
  const dimmed = buildChartPaths(series, 0, 0, tw)
  assert.equal(dimmed.empty, false)
  assert.ok(dimmed.width > 0 && dimmed.height > 0)
})

test('buildChartPaths treats nulls as gaps, not as zeros', () => {
  const tw = { startMs: Date.parse('2026-05-01T00:00:00Z'), endMs: Date.parse('2026-05-01T04:00:00Z'), hours: 4 }
  const series = [
    { time: '2026-05-01T01:00:00Z', mel: 90, rri: 80 },
    { time: '2026-05-01T02:00:00Z', mel: null, rri: 70 },
    { time: '2026-05-01T03:00:00Z', mel: 85, rri: 75 },
  ]
  const chart = buildChartPaths(series, 200, 80, tw)
  assert.equal(chart.gap, null, '中间有 null 的段不应生成填色区域')
  assert.ok(chart.mel.path.includes('M'))
  assert.ok(chart.rri.path.includes('L'))
})

test('resultTextOfBlocks joins only text blocks', () => {
  assert.equal(resultTextOfBlocks([{ type: 'text', text: '{"ok":true}' }, { type: 'image', data: 'x' }]), '{"ok":true}')
  assert.equal(resultTextOfBlocks(null), '')
})

test('the exported apply accepts exactly the expected inject set', () => {
  assert.equal(JSON.stringify(loadClient().runtime.inject), JSON.stringify(['slots']))
})

// ── Time-axis correctness tests ──

test('scaleTimeX positions points by real timestamp, not index', () => {
  const area = { left: 32, top: 12, w: 256, h: 122 }
  const startMs = Date.parse('2026-05-01T00:00:00Z')
  const endMs = Date.parse('2026-05-01T01:00:00Z') // 1 hour
  // Point at 00:05 (8.3% of window)
  const x5 = scaleTimeX(Date.parse('2026-05-01T00:05:00Z'), startMs, endMs, area)
  // Point at 00:55 (91.7% of window)
  const x55 = scaleTimeX(Date.parse('2026-05-01T00:55:00Z'), startMs, endMs, area)
  assert.ok(x5 < area.left + area.w * 0.15, '00:05 should be near left edge (~8%)')
  assert.ok(x55 > area.left + area.w * 0.85, '00:55 should be near right edge (~92%)')
  assert.ok(x55 - x5 > area.w * 0.7, '00:05 and 00:55 should be far apart')
})

test('scaleTimeX single point at 75% of window is at 75%, not 50%', () => {
  const area = { left: 0, top: 0, w: 300, h: 100 }
  const startMs = 0
  const endMs = 3600000 // 1 hour
  const eventMs = 2700000 // 45 min = 75%
  const x = scaleTimeX(eventMs, startMs, endMs, area)
  assert.ok(Math.abs(x - 225) < 1, '75% of 300 = 225, got ' + x)
})

test('scaleTimeX handles unequal time intervals correctly', () => {
  const area = { left: 0, top: 0, w: 300, h: 100 }
  const startMs = 0
  const endMs = 3600000 // 1 hour
  // 00:00, 00:01, 00:59
  const x0 = scaleTimeX(0, startMs, endMs, area)
  const x1 = scaleTimeX(60000, startMs, endMs, area)
  const x59 = scaleTimeX(3540000, startMs, endMs, area)
  // 1 min vs 58 min gap
  assert.ok(Math.abs(x1 - x0) <= 5, '00:00 and 00:01 should be very close')
  assert.ok(x59 - x1 > 280, '00:01 and 00:59 should be far apart')
})

test('buildChartPaths with time window positions points by timestamp', () => {
  const startMs = Date.parse('2026-05-01T00:00:00Z')
  const endMs = Date.parse('2026-05-01T01:00:00Z')
  const tw = { startMs, endMs, hours: 1 }
  const series = [
    { time: '2026-05-01T00:05:00Z', mel: 80, rri: 40 },  // ~8%
    { time: '2026-05-01T00:55:00Z', mel: 100, rri: 60 },  // ~92%
  ]
  const chart = buildChartPaths(series, 300, 160, tw)
  const hoverData = chart.hoverData
  assert.equal(hoverData.length, 2)
  // First point should be far left, second far right
  assert.ok(hoverData[0].x < chart.width * 0.2, 'point at 00:05 should be in left 20%')
  assert.ok(hoverData[1].x > chart.width * 0.8, 'point at 00:55 should be in right 80%')
})

test('generateWindowTicks produces ticks from window, not data', () => {
  // 1H window: should have ticks at 15-min intervals
  const now = Date.now()
  const start1h = now - 3600000
  const ticks1h = generateWindowTicks({ startMs: start1h, endMs: now, hours: 1 })
  assert.ok(ticks1h.length >= 3, '1H should have at least 3 ticks')
  // All ticks should be HH:mm format
  for (const t of ticks1h) assert.match(t.label, /^\d{2}:\d{2}$/, 'tick label is HH:mm')

  // 6H window: should have ticks at 1-hour intervals
  const start6h = now - 6 * 3600000
  const ticks6h = generateWindowTicks({ startMs: start6h, endMs: now, hours: 6 })
  assert.ok(ticks6h.length >= 5, '6H should have at least 5 ticks')
  // Ticks should be ordered by time
  for (let i = 1; i < ticks6h.length; i++) {
    assert.ok(ticks6h[i].ms > ticks6h[i - 1].ms, 'ticks are ordered')
  }
})

test('generateWindowTicks works for empty window (no data needed)', () => {
  const startMs = Date.parse('2026-05-01T10:00:00Z')
  const endMs = Date.parse('2026-05-01T16:00:00Z')
  const ticks = generateWindowTicks({ startMs, endMs, hours: 6 })
  assert.ok(ticks.length >= 4, 'empty 6H window still has ticks')
  // First tick should be at or near start
  assert.ok(ticks[0].ms >= startMs - 3600000, 'first tick near window start')
  // Last tick should be at or near end
  assert.ok(ticks[ticks.length - 1].ms <= endMs + 3600000, 'last tick near window end')
})

test('generateWindowTicks handles 48H and 72H with date labels', () => {
  const startMs = Date.parse('2026-09-16T00:00:00Z')
  const endMs = Date.parse('2026-09-18T00:00:00Z') // 48H
  const ticks = generateWindowTicks({ startMs, endMs, hours: 48 })
  assert.ok(ticks.length >= 4, '48H should have multiple ticks')
  // Should include date info for cross-day
  const hasDate = ticks.some(t => t.label.includes('-'))
  assert.ok(hasDate, '48H ticks should include date info')
})

test('CHART_HOURS_OPTIONS has exactly seven fixed ranges', () => {
  assert.equal(CHART_HOURS_OPTIONS.length, 7)
  assert.deepEqual([...CHART_HOURS_OPTIONS], [1, 3, 6, 12, 24, 48, 72])
  assert.equal(DEFAULT_CHART_HOURS, 1)
})

test('formatHoursLabel formats the seven ranges', () => {
  assert.equal(formatHoursLabel(1), '1H')
  assert.equal(formatHoursLabel(3), '3H')
  assert.equal(formatHoursLabel(6), '6H')
  assert.equal(formatHoursLabel(12), '12H')
  assert.equal(formatHoursLabel(24), '24H')
  assert.equal(formatHoursLabel(48), '48H')
  assert.equal(formatHoursLabel(72), '72H')
})

test('makeTimeWindow builds correct start/end from hours and generatedAt', () => {
  const tw = makeTimeWindow(6, '2026-09-17T15:40:00Z')
  assert.equal(tw.hours, 6)
  assert.equal(tw.endMs, Date.parse('2026-09-17T15:40:00Z'))
  assert.equal(tw.startMs, Date.parse('2026-09-17T09:40:00Z'))
  assert.equal(tw.endMs - tw.startMs, 6 * 3600000)
})

test('localTimeFull includes date for cross-day tooltips', () => {
  const full = localTimeFull('2026-09-17T15:03:00Z')
  assert.match(full, /\d{2}-\d{2} \d{2}:\d{2}/)
})
