# paseo-pi: build and operations guide

`@wiselfx/paseo-pi` is a Paseo plugin that adds the management surface around the pi coding
agent. Paseo 0.12 already ships a built-in `pi` provider; this plugin uses it and does not register
a second provider. It adds RPCs and a panel that edit pi's own files: extensions and packages,
skills, settings, prompt, providers and models, and sessions. It also installs a small generated
extension so built-in pi sessions expose `/reload`.

Everything in this document was verified against the code in this repository and the SDK version it
depends on (`@getpaseo/plugin` 0.12.0). File paths are relative to the repository root unless
stated otherwise.

## 1. Repository map

| Path | What it is |
|---|---|
| `paseo-plugin.json` | Plugin manifest: id `paseo-pi`, requires Paseo `^0.12.0`. |
| `index.server.ts` | Server entry: registers management RPCs and settings, and syncs the built-in `/reload` extension. |
| `index.client.tsx` | Client entry: sidebar row, management screen, launch-settings screen, command-center items. |
| `shared/` | Zod contracts shared by client and server; no runtime state. |
| `shared/constants.ts` | IDs: plugin `paseo-pi`, built-in provider `pi`, legacy provider `pi-plugin`, screen `pi-config`, launch settings `paseo-pi-launch`, persistence version `1`. |
| `shared/settings.ts` | Launch settings schema (`command`, `args`, `inheritEnv`, `sessionDir`, the context/MCP toggles, `reloadCommand`, `profiles`, `managedProfile`). |
| `server/builtin-reload.ts` | Installs/removes `extensions/paseo-pi-reload.ts` for built-in pi sessions. |
| `shared/source.ts` | Normalises a pasted `pi install …` command to its package source. |
| `shared/rpc.ts` | Status/refresh RPCs. |
| `shared/management.ts` | One RPC per management operation, all schemas and limits, `PI_MODELS_SECRET_MASK`. |
| `server/paths.ts` | Resolves the pi agent directory, including the active profile. |
| `server/profiles.ts` | Named agent directories and their Paseo provider overrides. |
| `server/project.ts` | Reads/writes project `.pi/settings.json` and `.pi/APPEND_SYSTEM.md`. |
| `server/provider/registration.ts` | Legacy provider registration and availability status (not registered). |
| `server/provider/connection.ts` | Legacy provider connection: catalog, session dispatch, session map. |
| `server/provider/rpc.ts` | One `pi --mode rpc` child, JSONL framing, request/response and events. |
| `server/provider/session.ts` | Session state machine, pi command calls, timeline translation. |
| `server/provider/options.ts` | Launch precedence and RPC argument construction. |
| `server/provider/reload-extension.ts` | Generates the tiny extension that exposes pi's `/reload` over RPC. |
| `server/provider/models.ts` | Wire model to `ProviderModel`/usage mapping. |
| `server/provider/timeline.ts` | pi message/tool content to Paseo timeline details. |
| `server/sessions.ts` | Session file discovery, summaries, persistence parsing. |
| `server/skill-source.ts` | GitHub link parsing, repository scan, skill download and write. |
| `server/model-source.ts` | Asks a configured provider for its model list (OpenAI, Anthropic, Google). |
| `server/management.ts` | All file mutations: settings, models, prompt, skills, sessions, packages. |
| `server/pi-status.ts` | Host status probe and model catalog for the Overview tab. |
| `client/manage/` | The management panel, split by tab. |
| `client/settings-screen.tsx` | The host-scoped `pi-launch` settings screen. |
| `client/reload-pill.tsx` | The **Reload** composer pill for built-in `pi` (and legacy `pi-plugin`) agents. |
| `tests/` | Vitest unit tests (`tests/fixtures/fake-pi.mjs` is the RPC test double). |
| `scripts/` | Live smoke scripts, including `smoke-reload.ts`. |

`client/pi-screen.tsx` is an unused early prototype; the live panel is `client/manage/screen.tsx`.

## 2. How the pieces fit

### 2.1 Registration

Server (`index.server.ts`, default export `contribute(server)`):

1. `server.registerSettings(piSettings)` — host-scoped launch settings, id `paseo-pi-launch`.
2. `readSettings()` reads them; invalid or missing settings fall back to `PI_SETTINGS_DEFAULTS`.
3. `context()` builds a `ManagementContext` per call: settings, resolved session directory, agent
   directory, and a copy of the process environment with `PI_CODING_AGENT_DIR` pinned.
4. `ensureBuiltinReloadExtension()` runs on startup and whenever launch settings change, for the
   default agent directory and for every profile directory. With `reloadCommand` on it writes
   `extensions/paseo-pi-reload.ts`; with it off it removes only that generated file. A user file
   with the same name is never touched.
5. `server.handle(rpc, handler)` registers one handler per management RPC. No provider is
   registered.

Client (`index.client.tsx`, default export `contribute(client)`): adds the `Pi` sidebar row, the
`srv_*/plugin/paseo-pi/surface/pi-config` screen, the `pi-launch` settings screen, and four
command-center items (`Manage Pi`, `Pi profiles`, `Project Pi settings`, `Pi providers & models`,
`Pi sessions`, `Configure Pi launch`). The return value removes everything on unload.

### 2.2 Legacy provider bridge (not registered)

The following four sections describe `server/provider/`, kept for the legacy `pi-plugin` code and
its tests. New sessions use Paseo's built-in `pi` provider; `registration.ts` and `connection.ts`
are no longer called by `index.server.ts`.

`server/provider/registration.ts` returns a `ProviderRegistration`:

| Field | Value |
|---|---|
| `id` / `label` | `pi-plugin` / `Pi Plugin` |
| `icon` | `server/provider/pi.svg` (plugin-root relative) |
| `command` | `["pi"]` (display/health hint; the real command comes from launch settings) |
| `status(request)` | Runs `command --version` (8 s, 30 s cache) and reports available/version. |
| `connect(request)` | Reads launch settings and returns `createPiConnection(deps, request)`. |

`createPiConnection` (`server/provider/connection.ts`) negotiates capabilities with
`negotiateProviderCapabilities`, then handles `catalog`, `sessions`, `session.open`,
`session.prompt`, `session.configure`, `session.interrupt`, and `session.close`. Sessions live in a
`Map<sessionId, PiSession>`; at most 32 may be open or opening. Catalog probes are cached 60 s.

Advertised capabilities (`PI_CAPABILITIES` in `server/provider/session.ts`):
`prompt.message`, `prompt.command`, `prompt.image`, `prompt.steer`, `session.configure`,
`session.list`, `session.persistence`. Everything else the host offers is dropped by negotiation.
Per-session MCP servers, tool policies, modes, structured output, permissions, and timeline
plugins are deliberately unsupported (`session.ts`, `dispatch` default branch).

### 2.3 The pi RPC child

`server/provider/rpc.ts` spawns one `pi` process per session with stdio pipes, detached on
non-Windows so Paseo can signal it. Framing is pi's RPC protocol: one JSON object per line, split
on LF only, never on Unicode separators. The class:

- Writes `{ id, type: command, ...payload }` and resolves by `id` from `response` records.
- Delivers non-response records to `onEvent` listeners in arrival order.
- Rejects a response with `success: false` using pi's error message.
- Times requests out at 30 s (60 s for prompt/abort), records stderr (capped 16 KB), and fails all
  pending requests when the child exits or its stdin errors.
- `close()` closes stdin, waits up to 5 s, then SIGTERM, 2 s, then SIGKILL; a spawn error resolves the exit
  promise so close never hangs.

### 2.4 Session lifecycle

`PiSession.open` (`server/provider/session.ts`):

1. Validates an absolute cwd, rejects MCP servers, tool preapproval, and bad persistence.
2. Builds arguments with `buildSessionArgs` (see 2.5) and spawns through the connection.
3. Calls `get_state`; when resuming, verifies pi returned the same `sessionId` (`pi resumed a
   different session`).
4. Calls `get_available_models`; if a model was requested and differs, `set_model` with
   `{ provider, modelId }`.
5. If a thinking option was requested, calls `get_available_thinking_levels` and applies
   `set_thinking_level` when supported. `off` is applied like any other level.
6. Reads `get_state` and thinking levels again, builds the `ProviderConfigState`, emits
   `session.opened` (with persistence when pi persisted), `session.config`, optional replay from
   `get_messages`, and `session.commands` from `get_commands`, then `session.ready`.

Runtime commands: `prompt` (adds `streamingBehavior: "steer"` when a turn is already pending or
running), `steer` for `delivery: "steer"`, `configure` (`set_model`,
`set_thinking_level`), `interrupt` (`abort`, 60 s), and `close` (removes listeners, closes the RPC,
emits `session.closed` once). Process exit emits `session.closed` with the exit code.

Events are translated into Paseo timeline items and session events: user/assistant messages,
reasoning, tool calls (typed details via `timeline.ts`), compaction, errors, notices for retries
and aborts, turn start/settle, thinking-level changes, and usage from message usage and
`get_session_stats`.

### 2.5 Launch settings, provider options, and argument order

`server/provider/options.ts` defines the precedence and is the single place to change what pi is
invoked with.

| Setting | Source order (first wins) |
|---|---|
| Command | Paseo's resolved launch → per-agent `providerOptions.command` → host `pi-launch.command` → `pi` |
| Args | Paseo launch → `providerOptions.args` → host `args` |
| Env | `inheritEnv` names copied from the daemon env, then settings, then provider options, then Paseo launch (later wins) |

Per-agent provider options (`PiProviderOptionsSchema`) are `command`, `args`, `env`, `inheritEnv`,
`sessionDir`, `noExtensions`, `noSkills`, `noContextFiles`, `noMcp`, `extraArgs`. Unknown keys are
stripped. Per-agent `noExtensions` and `noSkills` remain for a deliberate whole-run override;
the host screen no longer offers them, because extensions and skills are switched one at a time.
The host `reloadCommand` toggle (default on) controls the generated extension.

`buildSessionArgs` emits, in order: `--mode rpc`, `--session <abs>` (resume) or `--no-session`,
`--session-dir`, `--name <title>`, any requested `--no-*` flags, `--append-system-prompt <text>` when a
system prompt was supplied, one `--extension <path>` per `extensionPaths` entry (the reload bridge),
then `extraArgs` last. Launch args are prepended before all of this by the connection.

An explicit `--extension` is loaded even with `--no-extensions`, which is why the reload bridge does
not depend on the user's extension settings.

The agent directory comes from `server/paths.ts`: `PI_CODING_AGENT_DIR`, then legacy
`PI_CONFIG_DIR`, then `~/.pi/agent`. The session directory comes from
`resolveSessionDir` (`server/sessions.ts`): explicit option, then `PI_CODING_AGENT_SESSION_DIR` in
per-agent env or process env, then `<agentDir>/sessions`.

### 2.6 End-to-end flow

```
Paseo host
  ├── built-in provider "pi" ──> `pi --mode rpc` child
  │        └── discovers ~/.pi/agent/extensions/paseo-pi-reload.ts (/reload)
  ├── side bar / command center ──> client/manage/screen.tsx ──> useRpc(...) ─┐
  │                                                                           │
  └── index.server.ts handlers ──> server/management.ts                      │
                                       ├── settings.json                     │
                                       ├── models.json                       │
                                       ├── SYSTEM.md / APPEND_SYSTEM.md      │
                                       ├── skills/                           │
                                       ├── sessions/*.jsonl                  │
                                       └── `pi install|update|remove`        │
                                                                              ▼
                                             management RPCs return to the panel
```

The legacy bridge (`createPiConnection` → `PiSession` → `PiRpc`) is still in the tree and tested,
but `index.server.ts` does not register it.

## 3. Feature reference

Every management RPC lives in `shared/management.ts` (plus `shared/rpc.ts` for status) and is
handled in `index.server.ts` by a function in `server/management.ts`. All file writes use the same
primitives:

- **Revision**: SHA-256 of the current file text, `"missing"` when the file does not exist. A save
  with a stale revision fails with `... changed on disk. Reload and try again.`
- **Atomic write**: content is written to a mode-0600 temporary file in the target directory and
  renamed over the target, which also normalizes permissions to 0600.
- **Unknown-key preservation**: JSON is parsed, mutated in place, and re-serialized; keys the UI
  does not know survive.

### 3.1 Extensions and packages

| RPC | Input → output |
|---|---|
| `paseo-pi.list-resources` | `{}` → `{ agentDir, extensions[], skills[] }` |
| `paseo-pi.install-package` | `{ source }` → `{ output }` |
| `paseo-pi.update-package` | `{ source? }` → `{ output }` |
| `paseo-pi.remove-package` | `{ source }` → `{ output }` |
| `paseo-pi.add-extension` | `{ path }` → `{ path }` |
| `paseo-pi.remove-extension` | `{ path }` → `{ path }` |
| `paseo-pi.set-builtin-extension` | `{ name, enabled }` → `{ enabled }` |
| `paseo-pi.set-extension-enabled` | `{ path, enabled }` → `{ path, enabled }` |

**Packages.** `installPiPackage` / `updatePiPackages` / `removePiPackage` shell out to
`pi install|update|remove` with the agent directory as cwd, `PI_CODING_AGENT_DIR` forced, launch
args applied, a 180 s timeout, and a 4 MB output cap. `update` with no source runs
`pi update --extensions`. Sources are validated: `npm:`, `git:`, `http(s)://`, `ssh://`, `~/`,
absolute, or `./`/`../`; control characters and a leading `-` are rejected. Before validation,
`normalizePackageInput` strips a pasted shell prompt, backticks, quotes, and a
`pi install`/`pi add`/`pi i` prefix, so `pi install npm:@scope/pkg` is stored as `npm:@scope/pkg`.
The extension-path field uses the same normaliser and rejects package sources with a pointer to
Install package. Relative local sources
therefore resolve against the agent directory.

`listPiResources` merges: the four built-ins (`mcp`, `llama.cpp`, `codemode`, `tool-search`),
package entries from `settings.packages` (string or `{ source, ...filters }` objects; negated
entries skipped; `filtered` set when a non-source key holds a non-empty array), configured
`settings.extensions` entries, and extensions discovered under `<agentDir>/extensions` (files with
a script extension, and directories with a `package.json`; discovered entries are not removable).
A package shows its `package.json` name/version when it can be located: `npm:` under
`<agentDir>/npm/node_modules/<name>`, `~/` and absolute paths directly, `./` relative to the agent
directory.

**Built-in toggles.** `setBuiltinExtension` removes `+builtin:<name>` and `-builtin:<name>` and
appends `-builtin:<name>` when disabling. Built-ins not mentioned are enabled. `settings.extensions`
can also carry these markers directly; the list view marks the built-in disabled when it sees
`-builtin:<name>`.

**One extension at a time.** `setPiExtensionEnabled` uses pi's exact override markers in
`settings.extensions`: disabling removes a `+path` registration (keeping a plain one) and appends
`-path`; enabling removes `-path` and `!path`. Plain entries are never removed, so a configured
extension keeps its registration while switched off. `listPiResources` reports `enabled` for
configured, discovered, and built-in entries using the same `!`/`+`/`-` precedence pi applies.
Discovered entries mirror pi's discovery (`pi.extensions` in `package.json`, then `index.ts` or
`index.js`, or a top-level `.ts`/`.js` file).

**Extension paths.** `addPiExtension` rejects `-`, `!`, control characters, and
`+?builtin:` paths; it is idempotent for an existing `value` or `+value`, and removes a stale
`-value`/`!value` so re-adding actually re-enables the extension. `removePiExtension` removes
`value`, `+value`, `-value`, and `!value`. Non-string entries in the array are preserved.

Client: `client/manage/resources.tsx`. Package install, per-package Update/Remove, Add extension,
per-extension Remove, built-in Enable/Disable buttons, and the skills card. Destructive actions go
through `ConfirmButton` (two taps, 5 s window). Package output is shown as the notice.

### 3.2 Skills

| RPC | Input → output |
|---|---|
| `paseo-pi.inspect-skill-source` | `{ source }` → `{ candidates[{ name, description, path, url, installed }] }` |
| `paseo-pi.install-skill-source` | `{ source, path? }` → `{ path, name }` |
| `paseo-pi.set-skill-enabled` | `{ path, enabled }` → `{ path, enabled }` |
| `paseo-pi.create-skill` | `{ name, description, instructions? }` → `{ path }` |
| `paseo-pi.delete-skill` | `{ path }` → `{ path }` |

Skills are listed by `listPiResources` from, in order: `<agentDir>/skills`, `~/.agents/skills`,
each configured `settings.skills` path (negations and globs skipped), each installed package's
`skills/` directory and its `package.json` `pi.skills` entries. Scanning is depth-limited (6) and
capped at 400 entries; `node_modules`, `.git`, and symlinked roots/directories are skipped.
Frontmatter is parsed for `name` and `description` (including `|`/`>` block scalars); the name
falls back to the containing directory. Duplicate names are collapsed by name, user/agent skills
first. Only entries under the two user roots are `removable: true`; package entries are removed by
removing their package. "Install/remove skill bundles" is therefore package install/remove.

`createPiSkill` validates the name (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), refuses an existing directory,
resolves the real `skills/` root and refuses it if it escapes the real agent directory, then writes
`SKILL.md` (mode 0600) with YAML frontmatter and a JSON-quoted description.
`deletePiSkill` accepts only a path whose basename is `SKILL.md`, realpaths it, requires the
requested directory to be the real one (no symlink), requires the directory to be inside one of the
two real user skill roots, and removes it recursively.

**GitHub skills.** `server/skill-source.ts` accepts `github.com` and
`raw.githubusercontent.com` links in file (`blob`, `raw`), repository, directory (`tree`), and bare
`owner/repo` forms. A file link is one candidate. A repository is scanned through the GitHub trees
API for `SKILL.md` blobs (first 60; names and descriptions read with six concurrent raw fetches, a
failed file falling back to its directory name). Frontmatter parsing handles quoted values and
`|`/`>` block scalars. `installGitHubSkill` re-downloads the chosen file and writes it to
`<agentDir>/skills/<name>/SKILL.md` (0600), refusing a name that already exists and verifying the
real skills root stays inside the real agent directory. GitHub's rate limit (403/429) and a missing
default branch produce explicit errors. Tests inject `fetch`, so the suite stays offline; a live run
against `anthropics/skills` found all 20 skills and installed one to a temporary agent directory.

Each skill also has its own **Enabled** switch. `setPiSkillEnabled` writes an exact `-<SKILL.md path>`
entry to `settings.skills` when off and removes it when on; pi matches a `SKILL.md` entry by its file
or its containing directory. Package skills show a badge instead: their resources follow the
package's filters, so they are not toggled here. The listing reports `enabled` for user, agents, and
configured skills.

Client: the Skills card in `client/manage/resources.tsx`: paste a link, **Find skills**, filter and
Add a candidate (installed ones are disabled); **Write one instead** opens the manual form. Remove
with confirm, the per-skill switch, and source badges remain. The Extensions card has one switch per
configured or discovered extension, and one per built-in.

### 3.3 Settings

| RPC | Input → output |
|---|---|
| `paseo-pi.read-settings` | `{}` → `{ path, revision, settings }` |
| `paseo-pi.save-settings` | `{ revision, settings }` → `{ revision }` |

`settings.json` (`<agentDir>/settings.json`) is read as a JSON object (max 1 MB) and written whole,
which preserves unknown keys because the client starts from what it read. The form edits
`defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `enabledModels` and `defaultTools`
(comma-separated lists; blank deletes the key), `sessionDir`, and `enableSkillCommands` (on deletes
the key, off writes `false`). The JSON editor parses on "Apply JSON to form" and writes on save.

Launch settings are separate: they are the Paseo `pi-launch` settings screen
(`client/settings-screen.tsx`, schema in `shared/settings.ts`) and are stored by the host, not in
pi's `settings.json`.

### 3.4 Prompt

| RPC | Input → output |
|---|---|
| `paseo-pi.read-prompt` | `{ kind: "system" \| "append" }` → `{ kind, path, revision, content, exists }` |
| `paseo-pi.write-prompt` | `{ kind, revision, content }` → `{ revision, exists }` |

`SYSTEM.md` replaces pi's system prompt; `APPEND_SYSTEM.md` appends to it. Both live in the agent
directory (max 2 MB). Writing empty content unlinks the file and returns
`{ revision: "missing", exists: false }`; otherwise the new content is written and its hash
returned. A stale revision is rejected. The client (`client/manage/prompt.tsx`) has a file switch,
an editor, Save (disabled until dirty), Reload, and two-tap Clear.

### 3.5 Providers and models

| RPC | Input → output |
|---|---|
| `paseo-pi.read-models` | `{}` → `{ path, revision, providers[], raw }` |
| `paseo-pi.save-provider` | `{ revision, originalName?, provider }` → `{ revision }` |
| `paseo-pi.delete-provider` | `{ revision, name }` → `{ revision }` |
| `paseo-pi.save-model` | `{ revision, provider, originalId?, model }` → `{ revision }` |
| `paseo-pi.delete-model` | `{ revision, provider, id }` → `{ revision }` |
| `paseo-pi.save-models-json` | `{ revision, json }` → `{ revision }` |
| `paseo-pi.fetch-models` | `{ provider }` → `{ baseUrl, api, models[] }` |
| `paseo-pi.add-models` | `{ revision, provider, models[] }` → `{ revision, added, skipped }` |

`models.json` (max 2 MB) is mutated in place so advanced fields survive:

- Provider: `name` (display label), `baseUrl`, `api`, `apiKey`, `models`. Adding a provider whose
  name already exists is rejected; editing one that disappeared is rejected (`no longer exists`);
  renaming checks the target name. Blank trim-able fields (`name`, `baseUrl`, `api`) delete the
  key; an empty `apiKey` deletes it.
- Model: `id`, `name`, `reasoning`, `input`, `contextWindow`, `maxTokens`. Renaming a model whose
  original id disappeared is rejected; adding a duplicate id is rejected. `contextWindow: null` and
  `maxTokens: null` delete those keys.
- The client parses the limit fields as positive numbers; empty sends `null`.

**API key handling.** No RPC ever returns a key. `read-models` reports `apiKeySet: true/false` only,
and the client sends `apiKey` solely when the user typed in the field: an omitted value preserves
the stored key, an explicit empty string clears it. The raw editor is a second path to the same
file: values whose key looks secret (`SECRET_NAME` in `server/management.ts`: `apiKey`,
`accessToken`, `token`, `secret`, `password`, `authorization`, `cookie`, credentials, and variants,
except provider names directly under `providers`) are replaced by `__PI_SECRET__`. On save the
current file's values are restored wherever the marker remains; changing or deleting a masked value
persists the change. A masked value with no current counterpart is dropped.

**Fetching.** `fetchProviderModels` reads the provider record server-side (the key never reaches
the client), expands a `$ENV` key from the plugin's environment, and calls the provider's own
`/models`: OpenAI-compatible `GET /models` with a bearer token, Anthropic `GET /models?limit=1000`
with `x-api-key` and `anthropic-version`, Google `GET /models?pageSize=1000&key=…`. Responses are
capped at 2 MB and mapped to id, label, vision, reasoning, context and output limits. A rejected key
(401/403), a non-JSON body, and a provider without `baseUrl` each produce a specific error.
`addModels` applies one revision-checked mutation, skips ids that already exist, and returns how
many were added and skipped.

**One catalog.** Paseo's built-in `pi` provider publishes pi's models. The plugin does not register
a provider, so there is no duplicate model list and no `exposeModels` switch. The legacy
`server/provider/connection.ts` still answers `catalog` with `models: []` unless its own
`exposeModels` flag is set, but that code is only exercised by tests.

Client: `client/manage/models.tsx`: provider form, model form, per-provider and per-model
Edit/Delete, the raw `models.json` editor, and **Fetch models** → filter → **Select all shown** /
individual toggles → **Add selected**.

### 3.6 Sessions

| RPC | Input → output |
|---|---|
| `paseo-pi.status` | `{}` → `{ command, available, version, diagnostic, sessionDir, modelCount, models[], configDir }` |
| `paseo-pi.refresh` | `{}` → `{ refreshedAt }` |
| `paseo-pi.list-sessions` | `{ cwd?, query?, limit? }` → `{ sessionDir, sessions[] }` |
| `paseo-pi.delete-session` | `{ sessionFile }` → `{ sessionFile, deletedAgents }` |

The legacy provider also implements `session.list` for Paseo's own pickers via the same
`listPiSessions`; built-in `pi` uses Paseo's own session handling. `server/sessions.ts` walks the
session directory (depth 3, 5000 files), reads at most 8 MB per file, takes `id`/`cwd` from the first `type: "session"` record, prefers
`session_info.name`, falls back to the first user text (160 chars), and returns newest first
(limit clamped 1..200; the panel asks for 100). Filters are exact `cwd` and a case-insensitive
substring over title/id/cwd/path.

Delete accepts only an absolute `.jsonl`, realpaths both the file and the session directory,
requires a regular file inside that directory, then finds Paseo agents whose persistence points at
that path (`paseoAgentIdsForSession`). Built-in pi stores it as `persistence.nativeHandle`; legacy
`pi-plugin` agents store it under `persistence.metadata.pluginProviderPersistence.data.sessionFile`.
Each match is deleted with
`paseo delete <id> --json` (the CLI cancels a running agent first), falling back from
`@getpaseo/cli` next to the daemon to `paseo` on `PATH`, and passing `--home` when `PASEO_HOME` is
set. Only after that succeeds is the JSONL unlinked, so a failed Paseo delete leaves the session for
a retry. A session with no Paseo record is simply unlinked. The plugin server bundle is CommonJS
and has no usable `import.meta.url`, so the CLI path is resolved with
`createRequire(process.argv[1])`.

Persistence is version 1: `{ version: 1, data: { sessionFile, sessionId? } }`, with an absolute
`sessionFile`. `piStatus` runs `pi --version` (8 s) and probes models through a `--no-session` RPC
child; it caches for 20 s keyed by the settings, agent directory, session directory, and the
mtime/size of `settings.json` and `models.json`, so a management save invalidates it immediately.
`paseo-pi.refresh` clears the cache and re-probes; that is what the Overview Refresh button calls.

"Reload sessions" in the UI re-reads the session files; it is unrelated to pi's `/reload`, which
reloads resources inside a live session (next section).

### 3.7 Reload

pi's RPC mode has no reload request, but extension commands run inside the session and receive
`ctx.reload()`. The plugin ships that bridge as a discovered extension:

- `server/provider/reload-extension.ts` holds a one-command extension (`registerCommand("reload")`
  → `ctx.reload()`). `server/builtin-reload.ts` writes the same source to
  `~/.pi/agent/extensions/paseo-pi-reload.ts` (file 0600).
- Built-in pi sessions discover it on start and list `/reload` in `get_commands`. Typing `/reload`
  runs pi's own command, which reloads settings, API providers, extensions, skills, prompts, themes
  and context files.
- The **Reload** composer pill appears for every idle built-in `pi` agent, and for legacy
  `pi-plugin` agents (`client/reload-pill.tsx`); it simply sends `/reload`, and is disabled while
  the agent runs.
- Turning **Reload command** off in the Pi launch settings removes the generated file. Turning it
  back on writes it again. The file also appears under **Extensions & skills** as **paseo-pi
  reload**, so pi's normal `-path` switch can disable it without deleting it.
- A session opened before the extension was installed has no reload command; archive and reopen
  it.

The legacy `pi-plugin` provider still intercepts `/reload` in `PiSession.prompt`, checks
`disposition: "handled"`, and emits a `Reloaded pi resources` notice. That path only applies to old
agents. After a legacy reload, the provider re-reads `get_state`, thinking levels,
`get_available_models` and `get_commands`, then emits `session.config` and `session.commands`.

pi itself reloads settings (including `defaultTools`), API providers, and the resource loader:
extensions, skills, prompts, themes and context files. That is the same path as the interactive
`/reload`, and it requires an idle session.

### 3.8 Overview

`client/manage/overview.tsx` shows command, version, availability, model count, session directory,
agent directory, the model catalog from `piStatus`, and shortcuts into the other tabs.

### 3.9 Profiles

`server/profiles.ts` implements named agent directories without registering a second provider:

- A name is lowercase letters, numbers, and hyphens, at most 40 characters. The default directory
  is `~/.pi/profiles/<name>/agent`; an explicit path must be absolute. A profile may not reuse the
  default agent directory or another profile's directory.
- `prepare-profile` creates the directory (0700), installs the generated reload extension there,
  and adds a Paseo provider override `{ extends: "pi", label: "Pi · <name>", env: {
  PI_CODING_AGENT_DIR: <dir> } }` with id `pi-<name>`. Paseo shows it as `Pi · <name>`.
- The override is written through `config.patch({ providers })`; `remove-profile-provider` calls
  `config.patch({ removeProviders: [id] })`. Both are host config mutations, not provider
  registration, so Paseo's own `pi` provider remains the implementation.
- `profiles` and `managedProfile` live in the host-scoped `piSettings`. `managedProfile` selects
  the directory every management RPC reads and writes. The Profiles tab's **Manage** action saves
  it; the active profile is shown in the tab and in Settings/Overview paths.
- Removing a profile first removes it from settings and then unregisters the provider. The agent
  directory is never deleted; it keeps settings, skills, extensions, and session history for a
  future profile or manual use.
- Existing Paseo agents keep the provider id they were created with. Choosing a profile affects
  new agents only.

### 3.10 Project settings

`server/project.ts` resolves the requested path with `realpath`, rejects a non-directory, and edits
`<root>/.pi/settings.json` and `<root>/.pi/APPEND_SYSTEM.md`. It refuses symlinked `.pi` paths or
files, creates `.pi` with mode 0700 and files with mode 0600, and uses SHA-256 revisions like the
user-level files. An empty prompt removes `APPEND_SYSTEM.md`. Pi only applies project settings and
prompts after the project is trusted (`~/.pi/agent/trust.json`); the tab states this rather than
editing the trust database.

### 3.11 UI conventions

The panel should read as part of Paseo, not as a separate app. `client/manage/shared.tsx` holds the
only visual primitives: surfaces use `surface1` with a 1px border and 12px radius, rows are
separated by hairlines, section labels are 13px muted sentence case, body text is 14px, and
monospace paths are 12px with the platform stack. Buttons use quiet outline/ghost variants except
for one primary action per area; destructive actions use quiet red text, then a filled red button
after confirmation.

The management page is 820px wide, left aligned to the same 28px gutter as the tab bar (16px in
Paseo's compact layout). Tabs scroll horizontally on narrow screens and reveal the active tab.
Rows stack their actions in compact layouts. The plugin UI package has no Switch or Button
primitive, so the animated switch and buttons are local; do not replace them with `SettingsInput`
rows, which are full-width settings rows and clip long values.

`client/settings-screen.tsx` (launch settings) uses the same primitives for full-width fields
instead of the host's `SettingsInput`/`SettingsSwitch`.

## 4. Data formats and limits

| Thing | Location | Shape / limit |
|---|---|---|
| Agent directory | resolved by `server/paths.ts` | `PI_CODING_AGENT_DIR` → `PI_CONFIG_DIR` → `~/.pi/agent` |
| Settings | `<agentDir>/settings.json` | JSON object, 1 MB |
| Providers/models | `<agentDir>/models.json` | JSON object, 2 MB; `providers.<name>.{name,baseUrl,api,apiKey,models[]}`; model `{id,name,reasoning,input[],contextWindow,maxTokens,...}` |
| Prompt | `<agentDir>/SYSTEM.md`, `APPEND_SYSTEM.md` | text, 2 MB |
| Skills | `<agentDir>/skills/<name>/SKILL.md`, `~/.agents/skills/**/SKILL.md` | YAML frontmatter `name`, `description`; body |
| Sessions | `<agentDir>/sessions/--<cwd>--/*.jsonl` | first record `{type:"session",id,cwd}`, then `session_info`, `message` |
| Packages | `<agentDir>/npm/node_modules/<name>` | `package.json` name/version/`pi.skills` |
| RPC limits | `shared/management.ts` | prompt 2 MB, raw models 4 MB, skill description 1024, instructions 200 000, package source 4096, provider id `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, limits ≤ 100 000 000 |

## 5. Tests and QA

Commands (prefix `NODE_OPTIONS=` because the environment imports a global jiti register that
otherwise breaks node tooling):

```bash
NODE_OPTIONS= ./node_modules/.bin/tsc --noEmit
NODE_OPTIONS= ./node_modules/.bin/vitest run
```

| Test file | Covers |
|---|---|
| `tests/rpc.test.ts` | Framing (split chunk, two frames, CRLF), response by id, event order, malformed line diagnostic, failed response, timeout and exit. Uses `tests/fixtures/fake-pi.mjs`. |
| `tests/options.test.ts` | Launch precedence, env inheritance by name, empty command rejection, session args order (resume absolute, toggles, title, prompt, `--extension`, extra args), blank prompt omitted. |
| `tests/models.test.ts` | Model id split at the first slash, thinking ladders, wire model mapping, usage mapping. |
| `tests/timeline.test.ts` | Text/thinking/tool-call blocks, typed tool details (shell/read/edit/write/search), plain-text fallback. |
| `tests/sessions.test.ts` | Listing order and titles, cwd/query filters, limit, missing directory, persistence acceptance/rejection, session directory precedence including custom agent dirs. |
| `tests/reload.test.ts` | The generated extension is private (`0600`) and calls `ctx.reload()`, the path is stable, and only the bare `/reload` is recognized. |
| `tests/reload-pill.test.ts` | The pill appears for built-in `pi` and legacy `pi-plugin` agents, sends `/reload`, disables while running, re-scopes on a workspace move, and cleans up. |
| `tests/builtin-reload.test.ts` | The generated extension installs idempotently, is removed only when it carries the plugin marker, and never overwrites a user file. |
| `tests/source.test.ts` | Pasted `pi install`/`pi add`, shell prompt, quotes and backticks normalise to the bare package source; paths are not mistaken for packages. |
| `tests/skill-source.test.ts` | GitHub link forms, SKILL.md frontmatter (quotes, block scalars), repository scans with a fake `fetch`, per-file tolerance, rate-limit and empty-repo errors, and installs that write `SKILL.md` with mode 0600 and refuse duplicates. |
| `tests/model-source.test.ts` | OpenAI/Anthropic/Google endpoint, headers and query keys; `$ENV` expansion; vision/reasoning/context mapping; 401, non-JSON, missing base URL and missing provider errors. |
| `tests/connection-catalog.test.ts` | The legacy bridge: catalog empty without `exposeModels` (and does not even ask pi for models), and contains pi's models with it. |
| `tests/management.test.ts` | Settings read/save/stale revision, resource listing, provider/model CRUD without key disclosure, raw JSON revisions, secret masking/restore, prototype-named providers, duplicate/missing providers, model limit clearing, skill create/delete, per-skill and per-extension toggles that leave their neighbours alone, prompt write/clear, session listing and confined delete, and mapping a session file to Paseo agent ids. |

Current result: **13 files, 90 tests passed**, `tsc --noEmit` exit 0.

Smoke scripts (need a pi binary; `scripts/pi-env.ts` reads `PI_COMMAND`, `PI_ARGS`,
`PI_SMOKE_DIR`, `PI_SMOKE_MODEL`, `PI_SMOKE_CWD`):

| Script | What it checks |
|---|---|
| `smoke-rpc.ts` | A real `pi --mode rpc` child: model, model list, thinking levels, commands. |
| `smoke-session.ts` | `createPiConnection` end to end: open, prompt, assistant timeline item, persistence. |
| `smoke-resume.ts` | Resuming the newest smoke session file and replaying history. |
| `smoke-list.ts` | `listPiSessions` finds files in the smoke directory. |
| `smoke-reload.ts` | Against a real pi child with a throwaway agent dir: `/reload` is a listed command, picks up a skill created after open, and is refused when `reloadCommand` is off. |
| `smoke-toggles.ts` | A real pi child with a throwaway agent dir: a `-<SKILL.md>` marker hides one skill, a `-<extension>` marker hides one extension, and removing the markers loads both again while the other skill stays on. |
| `smoke-paseo.ts` | Against a running daemon: built-in `pi` availability and model, an agent that finishes with a visible reply, the listed `/reload` command, and an accepted reload. |

Run with `NODE_OPTIONS= bun scripts/smoke-*.ts`. `smoke-paseo` defaults to
`ws://127.0.0.1:39085/ws`, provider `pi`, and model `Zen/deepseek-v4.1-flash-free`; set
`PASEO_URL`, `PASEO_PI_PROVIDER`, and `PI_SMOKE_MODEL` to point elsewhere.

Browser QA on the dev daemon: open
`http://127.0.0.1:39085/h/<server>/plugin/paseo-pi/surface/pi-config`, then check tabs, command
center deep links (`?param.tab=models`), the launch-settings save/revert cycle (including the
Reload command switch), the raw models editor masks, GitHub skill lookup, Fetch models, the session
list and delete confirmation, the Reload pill on a built-in `pi` agent, and the console (only
Paseo's own Expo warnings should appear). Check both Paseo themes and a
390px-wide viewport. The launch screen uses the same primitives as the management panel; keep its
fields full width.

An intermittent upstream 400 (`chat message role 'developer' is not supported by the router gRPC
frontend`) can kill a run and leave an empty assistant message with `stopReason: error` in the
session JSONL. It is provider-side; retry the same step once before investigating.

## 6. Troubleshooting

| Symptom | Scope | Check first | API/contract to consult |
|---|---|---|---|
| `... changed on disk. Reload and try again.` | Revision guard working as designed | The tab's Reload button; whether another editor touched the file | `readJsonObject` / `readPrompt` in `server/management.ts` |
| `models.json is not valid JSON` | File on disk, not the UI | `readPiModels`; `models.json` syntax | `mutateModels`, `saveModelsJson` |
| `Provider X is not in models.json` | Provider was deleted or renamed elsewhere | `providersView`, `saveProvider`/`saveModel` | `server/management.ts` |
| `Pi executable not found` | Launch settings or PATH | `pi-launch` command; run `pi --version` in the daemon environment | `server/pi-status.ts` |
| Catalog empty in Paseo | pi config, not the plugin | `pi --mode rpc --no-session` plus `get_available_models`; `models.json` | `server/pi-status.ts` |
| `/reload` missing in a built-in chat | The extension was not installed when the session opened | Turn **Reload command** on; archive and reopen the agent | `server/builtin-reload.ts` |
| Thinking level missing for a model | The model's own capability map | `get_available_thinking_levels`; model `reasoning` | `server/provider/models.ts`, `session.ts` open step |
| `Unknown Pi session` | Session id no longer open | Whether the child exited (stderr in the daemon log) | `connection.ts` dispatch, `PiSession` exit listener |
| Package install/update fails | pi's installer, not the plugin | The error text (returned verbatim); source prefix rules | `runPi`, `validatePackageSource` |
| Extension did not load | Settings entry or pi's loader | `settings.extensions` for `-path`/`!path`; restart the session | `addPiExtension`, `listPiResources` |
| Skill create refuses the root | Symlink or custom agent dir | Real path of `<agentDir>/skills` | `createPiSkill` containment |
| Session list empty | Wrong directory | `piStatus.sessionDir` and `settings.sessionDir` | `resolveSessionDir`, `listPiSessions` |
| Delete rejects a file | Path outside the session dir | Realpath of both sides | `deleteManagedSession`, `inside` |
| `Paseo could not delete agent …` | The CLI could not run or reach the daemon | `PASEO_HOME`; `paseo delete <id> --json --home …` by hand; whether `@getpaseo/cli` sits beside the daemon | `deletePaseoAgent`, `paseoAgentIdsForSession` |
| GitHub lookup fails | Network, rate limit, or the link form | The message (rate limit / not found / no SKILL.md); try a raw or file link | `server/skill-source.ts` |
| A per-item switch does nothing | The resource came from a package, or the marker is a glob | `settings.extensions` / `settings.skills`; whether the item has its own switch | `setPiExtensionEnabled`, `setPiSkillEnabled`, `markerIsEnabled` |
| Fetch models says the key was rejected | Provider credentials, not the plugin | The provider's key and base URL; `$ENV` names in the daemon's environment | `fetchProviderModels` |
| Raw editor shows `__PI_SECRET__` | Masking working as designed | Save restores it unless you edited the value | `redactModelsSecrets` / `restoreModelsSecrets` |
| Status/model count stale | Probe cache | Press Refresh (clears the cache) | `server/pi-status.ts` |
| `/reload` says the command is unavailable | `reloadCommand` off or the child predates the bridge | The launch settings switch; archive and reopen an old session | `session.ts` `reload`, `reload-extension.ts` |
| `/reload` is ignored while a turn runs | Guard by design (same as pi's TUI) | Wait for idle, then send it again | `PiSession.reload` |
| Reload did not pick up a change | What pi reloads vs what you edited | Skills, extensions, prompts, themes and settings reload; `models.json` is re-read too | `refreshAfterReload` |

Deeper reference: `docs/omp-parity-map.md` maps each management feature to the equivalent
`paseo-omp` surface; `README.md` is the short form; `OVERVIEW.md` is the file-level summary.

## 7. Development workflow

```bash
# typecheck and unit tests
NODE_OPTIONS= ./node_modules/.bin/tsc --noEmit
NODE_OPTIONS= ./node_modules/.bin/vitest run

# throwaway daemon (home is git-ignored)
NODE_OPTIONS= ./node_modules/.bin/paseo daemon start --home "$PWD/.paseo-dev"
NODE_OPTIONS= ./node_modules/.bin/paseo plugin reload paseo-pi --home "$PWD/.paseo-dev"
NODE_OPTIONS= ./node_modules/.bin/paseo daemon status --home "$PWD/.paseo-dev"
```

The plugin runs from this directory as its source; reload picks up server changes, while a client
change is picked up by the web bundle on reload. Adding a management feature means: a schema in
`shared/management.ts`, a function in `server/management.ts`, a `server.handle(...)` line in
`index.server.ts`, a `useRpc` call plus UI in `client/manage/*`, and tests.
