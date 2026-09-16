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
  localClock,
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

test('buildChartPaths generates two plottable lines with ticks and a current-dot', () => {
  const series = [
    { time: '2026-05-01T01:00:00Z', mel: 96, rri: 12, summary: 'A' },
    { time: '2026-05-01T02:00:00Z', mel: 60, rri: 90, summary: 'B' },
    { time: '2026-05-01T03:00:00Z', mel: 92, rri: null, summary: 'C' },
  ]
  const chart = buildChartPaths(series, 300, 120)
  assert.equal(chart.empty, false)
  assert.match(chart.mel.path, /^M/)
  assert.match(chart.rri.path, /^M/)
  assert.ok(chart.ticks.length >= 2)
  assert.ok(chart.current.length >= 1)
  assert.equal(chart.legend.length, 2)
  assert.match(chart.viewBox, /0 0 300 120/)
  const empty = buildChartPaths([], 300, 120)
  assert.equal(empty.empty, true)
  const dimmed = buildChartPaths(series, 0, 0)
  assert.equal(dimmed.empty, false)
  assert.ok(dimmed.width > 0 && dimmed.height > 0)
})

test('buildChartPaths treats nulls as gaps, not as zeros', () => {
  const series = [
    { time: '2026-05-01T01:00:00Z', mel: 90, rri: 80 },
    { time: '2026-05-01T02:00:00Z', mel: null, rri: 70 },
    { time: '2026-05-01T03:00:00Z', mel: 85, rri: 75 },
  ]
  const chart = buildChartPaths(series, 200, 80)
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
