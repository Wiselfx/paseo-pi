# @wiselfx/paseo-pi

Paseo plugin for the [pi coding agent](https://github.com/badlogic/pi-mono). Paseo already ships a
built-in `pi` provider; this plugin adds the management surface around it:

- **Extensions & skills** — install, update, and remove pi packages (a pasted
  `pi install npm:…` command is accepted); add or remove extension paths; enable or disable
  built-in extensions; install skills from a GitHub link, write one by hand, or edit any
  user/agents `SKILL.md` in place. Package skills stay read-only.
- **Providers & models** — add, edit, and remove providers and models in `models.json`, including
  write-only API keys. Fetched models come from the provider itself: ask for its list, then pick
  what to add. The raw JSON editor keeps advanced fields; secret-looking values show as
  `__PI_SECRET__` and are restored when saved.
- **Prompt** — edit `APPEND_SYSTEM.md`, or replace the system prompt with `SYSTEM.md`.
- **Profiles** — create named pi agent directories and expose each one in Paseo as a separate
  provider (`Pi · name`). A profile has its own settings, models, skills, extensions, prompts,
  and sessions. Removing a profile unregisters the provider and leaves its directory in place.
- **Project** — edit a project's `.pi/settings.json` and `.pi/APPEND_SYSTEM.md`. Pi applies them
  after the project is trusted.
- **Sessions** — list pi session files by working directory or query, refresh, and delete.
  Deleting one also deletes the matching Paseo agent through the Paseo CLI, then removes the
  JSONL file. Both built-in pi and legacy plugin agents are matched by their session file.
- **Reload** — `/reload` in a built-in `pi` chat, or the **Reload** composer pill, reloads pi's
  settings, models, extensions, skills, prompts and context files in place.
- **Settings** — edit common settings or the full `settings.json`.

The management panel follows Paseo's settings vocabulary: grouped cards with hairline dividers,
muted section labels, inline switches, and a compact single-column layout on phones.

The plugin does not register a provider. It installs a small generated extension at
`~/.pi/agent/extensions/paseo-pi-reload.ts` so Paseo's built-in `pi` sessions expose `/reload`.
The extension is listed under **Extensions & skills** as **paseo-pi reload**; switch it off there,
or turn off **Reload command** in the Pi launch settings. The plugin never overwrites a file it did
not generate.

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
inherited environment, session directory, context files, MCP, and the `/reload` command switch.
Extensions and skills are switched on or off one at a time in **Extensions & skills**; that is
stored as pi's own `-path` markers in `settings.json`. These are host-scoped; a per-agent launch
can override the command for one agent.

Profiles are host-scoped too. Creating one prepares its agent directory, adds a Paseo provider
override that runs the built-in `pi` provider with `PI_CODING_AGENT_DIR` set to that directory,
and makes it the directory this management panel edits. Pick `Pi · name` when creating the
session. The **Manage** button switches the panel back to the default directory or to another
profile. The **Project** tab writes only inside the chosen project's `.pi` directory.

pi's own files are managed directly:

| File | Purpose |
|---|---|
| `~/.pi/agent/settings.json` | packages, extensions, default model, tools |
| `~/.pi/agent/models.json` | compatible providers and models |
| `~/.pi/agent/SYSTEM.md`, `APPEND_SYSTEM.md` | system prompt |
| `~/.pi/agent/skills/`, `~/.agents/skills/` | skills |
| `~/.pi/agent/sessions/` | session JSONL files |
| `~/.pi/agent/extensions/paseo-pi-reload.ts` | generated `/reload` extension |
| `~/.pi/agent/trust.json` | trusted project paths |
| `<project>/.pi/settings.json` | project overrides |
| `<project>/.pi/APPEND_SYSTEM.md` | project prompt appendix |

Set `PI_CODING_AGENT_DIR` to manage a different agent directory, or use **Profiles** to create a
named one. Profile directories default to `~/.pi/profiles/<name>/agent`.

## Development

```bash
NODE_OPTIONS= npm run typecheck
NODE_OPTIONS= npm test
```

See [OVERVIEW.md](OVERVIEW.md) for the file map and [docs/omp-parity-map.md](docs/omp-parity-map.md)
for the comparison with `paseo-omp`.

## License

MIT
