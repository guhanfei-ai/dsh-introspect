// schema 与迁移。版本号用 SQLite 内建 PRAGMA user_version 承载——
// 不需要额外的 migration 表，也不需要迁移框架。
//
// 迁移只增不改：每个版本一段 SQL，按序在事务里执行，失败整体回滚。
// 已发布版本的 SQL 永不修改（历史库靠 user_version 判定已应用）。

export const SCHEMA_VERSION = 1

/** events 主表：一个现实事件 + 五个观察维度。全部指标可空。 */
const V1 = `
CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  event_time     TEXT    NOT NULL,
  raw_text       TEXT    NOT NULL,
  summary        TEXT    NOT NULL,
  mel            REAL,
  roi            REAL,
  arctic         REAL,
  tsa_minutes    REAL,
  rri            REAL,
  mel_reason     TEXT,
  roi_reason     TEXT,
  arctic_reason  TEXT,
  rri_reason     TEXT,
  tags_json      TEXT    NOT NULL DEFAULT '[]',
  metadata_json  TEXT    NOT NULL DEFAULT '{}',
  source         TEXT    NOT NULL DEFAULT 'dsh',
  session_id     TEXT
);
CREATE INDEX idx_events_created_at ON events (created_at);
CREATE INDEX idx_events_event_time ON events (event_time);
CREATE INDEX idx_events_session ON events (session_id);
`

export const MIGRATIONS = Object.freeze([{ version: 1, sql: V1 }])

export function currentVersion(db) {
  const row = db.prepare('PRAGMA user_version').get()
  const value = row ? Object.values(row)[0] : 0
  return Number(value) || 0
}

/**
 * 幂等迁移：从当前版本升到 SCHEMA_VERSION。
 * @returns {{ from: number, to: number, applied: number[] }}
 */
export function migrate(db) {
  const from = currentVersion(db)
  const applied = []
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      // PRAGMA 不接受参数绑定；version 来自本地常量表，不是外部输入。
      db.exec(`PRAGMA user_version = ${Number(migration.version)}`)
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 事务可能已因错误自动回滚。
      }
      throw new Error(`introspect schema migration ${migration.version} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    applied.push(migration.version)
  }
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `introspect database schema is newer (v${from}) than this plugin supports (v${SCHEMA_VERSION}); upgrade dsh-introspect instead of downgrading the database.`,
    )
  }
  return { from, to: Math.max(from, SCHEMA_VERSION), applied }
}
