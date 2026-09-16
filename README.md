# dsh-introspect

Local-first self-observability for DeepSeek Harness.

Observe your events, energy, time, value, direction and reality feedback — locally.

> Observe the world. Introspect the self.

---

## What it does

Records real events into a local SQLite database and projects them onto five observation axes:

| Axis | Question | Range |
|------|----------|-------|
| **MEL** | How much usable mental energy is available? | 0–200 |
| **RRI** | Did the real world observably move? | 0–100 |
| **ROI** | What did this return to me relative to what it cost? | unbounded |
| **ARCTIC** | Did this move me toward where I want to go? | -10..+10 |
| **TSA** | How much finite time did this consume? | minutes, nullable |

The right-side Introspect panel shows all five, a **MEL × RRI** time series, and recent events.

**Why MEL × RRI?** High internal energy does not necessarily imply high external progress. dsh-introspect deliberately keeps mental energy and reality feedback as separate dimensions so you can see when they diverge.

---

## Install

```bash
dsh plugin --profile web add link:/path/to/dsh-introspect
```

Or from a published tag:

```bash
dsh plugin --profile <profile> add <pkg>#v<version>
```

---

## Tools

| Tool | Description |
|------|-------------|
| `introspect_record` | Store one event (only when the user explicitly asks to record). |
| `introspect_status` | Today's compact state block. |
| `introspect_today` | Today's aggregation and timeline. |
| `introspect_history` | Bounded multi-day query with filters and sorting. |
| `introspect_get` | One event with its verbatim raw text. |
| `introspect_update` | Correct a score when the user says it is wrong. |
| `introspect_delete` | Remove one event (requires explicit user confirmation). |

---

## How it works

```
You describe what happened
    ↓
DeepSeek Harness model understands the event
    ↓
introspect_record stores it in local SQLite
    ↓
Introspect panel refreshes automatically
```

- The plugin itself never calls any LLM.
- Events are recorded only when you explicitly ask ("记录一下", "记一笔", "/self ...").
- All data stays in `$DSH_HOME/introspect/events.sqlite3` on your machine.

---

## Right-side panel

The Introspect panel (toggle with the "内观" button) shows:

1. **Five metrics** — latest MEL, RRI, ROI, ARCTIC, TSA with trend arrows and averages.
2. **MEL × RRI chart** — dual-line time series with the energy-reality gap shaded between them.
3. **Recent events** — click to expand full details (raw text, all metrics with reasons, tags).
4. **Live refresh** — the panel updates automatically after each recorded event.

Supports dark mode and light mode (follows the DeepSeek Harness theme).

---

## Data

| Item | Location |
|------|----------|
| Database | `$DSH_HOME/introspect/events.sqlite3` |
| Schema | `PRAGMA user_version`, single `events` table |
| Backup | Copy the `.sqlite3` file; it's a standard SQLite database |

Override with `dbPath` in the plugin config (`cordis.patch.yml`).

---

## Privacy

- **No cloud account.** No registration, no login, no remote identity.
- **No upload.** The plugin does not send its database or any event data to any external service.
- **No external AI calls.** The plugin calls no LLM API directly.
- **No telemetry.** No analytics, no usage tracking.
- **No auto-capture.** Only explicitly requested events are stored.

If the DeepSeek Harness session uses a remote AI provider, the conversation content (including event descriptions) may transit that provider's infrastructure. The plugin controls only its own local storage.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the full statement.

---

## Development

```bash
npm install
npm run build:client   # build client.js from src/client/ fragments
npm test               # run all tests
npm run verify         # build + syntax check + test
```

Tests cover: SQLite initialization, migration, CRUD, unicode, null metrics, timezone boundaries, tool validation, approval hooks, API trust fence, client pure functions, chart geometry, and secret/hygiene scans.

---

## Metrics documentation

See [docs/METRICS.md](docs/METRICS.md) for the full definition of each axis, their ranges, bands, aggregation rules, and limitations.

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## License

MIT