# Overview

`@wiselfx/paseo-pi` has two halves: a provider that runs pi over RPC, and a management screen that
edits pi's own files.

## Provider

`index.server.ts` registers one provider:

- ID `pi-plugin`, label **Pi Plugin**, icon `server/provider/pi.svg`.
- Command resolution comes from the `pi-launch` settings, with `PI_CODING_AGENT_DIR` pinned for
  management commands.
- Each Paseo session gets one `pi --mode rpc` child. Session files are pi JSONL files; the
  `--session <file>` flag resumes them.
- Capabilities: prompt message/command/image/steer, session configure/list/persistence. Tool
  policy and permission forwarding are deliberately not advertised.

`server/provider/` contains the RPC process wrapper, model catalog probe, event-to-timeline
translation, and session persistence. `server/sessions.ts` resolves and lists session files.
`server/pi-status.ts` reports availability, version, and the model catalog.

## Management

`shared/management.ts` defines the RPC contracts. `server/management.ts` implements them:

- SHA-256 revisions guard read-modify-write operations; writes go to a mode-0600 temporary file and
  then rename, preserving unknown JSON keys.
- Provider/model edits are direct `models.json` mutations. API keys are never returned; a blank
  field preserves the existing key and an explicit empty value clears it. The raw editor masks
  secret-looking values as `__PI_SECRET__` and restores them on save.
- Package install/update/remove shells out to `pi install|update|remove`, so npm and git sources are
  reconciled exactly as the CLI does.
- Skills are parsed from YAML frontmatter, created under the agent directory, and deleted with
  realpath containment.
- Session listing reads `.jsonl` headers; deletion realpaths the file and refuses anything outside
  the resolved session directory.

`client/manage/` is the UI, split by tab. `client/manage/shared.tsx` holds theme-token primitives.
`index.client.tsx` registers the sidebar item, the `pi-launch` settings screen, the management
screen, command-center entries, and the provider icons.

## File map

```
index.server.ts          provider + RPC registration
index.client.tsx         sidebar, screens, command center
server/provider/         pi RPC child, catalog, timeline, persistence
server/management.ts     settings/models/prompt/skills/sessions/package operations
server/sessions.ts       session file discovery
server/pi-status.ts      availability and model probe
shared/management.ts     zod contracts and types
shared/settings.ts       launch settings schema
client/manage/           management tabs
scripts/                 smoke tests
tests/                   unit tests
```
