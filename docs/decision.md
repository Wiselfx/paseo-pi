# Decision memo: `paseo-pi` vs Paseo's built-in pi provider

Date: 2026-10-19. Scope: whether to keep building the plugin, stop, or ship a thin add-on.
No decision has been made and nothing has been committed or published.

## Verified starting point

- Paseo `0.12.0` ships a **built-in, enabled `pi` provider**. It is not a stub:
  - pi RPC (`--mode rpc`), the same 15-model catalog, streaming, reasoning stream, tool calls.
  - Session persistence, listing, import, and conversation rewind (`supportsRewindConversation`).
  - Per-session MCP injection, including pi's built-in MCP and a `pi-mcp-adapter` fallback.
  - Slash commands/skills through a Paseo-owned pi extension, plus usage polling and diagnostics.
  - It does **not** support file rewind (`supportsRewindFiles: false`).
- The built-in provider is configured only through daemon config (`providers.pi.command` /
  `providers.pi.env` in `config.json`, or `PI_COMMAND` / `PI_ACP_PI_COMMAND`). Paseo's provider
  settings screen exposes enabling, models, and diagnostics, but not the launch command or env.
- The built-in `omp` provider, by contrast, is disabled by default. That is why `paseo-omp`
  exists; the situation for pi is different.
- The plugin in `/handoff/Port/paseo-pi` is working against pi 1.1.0: catalog, open, model and
  thinking selection, prompt, stream, turn completion, persistence, resume-with-replay, session
  listing, and an end-to-end Paseo agent run. Typecheck and 27 unit tests pass.

## Options

### (a) Stop here, keep the built-in provider

- Remaining effort: none. Archive or delete the plugin.
- What it gives the user beyond built-in pi: **nothing**.
- Cost of competing upstream: zero.
- If built-in pi changes: nothing to maintain.
- Downside: the launch-configuration UX gap remains, and the work already done is not used.
  It can still serve as a reference or an upstream patch.

### (b) Continue as an enhanced pi provider

- Remaining effort: roughly 2-4 weeks to reach arguable parity with the built-in provider.
  Conversation rewind is 1-2 days; per-session MCP is 2-3 days; file rewind is 1-2 weeks and
  still risky; import through the plugin API is not available at all (see below).
- What it gives the user beyond built-in pi:
  - A launch/status screen inside Paseo, with per-agent command, args, env, and resource toggles.
  - A place to add file rewind if it can be built safely (built-in pi does not have it either).
  - Conversation rewind can be matched, not beaten.
  - MCP, session listing, import, slash commands, and usage are already owned by built-in pi, so
    matching them adds maintenance rather than value.
- Cost of competing upstream: high. The built-in provider ships with the daemon, is enabled by
  default, is updated with Paseo, and shares no test suite with a plugin. Every pi RPC or Paseo
  protocol change must be tracked twice, and fixes made upstream never reach the plugin.
- If built-in pi changes: any improvement to launch configuration, per-agent overrides, file
  rewind, or import erodes the remaining differentiators. A pi RPC change can break the plugin
  while the built-in provider is updated in the same release.

### (c) Keep a deliberately thin add-on

- Remaining effort: roughly 2-3 days to make it presentable and honest.
  - Add env key/value editing to the launch settings screen (currently only `inheritEnv` names).
  - Fix and test the settings screen revisions/error states; document precedence
    (Paseo launch > per-agent options > host settings).
  - README/OVERVIEW, install and removal steps, parity note against built-in pi.
  - Keep the dev harness and smoke scripts.
- What it gives the user beyond built-in pi: the only real gap left, a UI to choose the pi
  binary, arguments, session directory, inherited env, and resource toggles, plus per-agent
  provider options. Built-in pi requires editing `config.json` for the same result.
- Cost of competing upstream: low but non-zero. It must not claim to add features it does not
  have, and it must stay compatible with `@getpaseo/plugin` 0.12 and pi's RPC.
- If built-in pi changes: if Paseo adds a launch-config UI, the add-on loses most of its reason
  to exist. If per-agent launch overrides land upstream, it loses the rest. The plugin remains
  useful only as long as that gap is real.

## Cost of competing with a built-in provider (summary)

1. Distribution: built-in is already installed, trusted, enabled, and updated. A plugin needs an
   explicit install and a trust decision, and can be disabled by a daemon upgrade.
2. Surface area: built-in pi already covers MCP, import, rewind, slash commands, usage, and
   diagnostics. Matching those is duplicated work; beating them is unlikely.
3. Compatibility: the plugin tracks two moving interfaces (Paseo plugin protocol v1 and pi RPC),
   while the built-in provider tracks them in lockstep with the daemon.
4. Support: users will compare the two providers; differences that are really upstream fixes
   become plugin bugs. Naming (`pi` vs `pi-plugin`) adds confusion.
5. Upstream leverage: a small Paseo change (expose `providers.pi.command` in the provider
   settings UI) would deliver most of option (c)'s value without a plugin.

## What must be fixed regardless of the choice

These are the gaps named in the brief. "Regardless" here means "before any plugin can be called
complete"; under option (a) none of them need fixing.

| Item | Status | Effort | Feasible in a plugin? |
| --- | --- | --- | --- |
| Launch settings | Works: command, args, session dir, inherited env names, resource toggles; screen and status page exist | 0.5-1 day to add env key/value pairs and finish validation/docs | Yes |
| Session import | `session.list` and persistence work, but the plugin protocol has no import input; Paseo's import flow is not exposed to plugin providers | 0 in-plugin; needs an upstream API (or a fragile synthetic-session hack, 3-5 days) | No, not through v1 |
| Conversation rewind | Advertised by built-in pi, absent here; pi exposes `fork` and `get_entries` | 1-2 days | Yes |
| File rewind | Absent here **and** absent from built-in pi; pi has no file-snapshot API | 1-2 weeks, with real data-loss risk | Only with our own snapshot store |
| MCP | Currently rejected per session ("configure in pi itself"); built-in pi already injects per-session MCP | 2-3 days via a temporary pi extension or merged `mcp.json` with cleanup | Yes |
| Slash commands | Capability advertised; command prompts are now converted to `/name args` text. This was broken (empty-prompt rejection) and is fixed in this session, but not yet exercised against a real command | 1-2 days to verify and align with pi's command semantics | Yes |
| Packaging and docs | No README/OVERVIEW, no install/removal guide, no parity statement | 1 day | Yes |

Related, but not on the brief's list: per-agent tool policy, permission prompts (pi has none),
and archive/unarchive are deliberately unsupported.

## Verification performed in this session

- `NODE_OPTIONS= ./node_modules/.bin/tsc --noEmit` -> exit 0.
- `NODE_OPTIONS= ./node_modules/.bin/vitest run` -> 5 files, 27 tests passed.
- `bun scripts/smoke-rpc.ts` -> `OK rpc: Llama.cpp/Gemma-4-E4B, 15 models, 5 levels, 0 commands`.
- `bun scripts/smoke-session.ts` -> assistant `ready`; session file persisted.
- `bun scripts/smoke-resume.ts` -> replay of user+assistant, then a second turn `again`.
- `bun scripts/smoke-list.ts` -> newest session found in `/tmp/paseo-pi-smoke`.
- `bun scripts/smoke-paseo.ts` against the throwaway daemon -> catalog `pi-plugin`, 15 models;
  agent finished idle with a visible reply.
- Fixes made while verifying: `inheritEnv` from per-agent options was ignored; an RPC write
  failure left an orphaned pending request; command prompts were rejected as empty.

## Recommendation (for the owner to accept or reject)

Option (a) is the honest default: the built-in provider is a superset for almost every feature,
and the plugin's remaining niche is configuration UI. If the launch-configuration gap matters,
option (c) delivers it in days without pretending to compete. Option (b) only makes sense if the
owner specifically wants file rewind or a plugin-shaped place to experiment, and accepts that
upstream can erase the advantage at any release.

Open questions for the owner:

1. Is the launch-configuration UI worth a plugin, or should this become an upstream Paseo patch?
2. Is file rewind a real requirement, given built-in pi does not offer it either?
3. Would a diagnostic/experimental provider be acceptable even if it is not the default choice
   for daily use?
