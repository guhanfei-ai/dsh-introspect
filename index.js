// dsh-introspect —— host 半边：本地个人可观测系统。
//
// 分层：
//   src/metrics.js      五个观察维度的量纲、取值域、校验（唯一真源）
//   src/time.js         UTC 存储 / 调用方时区的「今天」
//   src/db/             SQLite：schema+迁移、读写、聚合视图
//   src/tools.js        七个 introspect_* 工具 + 系统提示词
//   src/api.js          面板用的只读 HTTP 路由（/introspect/api/*）
//   src/client/         浏览器半边（面板），由 scripts/build-client.mjs 合成 client.js
//
// 关键约束：
// - 插件自己绝不调用任何 LLM 或外部服务。理解自然语言、给 rubric 打分是
//   DSH 模型的事；这里只做存储、校验、聚合、查询、可视化。
// - 绝不后台记录聊天。只有用户明确说「记录一下」时，模型才会调 introspect_record。
// - 数据只落本地 SQLite（$DSH_HOME/introspect/events.sqlite3）。
import Schema from '@deepseek-ai/schemastery'

import { createDatabaseHandle, defaultDbPath, defaultDataDir, resolveDbPath } from './src/db/database.js'
import { buildDashboard, trimForList } from './src/db/view.js'
import { getEvent } from './src/db/store.js'
import { createApiHandler } from './src/api.js'
import { hostTzOffsetMinutes } from './src/time.js'
import { GUIDANCE, defineTools, deleteApprovalReason } from './src/tools.js'

export const name = 'introspect'
export const inject = ['tools', 'systemPrompt', 'webServer']

export const Config = Schema.object({
  dbPath: Schema.string().default('').description('SQLite file holding the recorded events. Empty uses $DSH_HOME/introspect/events.sqlite3 (~/.dsh/introspect/events.sqlite3 by default). A relative path is resolved inside that same plugin data directory.'),
  chartHours: Schema.number().default(24).description('Default window, in hours, for the MEL x RRI panel chart and the trailing count in introspect_status (1-168).'),
})

const GUIDANCE_ORDER = 107

/**
 * 惰性数据库代理：工具/路由按名字访问 SQLite，第一次真正用到时才打开文件。
 * 这样配置写错路径只会让工具报错，不会让插件加载失败。
 */
function lazyDatabase(handle) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      const real = handle.ensure()
      const value = real[property]
      return typeof value === 'function' ? value.bind(real) : value
    },
    has(_target, property) {
      return property in handle.ensure()
    },
  })
}

export function apply(ctx, config = {}) {
  const entryConfig = {
    dbPath: typeof config.dbPath === 'string' ? config.dbPath : '',
    chartHours: Number.isFinite(Number(config.chartHours)) ? Math.max(1, Math.min(168, Number(config.chartHours))) : 24,
  }

  const handle = createDatabaseHandle({ resolvePath: () => resolveDbPath(entryConfig.dbPath) })
  const db = lazyDatabase(handle)
  // 卸载时关连接（WAL 的 -wal/-shm 由 SQLite 在 close 时收尾）。
  ctx.effect(() => () => handle.close())

  ctx.systemPrompt.section({ name: 'tool:introspect', order: GUIDANCE_ORDER, text: GUIDANCE })

  for (const tool of defineTools(db, { chartHours: entryConfig.chartHours })) {
    ctx.tools.register(tool)
  }

  // 删除是唯一带原生审批的写操作：数据是用户自己的，但历史不该由 Agent 静默抹掉。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name !== 'introspect_delete') return decision
    return { kind: 'ask', reason: deleteApprovalReason(exec.arguments ?? {}) }
  })

  // 只读数据面：面板 fetch 聚合结果。没有写路由。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/introspect/api',
        handler: createApiHandler({
          db,
          defaults: { hours: entryConfig.chartHours },
          hostTzOffsetMinutes,
          buildDashboard,
          getEvent,
          trimForList,
        }),
      }),
    'dsh-introspect: /introspect/api routes',
  )
}

export const internals = Object.freeze({
  GUIDANCE,
  GUIDANCE_ORDER,
  defaultDbPath,
  defaultDataDir,
  resolveDbPath,
  lazyDatabase,
  deleteApprovalReason,
})
