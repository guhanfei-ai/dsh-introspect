import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_FILES = [
  'src/client/runtime/open.js',
  'src/client/core/data.js',
  'src/client/core/chart.js',
  'src/client/ui/styles.js',
  'src/client/ui/panel.js',
  'src/client/ui/slot.js',
  'src/client/runtime/store.js',
  'src/client/runtime/apply.js',
  'src/client/runtime/close.js',
]

const PHYSICAL_SPLITS = new Set(['src/client/runtime/close.js'])

const fragments = []
for (const relative of SOURCE_FILES) {
  const source = await readFile(resolve(ROOT, relative), 'utf8')
  fragments.push(source.replace(/^\/\/ Generated source fragment\.[^\n]*\n/, '').replace(/[\t ]*\n+$/, ''))
}

const output = `${fragments.map((fragment, index) => {
  if (index === 0) return fragment
  const separator = PHYSICAL_SPLITS.has(SOURCE_FILES[index]) ? '\n' : '\n\n'
  return `${separator}${fragment}`
}).join('').replace(/\s+$/, '')}\n`
if (!output.includes('window.__ModuleLoader__.load({')) {
  throw new Error('client bundle is missing the ModuleLoader entry.')
}
if (!output.includes('exports.apply = apply')) {
  throw new Error('client bundle is missing the plugin apply export.')
}

await writeFile(resolve(ROOT, 'client.js'), output, 'utf8')
console.log(`built client.js from ${SOURCE_FILES.length} source fragments`)
