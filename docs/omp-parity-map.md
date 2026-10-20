# omp parity map

Paseo 0.12 already ships a built-in `pi` provider. This plugin therefore does not replace that
provider, and its own provider does not repeat the built-in model catalog. It adds the management surface that `paseo-omp` gives omp. The two harnesses store
different files, so "pi equivalent" below means the same capability in pi's own model, not the
same implementation.

omp reference points read from `paseo-plugins/paseo-omp` @ `01ba420`:

- `index.client.tsx`: config screen `omp-config`, header rows `OMP` and `OMP Hub`, workspace
  panels `workspace` and `memory`, composer pills `mcp`, `hub`, `memory`, `sessions`, `quota`,
  timeline renderers `omp-images` and the MCP authorization card.
- `client/omp-config-surface.tsx` and `client/omp-config-views.ts`: tabs `overview`, `plugin`,
  `plugins`, `composer`, `configuration`, `diagnostics`, `help`; workspace scope hides
  `composer`.
- `client/omp-plugin-manager.tsx`: `paseo-omp.list-plugins`, `inspect-plugin-config`,
  `mutate-plugin` (`install`, `enable`, `disable`, `uninstall`, `upgrade`), and
  `mutate-plugin-config` (plugin settings, including write-only secrets).
- `client/sessions-popover.tsx` + `shared/sessions.ts`: `paseo-omp.list-sessions`, read-only,
  scoped to an agent cwd, from omp's `history.db`.
- `shared/omp-settings.ts`: `list-settings` / `update-settings`, catalog-driven native
  `~/.omp/agent/config.yml` and workspace `.omp/config.yml`, revision conflicts.
- `shared/omp-config.ts`: `list-config`, allowlisted provider/model sections.
- `shared/omp-models.ts`: `list-models`, read-only catalog used for model roles.
- `shared/provider-launch-settings.ts`: host-scope `provider-launch` with `inheritEnv` names.
- `shared/omp-store.ts`, `shared/hub.ts`, `shared/quota.ts`, `shared/mcp.ts`: multi-store
  profiles, Hub processes, quota snapshots, MCP authorization.

pi storage used by this plugin:

| Concern | pi file |
|---|---|
| Packages, extension paths, built-in toggles, preferences | `~/.pi/agent/settings.json` |
| Compatible providers, models, overrides | `~/.pi/agent/models.json` |
| System prompt replacement / append | `~/.pi/agent/SYSTEM.md`, `~/.pi/agent/APPEND_SYSTEM.md` |
| Skills | `~/.pi/agent/skills/`, `~/.agents/skills/`, package `skills/` |
| Sessions | `~/.pi/agent/sessions/--<cwd-dashed>--/*.jsonl` |
| Installed packages | `~/.pi/agent/npm/node_modules/` |

## Feature table

| omp surface | omp behavior | pi equivalent | Status |
|---|---|---|---|
| Provider launch profile | Command prefix, inherited env names, session directory, RPC timeout, role models, denied tools | Launch settings screen: command, args, inherited env, session dir, resource/MCP toggles; per-agent provider options; models.json for roles is not a pi concept | Covered for launch; role-model fields N/A |
| Settings editor | Categorized native config, draft/dirty state, revision conflict, reset, workspace overrides | Settings tab: default provider/model/thinking, enabled models, default tools, session dir, skill commands; full `settings.json` JSON editor; revision conflict; Project tab edits `.pi/settings.json` and `.pi/APPEND_SYSTEM.md` | Covered; no categorized catalog |
| Provider setup | Informational provider/profile card; native config provider sections | Providers & models tab: add/edit/remove provider (`name`, label, base URL, API, write-only key); raw `models.json` editor with masked secrets | Covered; add/edit flow is new |
| Add models | Select existing catalog models through model roles / enabledModels; no add-model form | Fetch the provider's own `/models`, filter and select, then add in one write; add/edit/delete a model per provider; raw JSON retains advanced fields | New (beyond omp) |
| Plugins/extensions install | Install from source, enable, disable, upgrade, uninstall, inspect config | Install package from npm/git/URL/local via `pi install`; update one/all via `pi update`; remove via `pi remove`; add/remove extension paths in settings | Covered |
| Plugin config | Per-plugin settings incl. secrets, write-only | Resource filters and all other package options live in the raw `settings.json` editor; no per-package form | Partial |
| Package enable/disable | Toggle a plugin without uninstalling | No pi equivalent: remove the package, or filter its resources in settings. Extensions and skills have per-item switches; built-ins have their own | Partial (deliberate) |
| Skills | No skill manager in omp plugin | List user/agents/package skills; install from a GitHub file or repository; write or edit a `SKILL.md` by hand; switch or delete each user/agents skill | New (beyond omp) |
| Prompt | No system-prompt editor in omp plugin | Prompt tab edits `APPEND_SYSTEM.md` or `SYSTEM.md`, with revision checks and clear | New (beyond omp) |
| Session history | `Sessions` composer pill: recent prompts for one cwd, read-only, 20 shown | Sessions tab: list by cwd/query, refresh, show title/id/path; delete removes the Paseo agent and the pi file | Covered + new delete |
| Diagnostics | Provider health, binary status/path, process cleanup, capabilities | Overview: availability, version, model count, catalog, diagnostic, config/session paths; Refresh | Partial; no binary health or process cleanup |
| Page layout | Global screen with 7 tabs + workspace panel | Global screen with tabs (Overview, Profiles, Extensions & skills, Providers & models, Prompt, Project, Sessions, Settings) | Covered in spirit |
| Sidebar / command center | `OMP` row, `OMP Hub` row, command items | `Pi` sidebar row and command items: Manage Pi, Providers & models, Pi sessions, Configure Pi launch | Covered |
| MCP management | MCP pill, auth card, server toggles | pi-native `mcp.json` and `/mcp`; provider rejects per-session MCP config | N/A (deliberate) |
| Hub processes | Local Hub process list/popover | No pi equivalent | N/A |
| Memory panel | Local memory browser | pi-memory is a separate package; no pi-native memory API | N/A |
| Quotas | Provider quota snapshots | No pi-native quota API | N/A |
| Composer pills | Per-agent MCP/hub/memory/sessions/quota | One **Reload** pill per built-in `pi` agent (also legacy `pi-plugin`); everything else stays in the Pi screen | Partial, deliberate |
| Tool policy boundary | Disallowed native tools, fail-closed preapproval | Provider rejects session tool policies rather than broadening them | N/A (deliberate) |
| Timeline transforms | omp image tool rendering, MCP auth card | None; pi tool calls already render through the standard timeline | N/A |
| Multiple stores/profiles | omp store picker | Profiles tab: named agent directories exposed as `Pi · name` provider overrides, each with its own settings, models, skills, sessions, and prompt | Covered |

## Plugin RPCs added for the pi surface

`paseo-pi.list-resources`, `install-package`, `update-package`, `remove-package`,
`add-extension`, `remove-extension`, `set-builtin-extension`, `set-extension-enabled`,
`inspect-skill-source`, `install-skill-source`, `create-skill`, `read-skill`, `update-skill`,
`delete-skill`, `set-skill-enabled`, `read-settings`, `save-settings`, `profile-info`,
`prepare-profile`, `remove-profile-provider`, `read-project`, `save-project-settings`,
`save-project-prompt`,
`read-models`, `fetch-models`, `add-models`, `save-provider`, `delete-provider`, `save-model`,
`delete-model`, `save-models-json`, `read-prompt`, `write-prompt`, `list-sessions`,
`delete-session`.

All mutations are direct file writes except package install/update/remove, which run pi's own
installer so npm/git reconciliation stays identical to the CLI. Package commands run with the pi
agent directory as their working directory, so relative local sources are relative to that
directory. File mutations check a SHA-256 revision and write a temporary file before rename.
`models.json` secrets are masked in the raw editor and restored on save. Session deletion realpaths
both sides, refuses files outside the configured session directory, and deletes the matching Paseo
agent before unlinking the JSONL.
