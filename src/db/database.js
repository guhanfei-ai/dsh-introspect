// SQLite 打开/关闭与路径解析。
//
// 本地优先：一个进程一份连接、一个文件。node:sqlite 是 Node 内建模块
// （engines >=22.5），因此本项目除 settings schema 外零运行时依赖，
// 没有原生编译、没有 ORM、没有服务端。
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { mkdirSync } from 'node:fs'

import { migrate, SCHEMA_VERSION } from './schema.js'

export const DB_FILE_NAME = 'events.sqlite3'
export const DB_SUBDIR = 'introspect'
export const BUSY_TIMEOUT_MS = 5_000

/**
 * 插件数据目录：$DSH_HOME/introspect，DSH_HOME 缺省 ~/.dsh
 * （dshHomePath 的同款约定，见 DSH bundle 的 storage-json 配置）。
 * DSH_HOME 用环境变量覆盖时这里自动跟随。
 */
export function defaultDataDir(env = process.env, home = homedir()) {
  const dshHome = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() ? env.DSH_HOME.trim() : join(home, '.dsh')
  return join(dshHome, DB_SUBDIR)
}

export function defaultDbPath(env = process.env, home = homedir()) {
  return join(defaultDataDir(env, home), DB_FILE_NAME)
}

/** 配置里的 dbPath：支持 ~/ 展开、相对路径按 dataDir 解析、留空走默认。 */
export function resolveDbPath(configured, env = process.env, home = homedir()) {
  if (typeof configured !== 'string' || !configured.trim()) return defaultDbPath(env, home)
  let value = configured.trim()
  if (value === '~' || value.startsWith('~/')) value = join(home, value.slice(2))
  return isAbsolute(value) ? resolvePath(value) : resolvePath(defaultDataDir(env, home), value)
}

/**
 * 打开数据库：建目录、开 WAL、设 busy_timeout、跑到最新 schema 版本。
 * 目录权限 0700——里面是个人事件数据。
 */
export function openDatabase(file) {
  if (typeof file !== 'string' || !file) throw new Error('introspect: database path is required')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA busy_timeout = ' + BUSY_TIMEOUT_MS)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    const result = migrate(db)
    return { db, file, schemaVersion: SCHEMA_VERSION, migrated: result.applied.length > 0 }
  } catch (error) {
    try {
      db.close()
    } catch {
      // 打开失败时 close 也可能抛，忽略次级错误。
    }
    throw error
  }
}

/**
 * 单例连接：同一路径复用同一连接，路径变化时换连接（配置可运行时改路径）。
 * 调用方负责在插件卸载时 close。
 */
export function createDatabaseHandle({ resolvePath: resolveFile }) {
  let current = null
  const ensure = () => {
    const file = resolveFile()
    if (current && current.file === file) return current.db
    if (current) close()
    const opened = openDatabase(file)
    current = opened
    return current.db
  }
  const close = () => {
    const handle = current
    current = null
    if (!handle) return
    try {
      handle.db.close()
    } catch {
      // 关闭失败不影响卸载流程。
    }
  }
  return {
    ensure,
    close,
    get info() {
      return current ? { file: current.file, schemaVersion: current.schemaVersion } : null
    },
  }
}
