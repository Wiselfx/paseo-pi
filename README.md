# @wiselfx/paseo-pi

Paseo plugin for the [pi coding agent](https://github.com/badlogic/pi-mono). Paseo already ships a
built-in `pi` provider; this plugin adds the management surface around it:

- **Extensions & skills** — install, update, and remove pi packages (a pasted
  `pi install npm:…` command is accepted); add or remove extension paths; enable or disable
  built-in extensions; install skills from a GitHub link or write one by hand.
- **Providers & models** — add, edit, and remove providers and models in `models.json`, including
  write-only API keys. Fetched models come from the provider itself: ask for its list, then pick
  what to add. The raw JSON editor keeps advanced fields; secret-looking values show as
  `__PI_SECRET__` and are restored when saved.
- **Prompt** — edit `APPEND_SYSTEM.md`, or replace the system prompt with `SYSTEM.md`.
- **Sessions** — list pi session files by working directory or query, refresh, and delete.
  Deleting one also deletes the matching Paseo agent through the Paseo CLI, then removes the
  JSONL file.
- **Reload** — `/reload` in a pi-plugin chat, or the **Reload** composer pill, reloads pi's
  settings, models, extensions, skills, prompts and context files in place.
- **Settings** — edit common settings or the full `settings.json`.

The plugin registers a provider (`pi-plugin`, label **Pi Plugin**) with Paseo. It starts one
`pi --mode rpc` child per Paseo session and speaks pi's RPC protocol.

The provider advertises **no models by default**: Paseo's built-in `pi` provider already lists
pi's catalog, and a second copy only clutters the model picker. Agents start on pi's configured
default model, and Paseo's own "add model" flow still works. Turn on **Expose models** in the Pi
launch settings if you want a separate model list for this provider.

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
inherited environment, session directory, context files and MCP switches, **Expose models**, and
the `/reload` command switch. Extensions and skills are switched on or off one at a time in
**Extensions & skills**; that is stored as pi's own `-path` markers in `settings.json`. These are host-scoped; a per-agent `providerOptions` override can replace them for one agent.

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
