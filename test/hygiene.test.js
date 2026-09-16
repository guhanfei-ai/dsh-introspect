// 提交前卫生检查：绝不能把旧 tay2mel 的秘密或运行时文件带进仓库。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { execSync } from 'node:child_process'

const ROOT = join(import.meta.dirname, '..')

function repoFiles() {
  try {
    return execSync('git ls-files --cached --others --exclude-standard --full-name', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 20 })
      .split('\n')
      .filter((line) => line && !line.startsWith('.git/'))
      .map((line) => line.trim())
  } catch {
    return []
  }
}

function readText(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const SECRET_PATTERNS = [
  { name: 'hardcoded API key / token', pattern: /\b(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
  { name: 'plaintext password', pattern: /\b(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i },
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'MySQL connection string', pattern: /mysql:\/\/[^:]+:[^@]+@/i },
  { name: 'Tencent Cloud MySQL endpoint', pattern: /(?:cdb|tencentdb)\.mysql\.com|bj\.cdb\.qcloud\.com/i },
  { name: 'dotenv file import', pattern: /\brequire\(['"]dotenv['"]\)|from ['"]dotenv['"]|config\(\)\.parsed\b/ },
  { name: 'env_loader override', pattern: /env_loader|envOverride|loadEnv\b/ },
]

const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.ttc', '.pdf', '.zip', '.tar', '.gz', '.woff', '.db', '.sqlite3', '.sqlite', '.DS_Store'])
const SKIP_FILES = new Set(['LICENSE', 'node_modules/.package-lock.json'])
// 测试文件本身会包含安全相关的关键词（正则、断言）——漏扫误报来源。
const SCAN_ONLY = (rel) => rel === 'index.js' || rel.startsWith('src/')
const BINARY_CHECK = /[\x00-\x08\x0e-\x1f]{4,}/

test('no secret patterns leak into source code', () => {
  // 测试文件和文档可能合法包含安全相关的关键词（正则模式、断言、设计说明）；
  // 漏扫只针对 src/、index.js、scripts/、cordis.patch.yml 等实际发布件。
  const files = repoFiles().filter((rel) => (SCAN_ONLY(rel) || rel.startsWith('scripts/') || rel === 'cordis.patch.yml') && !SKIP_FILES.has(rel) && !SKIP_EXTENSIONS.has(rel.split('.').pop()))
  for (const rel of files) {
    let text
    try { text = readText(rel) } catch { continue }
    if (BINARY_CHECK.test(text.slice(0, 4096))) continue
    for (const { name, pattern } of SECRET_PATTERNS) {
      assert.ok(!pattern.test(text), `${rel} contains ${name}: ${pattern.exec(text)?.[0]?.slice(0, 60)}`)
    }
  }
})

test('.gitignore covers every runtime artifact', () => {
  const gitignore = readText('.gitignore')
  const required = ['*.sqlite3', '*.db', '.env', 'node_modules/', '*.sqlite3-shm', '*.sqlite3-wal', '.DS_Store']
  for (const pattern of required) {
    assert.ok(gitignore.includes(pattern), `.gitignore is missing: ${pattern}`)
  }
})

test('no .env or credentials file is tracked by git', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const rel of tracked) {
    const base = rel.split('/').pop()
    assert.ok(!/^\.env(\..*)?$/.test(base), `tracked file looks like a secret: ${rel}`)
    assert.ok(!/\bcredentials?\b/i.test(base), `tracked file looks like a credentials file: ${rel}`)
    assert.ok(!/\.(pem|key)$/.test(base), `tracked file looks like a private key: ${rel}`)
  }
})

test('no database file is tracked by git', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const rel of tracked) {
    assert.ok(!/\.(db|sqlite|sqlite3)$/.test(rel), `tracked file looks like a database: ${rel}`)
  }
})

test('source contains no reference to MySQL, InfluxDB, Grafana or the old tay2mel runtime', () => {
  const files = repoFiles().filter((rel) => rel.startsWith('src/') || rel === 'index.js')
  for (const rel of files) {
    let text
    try { text = readText(rel) } catch { continue }
    assert.ok(!/\bmysql\b/i.test(text), `${rel} references MySQL`)
    assert.ok(!/\binfluxdb\b/i.test(text), `${rel} references InfluxDB`)
    assert.ok(!/\bgrafana\b/i.test(text), `${rel} references Grafana`)
    assert.ok(!/\brequire\(['"]dotenv['"]\)/.test(text), `${rel} requires dotenv`)
    assert.ok(!/\benv_loader\b/.test(text), `${rel} references env_loader`)
  }
})

test('the plugin does not import any external LLM client', () => {
  const files = repoFiles().filter((rel) => (rel.startsWith('src/') || rel === 'index.js') && rel.endsWith('.js'))
  for (const rel of files) {
    let text
    try { text = readText(rel) } catch { continue }
    assert.ok(!/\bopenai\b/i.test(text), `${rel} imports OpenAI`)
    assert.ok(!/\blangchain\b/i.test(text), `${rel} imports LangChain`)
    assert.ok(!/\bfetch\(['"]https?:\/\//i.test(text), `${rel} makes an external HTTP request`)
  }
})
