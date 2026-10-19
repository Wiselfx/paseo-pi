# @wiselfx/paseo-pi

Paseo plugin for the [pi coding agent](https://github.com/badlogic/pi-mono). Paseo already ships a
built-in `pi` provider; this plugin adds the management surface around it:

- **Extensions & skills** — install, update, and remove pi packages; add or remove extension
  paths; enable or disable built-in extensions; create and delete skills.
- **Providers & models** — add, edit, and remove providers and models in `models.json`, including
  write-only API keys; edit the raw JSON for advanced fields. Secret-looking values in the raw
  editor are shown as `__PI_SECRET__` and restored when saved.
- **Prompt** — edit `APPEND_SYSTEM.md`, or replace the system prompt with `SYSTEM.md`.
- **Sessions** — list pi session files by working directory or query, refresh, and delete.
- **Settings** — edit common settings or the full `settings.json`.

The plugin registers a provider (`pi-plugin`, label **Pi Plugin**) with Paseo. It starts one
`pi --mode rpc` child per Paseo session and speaks pi's RPC protocol.

## Requirements

- Paseo 0.12 or newer.
- pi 1.1 or newer on `PATH`, or a command configured in the Pi launch settings.
- Node 22.18 or newer for the plugin host.

## Install

From a local checkout:

```bash
paseo plugin install /path/to/paseo-pi
paseo plugin reload paseo-pi
```

Then open **Pi** in the Paseo sidebar. Launch configuration is under **Configure Pi launch** in the
command palette.

## Configuration

Launch options live in the plugin's `pi-launch` settings screen: command, command-prefix args,
inherited environment, session directory, and `--no-*` resource toggles. These are host-scoped; a
per-agent `providerOptions` override can replace them for one agent.

pi's own files are managed directly:

| File | Purpose |
|---|---|
| `~/.pi/agent/settings.json` | packages, extensions, default model, tools |
| `~/.pi/agent/models.json` | compatible providers and models |
| `~/.pi/agent/SYSTEM.md`, `APPEND_SYSTEM.md` | system prompt |
| `~/.pi/agent/skills/`, `~/.agents/skills/` | skills |
| `~/.pi/agent/sessions/` | session JSONL files |

Set `PI_CODING_AGENT_DIR` to manage a different agent directory.

## Development

```bash
NODE_OPTIONS= npm run typecheck
NODE_OPTIONS= npm test
```

See [OVERVIEW.md](OVERVIEW.md) for the file map and [docs/omp-parity-map.md](docs/omp-parity-map.md)
for the comparison with `paseo-omp`.

## License

MIT
