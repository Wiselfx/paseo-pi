# TODO: make paseo-pi management-only

Status: planned, not started. Written 2026-10-20.

## Decision

`paseo-pi` should provide the missing management surface and `/reload`, not a second pi
provider. Paseo already ships a built-in `pi` provider that runs pi sessions. The plugin's own
provider (`pi-plugin`) is redundant unless it is the only way to make `/reload` work in a running
chat.

Do not remove any management capability while changing this.

## Must keep working

These are provider-independent today and must survive the change:

- Packages: install (including pasted `pi install …`), update one, update all, remove.
- Extensions: add path, remove, per-extension switch, per-built-in switch.
- Skills: install from a GitHub link, create manually, remove, per-skill switch.
- Providers and models: add/edit/delete a provider, add/edit/delete a model, fetch a provider's
  model list and choose models, raw `models.json` editor with `__PI_SECRET__` masking.
- Prompt: read/write `APPEND_SYSTEM.md` and `SYSTEM.md`, reload, clear.
- Sessions: list/filter by cwd and query, reload, delete the JSONL and the matching Paseo agent.
- Settings: common fields, raw `settings.json`, revision checks.
- Launch settings: command, args, inherited env, session directory, read-context-files,
  use-MCP-servers, reload-command, expose-models.
- `/reload` in a running pi chat, plus the Reload composer pill.
- The management UI and command-center entries.

## What actually depends on the provider

The management RPCs edit files or call pi directly; they do not use `pi-plugin`. The only
provider-specific pieces are:

- Registering `pi-plugin` as a Paseo provider (`server/provider/registration.ts`,
  `index.server.ts`).
- Running pi sessions through this plugin and their persistence/timeline bridge.
- The Reload composer pill (`client/reload-pill.tsx`) filters on `PI_PROVIDER_ID`, so it only
  appears on `pi-plugin` agents.
- The generated reload extension (`server/provider/reload-extension.ts`) is passed to sessions
  started by our provider with `--extension`.

Paseo's built-in `pi` sessions do not load that generated extension today.

## Plan

### 1. Prove `/reload` on the built-in pi provider

- Materialize the command extension from `server/provider/reload-extension.ts`. It is a tiny
  pi extension that registers `/reload` and calls `ctx.reload()`.
- Put it where built-in pi sessions load extensions. Likely choices:
  - add its absolute path to pi's `settings.extensions`; or
  - install it under the agent directory's normal extension path.
  Use a throwaway `PI_CODING_AGENT_DIR` first. Do not leave the real
  `~/.pi/agent/settings.json` changed.
- Start an agent on the built-in `pi` provider and check:
  - the `/reload` command is listed and accepted;
  - sending `/reload` over RPC actually reloads (create a skill after the session opens, then
    reload and verify it is loaded);
  - the command list refreshes or the session must be restarted;
  - there is no collision with a native `/reload`.
- Update `client/reload-pill.tsx` to also serve agents whose provider is `pi` (exact id, and
  possibly `pi/…` variants). Keep `pi-plugin` support until migration is finished.
- Keep the pill disabled while the agent is running, as it is now.

### 2. If the built-in path works

- Stop registering `pi-plugin` in `index.server.ts`. Keep every management RPC and client
  contribution.
- Keep or remove `server/provider/*` only after checking which pieces the management RPCs,
  scripts, and tests still use. Management sessions read JSONL; they do not need the provider.
- Update `paseo-plugin.json`/docs/README/OVERVIEW and remove claims that the plugin is a
  provider.
- Archive existing `pi-plugin` agents rather than deleting sessions. New agents use built-in pi.
- Update tests/smokes that assume `PI_PROVIDER_ID` or `pi-plugin`.
- Acceptance: no duplicate provider in Paseo, all management flows pass, and `/reload` works on
  a built-in pi agent.

### 3. If the built-in path does not work

Pick one, explicitly:

- Keep `pi-plugin` but make it opt-in and default off (a launch setting), with the management
  surface fully usable without it; or
- Drop the in-chat pill and expose reload only from the management panel; or
- Keep the provider as the only way to get in-chat `/reload`, and document that exception.

Do not silently keep a duplicate default provider.

## Relevant code

- `index.server.ts` — provider registration and management RPC wiring.
- `server/provider/registration.ts` — `pi-plugin` registration/status.
- `server/provider/reload-extension.ts` — generated `/reload` extension.
- `server/provider/options.ts` — where `--extension` is added for sessions.
- `server/sessions.ts` — file-based session listing used by the management tab.
- `client/reload-pill.tsx` — composer pill and agent filtering.
- `client/manage/*` — management UI; independent of the provider.
- `shared/constants.ts` — `PI_PROVIDER_ID`.

## Verification

- `NODE_OPTIONS= ./node_modules/.bin/tsc --noEmit`
- `NODE_OPTIONS= ./node_modules/.bin/vitest run`
- Smokes with `PI_COMMAND=/root/.pi/agent/bin/pi`: `smoke-rpc`, `smoke-session`,
  `smoke-resume`, `smoke-list`, `smoke-reload`, `smoke-toggles`.
- `NODE_OPTIONS= PASEO_URL=ws://127.0.0.1:37465/ws … bun scripts/smoke-paseo.ts`.
- Live browser check: management tabs still load, Reload pill appears on a built-in pi agent,
  `/reload` reloads a newly added skill, and no second provider appears in Paseo.

## Separate work

The Paseo-aligned UI polish (cards, rows, switches, responsive tabs, launch settings) is
presentation-only and did not remove RPCs. Keep it in its own commit, separate from the
provider/architecture change, so a regression can be reverted independently.
