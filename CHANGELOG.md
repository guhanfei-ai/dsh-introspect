# Changelog

## 0.1.0 (2026-09-17)

Initial release.

**Features:**
- Local SQLite event storage (`$DSH_HOME/introspect/events.sqlite3`) with WAL mode, busy_timeout, schema versioning.
- Seven `introspect_*` tools: `record`, `status`, `today`, `history`, `get`, `update`, `delete`.
- Five observation axes: MEL (0–200), RRI (0–100), ROI (unbounded), ARCTIC (-10..+10), TSA (minutes, nullable).
- Right-side Introspect panel in DeepSeek Harness: five metric cards, MEL × RRI dual-line SVG chart with gap fill, recent events list with detail view.
- Better Sidebar tab integration (optional, standalone fallback when dsh-better-sidebar is not installed).
- Live refresh: tool result fingerprint drives panel update — no polling, no custom event channel.
- Read-only dashboard API route at `/introspect/api/*` with origin fence.
- 126 tests covering DB layer, metrics/timezone, tools, API, client pure functions, and hygiene checks.
- No external LLM calls, no cloud account, no telemetry, no auto-capture.

**Known limitations:**
- MEL × RRI chart uses a fixed SVG viewport; responsive sizing to the panel width will come later.
- The "+ Record" button pre-fills the composer but does not yet submit automatically (requires the user to type the event description).
- No 7-day summary view, tag distribution chart, or MEL distribution histogram (P2 features from old Grafana dashboard).
- ARCTIC in this version is a per-event signed direction delta, replacing the old "remaining kilometres" chain model. This is a deliberate simplification documented in `docs/METRICS.md`.
- The plugin uses the host process timezone for server-side "today" computation; the client passes its own `tzOffsetMinutes` for the panel display.