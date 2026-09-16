# dsh-introspect

DeepSeek Harness 中的本地个人可观测系统。

在本地观察你的事件、能量、时间、价值、方向与现实反馈。

> 观察世界，内观自己。

---

## 它做什么

把真实事件记录到本地 SQLite 数据库，并投影到五个观察维度：

| 维度 | 回答的问题 | 量纲 |
|------|----------|------|
| **MEL** | 现在还有多少可用心智能量？ | 0–200 |
| **RRI** | 现实世界真的动了吗？ | 0–100 |
| **ROI** | 这次交换对我而言回报如何？ | 无界 |
| **ARCTIC** | 这让我离想去的地方更近还是更远？ | -10..+10 |
| **TSA** | 这消耗了多少有限时间？ | 分钟，可空 |

右侧「内观」面板同时显示全部五个指标、一条 **MEL × RRI** 时间曲线和最近事件。

**为什么要同时看 MEL 和 RRI？** 内在能量高，并不自动意味着现实推进程度高。dsh-introspect 将心智能量与现实反馈作为两个独立维度观察，让两条线的差距自己说话。

---

## 安装

```bash
dsh plugin --profile web add link:/path/to/dsh-introspect
```

或发布 tag：

```bash
dsh plugin --profile <profile> add <pkg>#v<version>
```

---

## 工具

| 工具 | 说明 |
|------|------|
| `introspect_record` | 记录一条事件（仅在用户明确要求时调用）。 |
| `introspect_status` | 今日紧凑状态块。 |
| `introspect_today` | 今日聚合与时间线。 |
| `introspect_history` | 有界多日查询，支持过滤和排序。 |
| `introspect_get` | 按 id 读取完整事件（含原始文本）。 |
| `introspect_update` | 用户纠正评分时修改事件。 |
| `introspect_delete` | 删除一条事件（需用户明确确认）。 |

---

## 工作原理

```
你描述刚刚发生了什么
    ↓
DeepSeek Harness 模型理解事件
    ↓
introspect_record 存入本地 SQLite
    ↓
内观面板自动刷新
```

- 插件本身绝不调用任何 LLM。
- 只有你明确要求记录时才会写入（"记录一下"、"记一笔"、"/self ..."）。
- 所有数据保存在本机 `$DSH_HOME/introspect/events.sqlite3`。

---

## 右侧面板

点击「内观」按钮展开面板，内容包括：

1. **五个指标** — MEL、RRI、ROI、ARCTIC、TSA 的最新值、趋势箭头与平均值。
2. **MEL × RRI 曲线** — 双线时间序列，两条线之间的区域就是能量—现实反馈差。
3. **最近事件** — 点击展开完整详情（原始文本、全部指标及理由、标签）。
4. **实时刷新** — 每次记录新事件后面板自动更新。

支持深色模式和浅色模式（跟随 DeepSeek Harness 主题）。

---

## 数据

| 项目 | 位置 |
|------|------|
| 数据库 | `$DSH_HOME/introspect/events.sqlite3` |
| Schema | `PRAGMA user_version`，单一 `events` 表 |
| 备份 | 复制 `.sqlite3` 文件即可；它是标准 SQLite 数据库 |

可通过 `cordis.patch.yml` 中的 `dbPath` 覆盖路径。

---

## 隐私

- **不需要云账号。** 无注册、无登录、无远程身份。
- **不上传。** 插件不向任何外部服务发送数据库或事件数据。
- **不调用外部 AI。** 插件自身不调用任何 LLM API。
- **不发送遥测。** 无分析、无使用追踪。
- **不自动记录。** 只有明确请求的事件才会被存储。

如果 DeepSeek Harness 会话使用远程 AI 供应商，对话内容（包括事件描述）可能会经过该供应商的基础设施。插件只控制自己的本地存储。

完整说明见 [docs/PRIVACY.md](docs/PRIVACY.md)。

---

## 开发

```bash
npm install
npm run build:client   # 从 src/client/ 片段构建 client.js
npm test               # 运行全部测试
npm run verify         # 构建 + 语法检查 + 测试
```

测试覆盖：SQLite 初始化、迁移、CRUD、Unicode、空指标、时区边界、工具校验、审批钩子、API 信任栅栏、客户端纯函数、图表几何、秘密扫描。

---

## 指标文档

见 [docs/METRICS.md](docs/METRICS.md)，包含各维度的完整定义、量纲、聚合规则与局限性。

---

## 架构

见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 许可证

MIT