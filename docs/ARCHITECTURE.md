# Architecture

```
Human
  │
  ▼
DeepSeek Harness (DSH)
  │  The model understands the event, assigns metrics
  ▼
introspect_record / introspect_update / introspect_delete
  │  Validation, persistence
  ▼
SQLite3 (local file)
  │
  ├──▶  DSH tools (introspect_status / introspect_history / ...)
  │     Reason about stored data, answer questions
  │
  └──▶  Right-side Introspect panel (read-only)
        Observe the MEL × RRI chart, recent events, metrics
```

**Intelligence lives in the DSH model.** The plugin provides storage, validation, aggregation and visualization. It never calls another LLM, never runs its own inference, and never auto-captures conversation.

---

## Host half (`index.js` + `src/`)

| Layer | File | Role |
|-------|------|------|
| Plugin entry | `index.js` | Config schema, `apply()`, GUIDANCE, tool registration, route registration, approval hook |
| Metrics | `src/metrics.js` | Range definitions, validation, format helpers (single source of truth for all five axes) |
| Time | `src/time.js` | UTC storage, local-day boundary computation, timezone-aware formatting |
| Schema | `src/db/schema.js` | DDL, migrations via `PRAGMA user_version`, idempotent upgrade |
| Database | `src/db/database.js` | `openDatabase()`, WAL, busy_timeout, path resolution, singleton handle |
| Store | `src/db/store.js` | CRUD, queries, tag filtering (json_each), quadrant counts |
| View | `src/db/view.js` | Projections: today aggregation, series, dashboard payload, status text |
| Tools | `src/tools.js` | Seven `introspect_*` tools with JSON Schema + rubric descriptions in English |
| API | `src/api.js` | Read-only HTTP route at `/introspect/api/*`, trust fence, bounded responses |

---

## Client half (`src/client/` → `client.js`)

| Layer | File | Role |
|-------|------|------|
| ModuleLoader | `runtime/open.js` | DSH browser module entry, tool name constants |
| Data | `core/data.js` | Session snapshot handling, fingerprinting, pure display helpers |
| Chart | `core/chart.js` | MEL × RRI SVG geometry, polyline paths, gap fill, tick layout |
| Styles | `ui/styles.js` | All inline styles, following `--dsh-alias-*` CSS variables (dark/light auto) |
| Panel | `ui/panel.js` | `IntrospectWorkspace`: metrics grid, chart, recent list, detail view, empty state |
| Slot | `ui/slot.js` | `IntrospectSlot`: header button, standalone panel, Better Sidebar tab bridge |
| Store | `runtime/store.js` | `sidebarBus` + `sessionStore` (sidebar mode data bridge, per-session isolation) |
| Apply | `runtime/apply.js` | Wiring: layout-push CSS, Better Sidebar registration, face API, slot registration |
| Close | `runtime/close.js` | ModuleLoader factory closure |

---

## Data flow

1. **Record:** User says "记录一下…" → DSH model understands, calls `introspect_record` → host validates + inserts into SQLite → tool result JSON returned → client detects fingerprint change → fetches dashboard from read-only route → panel refreshes.

2. **Observe:** Client panel loads → `POST /introspect/api/dashboard` → host computes aggregates (today, series, recent, tags, quadrant) → JSON response → panel renders metrics + SVG chart + recent list.

3. **Query:** DSH model calls `introspect_history` / `introspect_today` / `introspect_status` → host queries SQLite → bounded result → model reads and answers the user's question.

4. **Correct:** User says "不对，RRI 应该是 20" → model calls `introspect_update` → host patches the row → result returned → panel refreshes.

5. **Delete:** User asks to remove an event → model calls `introspect_delete` with `confirm: true` → host pre-execute hook shows native approval prompt → if granted, row deleted.

---

## Key design decisions

| Decision | Why |
|----------|-----|
| One events table, not five | A real event + five projections. Not `mel_events`, `rri_events`, etc. |
| raw_text always preserved | Metrics can be re-derived; the raw account cannot be recovered if deleted |
| null = unknown, not zero | Unknown > fabricated precision |
| Tool result = refresh signal | Zero-channel data flow (same as dsh-mindmap): no polling, no custom event bus |
| Read-only HTTP route | Browser never writes to SQLite directly — all mutations go through DSH tools |
| node:sqlite (built-in) | Zero native dependencies, no better-sqlite3 compile step, Node ≥ 22.5 |
| No external LLM calls | DSH is already the intelligence; the plugin is memory + deterministic computation + visualization |
| No auto-capture | Explicit consent only — otherwise the plugin becomes an unwelcome surveillance tool |