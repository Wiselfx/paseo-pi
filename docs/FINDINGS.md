# Findings: building the paseo-pi plugin

What this repository is, what the platform around it actually looks like, what tripped me up, and
what I would tell the next person before they open a diff. Everything is verified against the code
here and the SDKs pinned in `package.json` (`@getpaseo/*` 0.12.0), with upstream commit hashes in
section 5.

## 1. Platform map

### 1.1 The three repositories in play

| Repo | Location | Revision read | What it is |
|---|---|---|---|
| paseo-plugins | `/handoff/Port/paseo-plugins` | `01ba4209e099c0f27a5b85ca6a911def76bc0b2a` (release main #354, 2026-10-19) | Monorepo of Paseo plugins: `paseo-omp`, `paseo-beads`, `paseo-dracula`, `queens`, and others. |
| pi | `/handoff/Port/pi` | `5c1736f82d201d09664642ab0d88147da94b450e` (shallow, 2026-10-19) | The agent this plugin drives. `packages/coding-agent` holds the CLI, RPC mode, and docs. |
| paseo-pi | this repository | uncommitted at time of writing | The plugin: provider + management surface. |

Paseo itself (the app/daemon) is consumed as npm packages: `@getpaseo/cli`, `@getpaseo/server`,
`@getpaseo/plugin`, `@getpaseo/client`, `@getpaseo/protocol`, `@getpaseo/relay`,
`@getpaseo/highlight`, all 0.12.0 here.

### 1.2 The built-in `pi` provider

Paseo 0.12 already runs pi natively. The implementation is in
`node_modules/@getpaseo/server/dist/server/server/agent/providers/pi/`:
`agent.js`, `cli-runtime.js`, `history-mapper.js`, `rewind.js`, `tool-call-mapper.js`,
`usage-poller.js`, `session-descriptor.js`, `rpc-types.js`, and an `extensions/` folder. It owns the
agent loop, history mapping, rewind, usage polling, and its own pi extension for host dialogs.

Consequence: this plugin must be an **enhancement**, not a replacement. The original build
registered a second provider (`pi-plugin`) with the same RPC bridge plus the management surface.
That provider is now unregistered: built-in `pi` sessions discover the plugin's generated
`extensions/paseo-pi-reload.ts`, so `/reload` works without a second provider. Do not try to
re-register the id `pi`; providers are separate entries.

### 1.3 The plugin SDK

`@getpaseo/plugin` exposes two entry points:

- `@getpaseo/plugin/server`: `PluginServerContext` with `registerProvider`, `registerSettings`,
  `handle`, plus the provider contract types in `dist/server/provider.d.ts`.
- `@getpaseo/plugin/client`: `PluginClientContext` with `addScreen`, `addSettingsScreen`,
  `addSidebarHeaderItem`, `addCommandCenterItem`, `openSettings`, `openScreen`, and `useRpc`,
  `useSettings`; UI primitives in `@getpaseo/plugin/client/ui` (`SettingsRow`, `SettingsInput`,
  `SettingsSwitch`, `SettingsAction`, `SidebarRow`, …).

The provider contract is version 1 (`PROVIDER_PROTOCOL_VERSION = 1`). Capabilities are strings; the
host offers a set and the plugin returns the intersection. `ProviderInput` is a discriminated union
(`catalog`, `sessions`, `session.open`, `session.prompt`, `session.configure`,
`session.interrupt`, `session.close`, …) and `ProviderEvent` the outbound counterpart
(`catalog`, `sessions`, `session.opened`, `session.ready`, `session.config`, `session.commands`,
`session.prompt_result`, `session.turn`, `session.usage`, `session.notice`, `session.closed`,
`timeline.item`, `request.completed`, `request.failed`).

### 1.4 `paseo-omp` as the blueprint

`/handoff/Port/paseo-plugins/paseo-omp` (version 3.0.0) is the same integration for oh-my-pi. The
files worth reading before building anything similar:

| File | Why |
|---|---|
| `index.client.tsx`, `index.server.ts` | Registration, screen ids, sidebar and command-center wiring. |
| `client/omp-config-surface.tsx`, `client/omp-config-views.ts` | Tabbed config surface with overview and workspace scoping. |
| `client/omp-plugin-manager.tsx` | Plugin install/enable/disable/upgrade/uninstall and per-plugin settings including write-only secrets. |
| `client/sessions-popover.tsx`, `shared/sessions.ts` | Read-only session history scoped to one cwd. |
| `shared/omp-settings.ts`, `server/omp-settings.ts` | Catalog-driven settings with revisions and workspace overrides. |
| `shared/omp-config.ts`, `shared/omp-models.ts` | Allow-listed config sections and a read-only model catalog. |
| `shared/provider-launch-settings.ts` | Host-scope launch settings with `inheritEnv`. |
| `shared/omp-plugins.ts`, `server/omp-plugins.ts` | RPC contracts and mutation queue for plugins. |

The `docs/omp-parity-map.md` file in this repository keeps the feature-by-feature comparison.

### 1.5 How the two harnesses store state

| Concern | pi | omp |
|---|---|---|
| Agent dir | `~/.pi/agent` (`PI_CODING_AGENT_DIR`, legacy `PI_CONFIG_DIR`) | `~/.omp/agent` |
| Settings | `settings.json` (JSON) | `config.yml` (YAML) |
| Providers/models | `models.json` (JSON) | `config.yml` provider sections |
| Prompt | `SYSTEM.md` / `APPEND_SYSTEM.md` | system prompt settings |
| Skills | `<agentDir>/skills/`, `~/.agents/skills/` | skills config |
| Sessions | `sessions/--<cwd-dashed>--/*.jsonl` | `history.db` (SQLite) |
| Packages | `npm/node_modules/` plus `settings.packages` | plugin store |
| Daemon state | n/a | n/a; Paseo daemon lives in its own home (`daemon-keypair.json`, `plugin-settings/`, `projects/`, `config.json`, …) |

That storage difference is why the parity map says "pi equivalent", not "same implementation".

## 2. Gotchas and traps

1. **Paseo already ships `pi`.** The plugin originally registered `pi-plugin`; it no longer does.
   Nothing should assume it owns the id `pi`; built-in `pi` is Paseo's provider.
2. **Settings ids are validated.** `registerSettings`/`addSettingsScreen` ids must match
   `^[a-z][a-z0-9_-]*$`; a dot fails with "Invalid settings ID". Screen ids (`pi-config`,
   `pi-launch`) and the settings id (`paseo-pi-launch`) are separate namespaces.
3. **`SettingsInput` is uncontrolled.** It takes `initialValue` and needs a `key` that changes when
   the underlying revision changes, or typing is lost/not reset. This plugin keys every input on
   `state.revision`.
4. **Dirty checks must include uncontrolled fields.** Command is in the draft, but args and
   inherit-env live in separate text state; the Save button compares both
   (`client/settings-screen.tsx`). Missing them made Save look disabled.
5. **Host deep links use `?param.tab=models`.** Plain `?tab=models` is ignored. The tab is initial
   state only; clicking a tab does not rewrite the URL.
6. **The environment sets a global jiti import.** `NODE_OPTIONS=--import jiti/register` breaks
   `node -e` and some CLIs from directories without jiti; prefix every node/npm command with
   `NODE_OPTIONS=` in this workspace.
7. **`paseo` is not on `PATH`.** Use `./node_modules/.bin/paseo`; the daemon home is passed with
   `--home "$PWD/.paseo-dev"`, and plugins load from a directory source.
8. **pi child env leaks into shells.** Running a pi child exports `PI_PROVIDER`, `PI_MODEL`,
   `PI_SESSION_FILE`, `PI_SESSION_ID`, `PI_POCKET_*`; smoke scripts override with `PI_COMMAND`,
   `PI_ARGS`, `PI_SMOKE_DIR`, `PI_SMOKE_MODEL`.
9. **Provider capabilities are negotiated, not assumed.** Offer `prompt.message` etc.; unsupported
   inputs (`session.revert`, `permission`, `timeline.plugin`) are simply absent. A request for one
   must fail cleanly (the dispatch default branch returns `request.failed`).
10. **pi RPC framing is LF-only.** Do not split on Unicode line separators; do strip a trailing CR.
    The `PiRpc` buffer loop does exactly this and treats an oversized frame as diagnostics.
11. **pi requests pair by `id`.** Events arrive interleaved before the response; `PiRpc` forwards
    events first, then resolves.
12. **`set_model` payload is `{ provider, modelId }`** (not `model`), and `splitModelId` splits at
    the first slash so provider ids containing slashes still work.
13. **`get_available_thinking_levels` describes the current model only.** For any other model the
    catalog uses pi's default ladder, and `xhigh`/`max` appear only when the model maps them. A
    reasoning model can still default to five levels.
14. **Thinking `off` is a real level.** Treating `thinkingOption === "off"` as "not set" silently
    ignores the user's choice and leaves pi at its default. Pass every non-empty option through and
    apply it when the level list contains it.
15. **`streamingBehavior` is required during a run.** A second prompt while pi is streaming must
    carry `streamingBehavior: "steer"` or pi rejects it. "Streaming" includes the gap between an
    accepted prompt and `agent_start`, which is why `pendingTurnId` counts.
16. **`agent_end` is not `agent_settled`.** Retries, compaction recovery, steering, and follow-ups
    can still happen after `agent_end`; only `agent_settled` means pi will not continue.
17. **`abort` waits for idle.** It can take as long as the current turn's cleanup; the plugin uses a
    60 s timeout. `compaction_end` can arrive with `aborted: true` and no result.
18. **Resume is a file path.** `--session <absolute .jsonl>` resumes; `--no-session` disables
    persistence for a probe. A persisted Paseo session must set `persist: true`, and the plugin
    verifies pi returned the same `sessionId`.
19. **There is no pi session-reload RPC, but extension commands get `session.reload()`.** RPC mode
    dispatches no reload command; `commandContextActions.reload` in `rpc-mode.ts` hands it to
    `AgentSession.reload()`, so a session must load an extension that registers the command. The
    plugin writes one (`server/provider/reload-extension.ts`) and installs it as
    `extensions/paseo-pi-reload.ts` for built-in pi sessions. Do not also pass it as an explicit
    `--extension`: two copies register `reload:1`/`reload:2` and `/reload` stops working. "Reload
    sessions" in the management tab still just re-reads the files.
20. **A running session keeps its loaded extensions.** Toggling extensions or built-ins affects new
    sessions only, unless that session runs `/reload`.
21. **Revisions are per file.** Every read-modify-write carries a SHA-256 of the file text
    (`"missing"` when absent). Any external edit between read and save fails with "changed on
    disk"; the UI must reload rather than retry blindly.
22. **Atomic writes normalize permissions to 0600** because the temp file is created that way.
    Useful for secrets; surprising if someone expected the old mode back.
23. **Secrets are write-only at the API and masked in raw JSON.** `apiKey` is only reported as
    `apiKeySet`; the raw editor substitutes `__PI_SECRET__` for secret-looking keys and restores the
    current values on save. Editing or deleting the marker persists the change; the marker is not a
    literal value.
24. **Provider names directly under `providers` are not secret keys.** A provider literally named
    `token` must not be masked, and `maxTokens`/`apiKeySet`-style names must not be caught by a
    naive substring match. The redactor passes the parent key for this reason.
25. **JSON objects can be hostile.** `__proto__`, `constructor`, and `prototype` as provider names
    must survive as data. Use null-prototype maps and `Object.hasOwn`, never truthiness of
    inherited properties.
26. **Adding a provider must not silently overwrite one.** The UI's "Add provider" starts with no
    `originalName`; the server now rejects a name that already exists. Editing carries
    `originalName` and rejects a provider that disappeared.
27. **`-path`/`!path` is pi's per-resource switch.** In `settings.extensions` it disables one
    extension; in `settings.skills` it disables one skill (the marker may name `SKILL.md` or its
    directory). Adding the same path without removing the negation leaves it disabled.
    `addPiExtension` clears a stale negation on purpose; the toggles remove only exact markers so
    their neighbours and plain registrations survive.
28. **npm package names strip the version after the last `@`.** `npm:@scope/pkg@1.2.3` →
    `@scope/pkg`; `npm:@scope/pkg` keeps its leading `@` because `lastIndexOf("@") === 0`.
29. **Local package sources are relative to the agent directory.** Package commands run with
    `cwd = agentDir`, and the list resolves `./local` the same way.
30. **`pi update` with no package needs `--extensions`** (or it tries to update the agent itself).
31. **Skill roots can be symlinks.** Creating through a symlinked `skills/` root would write
    outside the agent directory; deletion realpaths both sides. Symlinked roots and directories are
    skipped when scanning.
32. **Session deletion is a path-security problem, and it spans two stores.** Require absolute
    `.jsonl`, realpath both the file and the session directory, require a regular file inside it.
    Paseo's `paseo delete <id> --json` removes its agent record and timeline but never the pi JSONL;
    delete the agent first (mapping it through
    `persistence.metadata.pluginProviderPersistence.data.sessionFile`), then unlink the file. A
    failed Paseo delete must leave the file for a retry.
33. **Status caching must include file state.** A probe cached purely on settings goes stale right
    after a management save; the key includes `settings.json` and `models.json` mtime/size.
34. **List virtualization does not exist in the panel.** Tabs render plain `ScrollView`s; keep lists
    short with limits (sessions 100, skills 400, files 5000) rather than virtualizing.
35. **Upstream 400s are real.** The router used for pi sessions intermittently rejects requests
    with `chat message role 'developer' is not supported by the router gRPC frontend`. A session can
    end with `stopReason: "error"` and no assistant text; the plugin surfaces an error timeline
    item. Retry once or twice; it is not caused by this plugin.

36. **Paseo does not dedupe models across providers.** Two providers advertising the same
    `${provider}/${modelId}` both appear in the model browser. This is one reason the plugin stopped
    registering a provider. The legacy bridge still advertises none unless `exposeModels` is on; a
    provider with `models: []` is ready and can create agents.
37. **The plugin server bundle is CommonJS, not a module.** `import.meta.url` is `undefined` and
    `import.meta.resolve` does not exist, so `createRequire(import.meta.url)` fails. Resolve from
    `process.argv[1]` (the daemon's `plugin-process.js`): `createRequire(process.argv[1]).resolve(
    "@getpaseo/cli/dist/index.js")`. Fall back to `paseo` on `PATH`; the CLI is not a declared
    dependency of `@getpaseo/server`.
38. **`SettingsInput` and `SettingsSwitch` are complete rows.** They already take `label` and
    `hint`; wrapping one in `SettingsRow` renders the label twice and pushes the control out of the
    row. Browser QA caught this on the launch screen.
39. **Paseo wraps each agent-list entry.** `agents.list()` returns `entries[{ agent: snapshot }]`,
    not snapshots; persistence is at
    `persistence.metadata.pluginProviderPersistence.data.sessionFile`.
40. **Pasted commands are the normal input.** People paste `pi install npm:…` into a source field.
    Normalise (prompt, backticks, quotes, `pi install`/`add`/`i`) before validating; otherwise the
    field rejects a perfectly good source.
41. **The plugin can be reloaded from the CLI without a restart.** `paseo plugin reload paseo-pi
    --home <home>` reloads the server and client bundle; the browser page needs a reload to pick up
    client changes.
42. **The browser tool can be the broken part.** In this environment Chromium answered HTTP and
    served pages, but every `browser` action returned empty output until the app was reinstalled.
    Verify with `curl` and the live smoke scripts before assuming the app is at fault.

43. **Discovered extensions are narrower than they look.** pi only discovers a top-level `.ts` or
    `.js` file, or a directory with `pi.extensions`, `index.ts`, or `index.js`. `.mjs`, `.cjs`,
    `.tsx`, and a bare `package.json` without `pi.extensions` are ignored. The listing now mirrors
    that; a `.mjs` bridge only loads through an explicit `--extension`.
44. **Exact markers are enough for switches.** pi's pattern engine also accepts globs and applies
    `!`, then `+`, then `-`; the UI writes absolute exact paths, so the listing only evaluates exact
    matches and leaves glob interpretation to pi.

## 3. Things that saved time

- Reading the SDK `.d.ts` files before writing code. `node_modules/@getpaseo/plugin/dist/server/provider.d.ts`
  and `.../client.d.ts` define the contract precisely; guessing from other plugins costs more.
- Reading `paseo-omp` first. It answers "what does a full management surface look like on this
  platform", including launch settings, revisions, and write-only secrets.
- Reading pi's own docs under `/handoff/Port/pi/packages/coding-agent/docs`: `rpc-commands.md` for
  every command payload, `json.md` for event names and fields, `settings.md` and
  `models-configuration.md` for file shapes.
- Building one thin probe (`scripts/smoke-rpc.ts`) before any UI. It catches arg-order and framing
  mistakes in seconds.
- Keeping a throwaway daemon (`paseo daemon start --home .paseo-dev`) and reloading the plugin
  instead of restarting anything.
- The `assert pattern in text` before writing edits, then reading the file back. One
  `str.replace` silently no-op'd during this build and the thinking-`off` bug survived an edit that
  looked successful.
- Testing with a fake pi (`tests/fixtures/fake-pi.mjs`) for framing and timeouts, and with the real
  pi only for protocol semantics.

## 4. Dead ends, deliberate omissions, unused code

- **No reload request in pi's RPC protocol.** The command only exists as an extension command;
  the plugin bridges it with a generated extension. The Sessions tab still refreshes the file list.
- **No per-session MCP servers, tool policies, permissions, modes, or structured output.** pi
  configures MCP in `mcp.json`; the provider rejects per-session MCP and tool policies and reports
  unsupported `outputSchema`.
- **No session archive/revert/subsession/timeline-plugin capabilities.** The built-in provider
  covers some of this; this plugin stays on the management surface.
- **No per-package enable/disable.** pi has no plugin enable flag; remove the package or filter its
  resources in `settings.json`. Built-in extensions can be toggled.
- **No role-model settings like omp's.** pi selects one model per session; `enabledModels` and
  `defaultModel` are the equivalents.
- **`git:` and `http(s)://` packages are not scanned for skills.** No local directory is known
  without a checkout; `npm:`, `~/`, absolute, and `./` sources are.
- **`client/pi-screen.tsx` is unused.** It is an early status-only prototype; the live screen is
  `client/manage/screen.tsx`. Left in place rather than deleted without asking.
- **`docs/decision.md` is retired** but not deleted.
- **The plugin cannot suppress Paseo's built-in `pi` provider.** Both appear in provider lists.

## 5. Upstream references

| Reference | Revision / version | What was taken from it |
|---|---|---|
| `/handoff/Port/paseo-plugins` (monorepo root) | `01ba4209e099c0f27a5b85ca6a911def76bc0b2a` | Layout, release process, sibling plugins. |
| `paseo-plugins/paseo-omp` | 3.0.0 at the same commit | Full management-surface blueprint (plugin manager, settings, sessions popover, launch settings, parity map). |
| `paseo-omp/index.client.tsx`, `client/omp-config-surface.tsx`, `client/omp-config-views.ts` | same | Screen ids, tab structure, command-center items. |
| `paseo-omp/client/omp-plugin-manager.tsx`, `shared/omp-plugins.ts`, `server/omp-plugins.ts` | same | Install/enable/disable/upgrade/uninstall RPC shapes and write-only secrets. |
| `paseo-omp/shared/omp-settings.ts`, `server/omp-settings.ts` | same | Revision-conflict settings editing. |
| `paseo-omp/shared/provider-launch-settings.ts` | same | Host-scope launch settings with `inheritEnv`. |
| `paseo-omp/shared/sessions.ts`, `client/sessions-popover.tsx` | same | Read-only session history scoping. |
| `@getpaseo/plugin` 0.12.0 — `dist/server/provider.d.ts` | 0.12.0 | `PROVIDER_PROTOCOL_VERSION`, capability list, `ProviderInput`/`ProviderEvent`, `ProviderSessionConfig`, persistence shape. |
| `@getpaseo/plugin` 0.12.0 — `dist/client.d.ts`, `dist/client/ui.d.ts` | 0.12.0 | `PluginClientContext`, `useRpc`, `useSettings`, settings-screen primitives, sidebar/command-center APIs. |
| `@getpaseo/server` — `dist/server/server/agent/providers/pi/` | 0.12.0 | How Paseo's built-in pi provider works (agent loop, CLI runtime, history mapping, rewind, usage polling, extension host). |
| `/handoff/Port/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts`, `src/core/agent-session.ts`, `src/core/extensions/types.ts` | `5c1736f` | The command dispatch list, `commandContextActions.reload`, `AgentSession.reload()` and the extension command context. |
| `agegr/pi-web` @ `/tmp/pi-web` | `7c0778a` | Precedent for the same reload path over the agent session (`hooks/useAgentSession.ts`, `case "reload"`). |
| `/handoff/Port/pi/packages/coding-agent/docs/rpc.md` | `5c1736f` | RPC mode overview, lifecycle, minimal client, anchors to the command docs. |
| `.../docs/rpc-commands.md` | `5c1736f` | Every command payload: `prompt`, `steer`, `abort`, `get_state`, `get_messages`, `set_model`, `get_available_models`, `set_thinking_level`, `get_available_thinking_levels`, `get_session_stats`, `get_commands`, session commands. |
| `.../docs/json.md` | `5c1736f` | Event names and fields (`agent_start`, `agent_settled`, `message_start/end`, `tool_execution_*`, `compaction_*`, `auto_retry_*`, `session_info_changed`, `thinking_level_changed`), LF framing. |
| `.../docs/settings.md`, `.../docs/models-configuration.md`, `.../docs/custom-provider.md`, `.../docs/providers.md` | `5c1736f` | `settings.json` keys, `models.json` provider/model fields, API key and env-var conventions. |
| `.../docs/packages.md`, `.../docs/extensions.md`, `.../docs/skills.md`, `.../docs/mcp.md` | `5c1736f` | Package source syntax, extension paths and built-in toggles, skill layout, MCP file location. |
| `.../docs/message-types.md`, `.../docs/session-format.md` | `5c1736f` | Wire message blocks and session JSONL records used by `timeline.ts` and `sessions.ts`. |
| `.../docs/configuration.md`, `.../docs/environment-variables.md` | `5c1736f` | Agent dir and env-var resolution. |
