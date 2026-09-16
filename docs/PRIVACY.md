# Privacy

## What this plugin does

dsh-introspect stores personal event telemetry in a local SQLite database on your machine. The database file is at:

```
$DSH_HOME/introspect/events.sqlite3
```

Where `$DSH_HOME` defaults to `~/.dsh` (the DeepSeek Harness home directory).

## What this plugin does NOT do

- **No cloud account.** The plugin has no login, no registration, no remote identity.
- **No upload.** The plugin itself does not upload the SQLite database or any stored events to any external service.
- **No built-in external AI calls.** The plugin does not call any LLM API directly. It stores what the DeepSeek Harness model passes to it.
- **No telemetry.** The plugin sends no analytics, no crash reports, no usage tracking to any endpoint.
- **No background capture.** Only explicitly requested events (via "记录一下" or similar) are recorded. Ordinary conversation is never stored.

## What is NOT guaranteed

If the DeepSeek Harness session is using a remote AI provider (e.g., DeepSeek API, OpenAI, etc.), your conversation with the model — including event descriptions you ask it to record — passes through that provider's infrastructure. The plugin controls only its own local storage, not the transport layer of the AI session itself.

**Correct statement:**

> dsh-introspect itself does not upload its local SQLite database or send telemetry to an external service. However, if the DeepSeek Harness session uses a remote AI provider, the conversation content (including event descriptions) may transit that provider's infrastructure.

## Data location

| Item | Path |
|------|------|
| Event database | `$DSH_HOME/introspect/events.sqlite3` |
| WAL journal | `$DSH_HOME/introspect/events.sqlite3-wal` (temporary, auto-cleaned) |
| Shared memory | `$DSH_HOME/introspect/events.sqlite3-shm` (temporary, auto-cleaned) |

Override the database path via the `dbPath` config field in `cordis.patch.yml`.

## Data ownership

The data is yours. `introspect_delete` exists because you should be able to remove events you no longer want. The plugin has no account system and no shared access — only the machine that runs DeepSeek Harness can read the database.