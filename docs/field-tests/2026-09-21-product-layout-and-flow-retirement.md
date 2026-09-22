# Product layout and Flow retirement

## Scope

Codex Orchestration is the umbrella repository. Relay remains in `plugins/relay`;
retired Flow moves from the root to `plugins/flow`. Product-specific plans and
field notes follow their product; shared decisions and known issues remain in
root `docs`. No shared runtime or workspace framework was added.

Flow's legacy identifier is unchanged. No new Flow release is being made, and
historical release tags still reproduce their original root layout. The local
0.7.5 tarball was moved, not deleted, to ignored `plugins/flow/artifacts/`.

## Installed plugins

- Relay instruction correction committed in `069aa48`: serial retained-checkout
  default where authorized; workers never delete their own checkout; managers
  handle cleanup after final delivery and idle observation.
- Managed Relay installation: `0.4.0+codex.20260922020320`. Installed direct/deliver
  skills match the source exactly. Runtime behavior is unchanged.
- Removed `codex-orchestration@personal` and
  `hook-final-delivery-trial@hook_trial_20260905`. Fresh native plugin inventory
  shows only Relay installed among these three plugins.
- Source marketplace folders, Git history and other projects' historical Flow
  records were not deleted. The stale ADE run record was not treated as evidence
  of a running task; its native task's latest turn was completed.
- Restart the App to discard already-loaded obsolete hooks/instructions.

## Verification

- Relay source tests: 9/9; relocated package tests: 9/9; 16-file package boundary.
- Root `npm test` delegates to Relay and passes 9/9.
- Flow source validation: 33 schemas, 49 classified modules; package dry-run passed.
  This is not an identity claim for a new immutable 0.9.13 release.
- 107 Flow runtime/schema/skill/template/hook files match their pre-move bytes.
- Four historical-archive tests initially failed because `git archive` inherited
  the newly nested package directory. Historical tags have root-level products;
  those test calls now explicitly use the Git root. All four passed on focused
  rerun. The same path correction applies to refresh archive fixtures.
- The broad Flow run completed with these four failures; it was not repeated
  from scratch after the corrections. Its remaining tests passed, including the
  refresh fixture tests loaded after the path correction.
- No installed cache was hand-edited; no other project's application source or
  historical orchestration state was changed.
