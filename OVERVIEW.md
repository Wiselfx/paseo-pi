# Overview

`@wiselfx/paseo-pi` is the management surface for the [pi coding agent](https://github.com/badlogic/pi-mono)
inside Paseo. Paseo's built-in `pi` provider owns sessions; this plugin edits pi's files and adds
the screens and RPCs around them. It does **not** register a second provider.

## Built-in pi

`index.server.ts` keeps the launch settings, management RPCs, and one small bridge:

- When **Reload command** is on (the default), the plugin writes a generated pi extension to
  `~/.pi/agent/extensions/paseo-pi-reload.ts`. Built-in pi sessions discover it on start, so
  `/reload` reaches pi's own reload action over RPC. Turning the setting off removes only that
  generated file; a user file with the same name is never overwritten or deleted.
- The extension appears under **Extensions & skills** as **paseo-pi reload** and can be switched
  off with pi's normal `-path` marker.
- `client/reload-pill.tsx` adds the **Reload** composer pill to built-in `pi` agents and to
  legacy `pi-plugin` agents. It sends `/reload`.
- No `pi-plugin` provider is registered. Existing agents from older versions can still be
  archived; new sessions use Paseo's built-in `pi` provider.

`server/provider/` still contains the old provider bridge and its tests. The parts used by
management (`rpc.ts`, `options.ts`, `models.ts`, timeline helpers) remain; the session bridge is
not registered.

`server/pi-status.ts` reports availability, version, and the model catalog through a short-lived
RPC child. `server/sessions.ts` resolves and lists session files.

`server/profiles.ts` adds named agent directories without registering another provider. Each
profile is a Paseo provider override (`{ extends: "pi", env: { PI_CODING_AGENT_DIR } }`) and a
directory under `~/.pi/profiles/<name>/agent` unless the user picks another absolute path.
Creating a profile also installs the generated reload extension there. Removing a profile
unregisters the override and never deletes the directory. The active profile is stored in
`piSettings.managedProfile`, so every management RPC edits that profile's files. The generated
reload extension is kept in sync for the default directory and every profile directory.

`server/project.ts` reads and writes `<project>/.pi/settings.json` and
`<project>/.pi/APPEND_SYSTEM.md`. It resolves the project root, refuses symlinked `.pi` files,
creates the directory with mode 0700, and uses the same revision checks as the user files.

## Management

`shared/management.ts` defines the RPC contracts. `server/management.ts` implements them:

- SHA-256 revisions guard read-modify-write operations; writes go to a mode-0600 temporary file and
  then rename, preserving unknown JSON keys.
- Provider/model edits are direct `models.json` mutations. API keys are never returned; a blank
  field preserves the existing key and an explicit empty value clears it. The raw editor masks
  secret-looking values as `__PI_SECRET__` and restores them on save.
- Package install/update/remove shells out to `pi install|update|remove`, so npm and git sources are
  reconciled exactly as the CLI does.
- Skills are parsed from YAML frontmatter, created under the agent directory, deleted with
  realpath containment, or installed from a GitHub file/repository link (`server/skill-source.ts`).
  User/agents skills can be read and edited as raw `SKILL.md`; package skills stay read-only.
  Each user/agents skill and every extension has its own switch, written as pi's exact `-path`
  marker rather than a whole-run `--no-extensions`/`--no-skills` flag.
- Models can be fetched from the provider itself (`server/model-source.ts`) and added in one
  revision-checked write.
- Package sources accept a pasted `pi install …` command (`shared/source.ts`).
- Session listing reads `.jsonl` headers; deletion realpaths the file, refuses anything outside the
  resolved session directory, deletes matching Paseo agents through the CLI, then unlinks. An
  agent matches by built-in pi `persistence.nativeHandle` or the legacy plugin metadata
  `sessionFile`.

`client/manage/` is the UI, split by tab. `client/manage/shared.tsx` holds theme-token primitives
(Paseo-style cards, rows, switches, fields, and buttons) shared by the management panel and the
`pi-launch` settings screen. `index.client.tsx` registers the sidebar item, the launch settings
screen, the management screen, command-center entries, and the reload pills.

## File map

```
index.server.ts          management RPCs + built-in reload extension sync
index.client.tsx         sidebar, screens, command center, reload pill
server/builtin-reload.ts installs/removes the generated extension
server/provider/         RPC/model/timeline helpers; legacy provider bridge
server/management.ts     settings/models/prompt/skills/sessions/package operations
server/profiles.ts       named agent directories and Paseo provider overrides
server/project.ts        project .pi settings and prompt
server/sessions.ts       session file discovery
server/skill-source.ts   GitHub skill lookup and install
server/model-source.ts   provider model-list fetch
server/pi-status.ts      availability and model probe
shared/management.ts     zod contracts and types
shared/settings.ts       launch settings schema
shared/source.ts         pasted package-source normaliser
client/manage/           management tabs
scripts/                 smoke tests
tests/                   unit tests
```
