# Director-owned native disposable journey

Status: director-owned canary started and paused after coordinator READY and commit
`2a5420f`, before executor creation. Resume only after the director stages the
corrected exact candidate. This journey remains the native proof and startup
measurement; do not run a separate feasibility probe.

## Prerequisites and owners

The director task `01a04b13-a1ef-7731-a63b-819b7f8cb150` owns dispatch, acceptance,
the disposable repository, saved-project selection, coordinator creation, final
coordinator receipt, child-first archive ordering, and successor creation. The
implementation coordinator must not create this canary.

Before dispatch the director must provide:

- one new disposable Git repository on `main`, with a clean baseline, no
  `codex-flow` state, and a small `product/` file plus a read-only focused check;
- an existing saved Codex project whose local environment is that retained checkout;
- explicit coordinator, executor, and successor model/effort choices;
- the exact enabled Relay package commit and reviewed/trusted Stop-hook definition.

The coordinator owns local product work, executor creation from Relay's generated
action, executor-result verification, exact executor receipt, and executor archive
reconciliation. The executor owns only its recorded source generation and genuine
final. The successor receives new source permission from the director. No actor may
archive a task whose remaining report/archive duties require that task.

## One connected run

1. Director writes the coordinator spec with the saved project ID, director task
   and host as recipient, approved scope `product/`, focused argv check, and selected
   coordinator model/effort. Record wall time and plugin-visible bytes/tokens from
   before `prepare` through READY; count prepare, native creation, result binding,
   and start separately.
2. Director runs `relay prepare`, invokes its exact `create_thread` action once,
   then gives `record-native-result` the unmodified tool result. Provisional output
   permits no writes and is observed rather than recreated. The coordinator runs
   the generated start command; READY must require no implementation reads or
   handwritten protocol JSON.
3. Coordinator makes and commits one useful in-scope local edit. It prepares a
   narrower executor spec with the selected executor model/effort, calls `handoff`,
   invokes that exact task action once, and records its unmodified result. The
   coordinator performs no source writes during executor ownership.
4. Executor starts, makes and commits one useful in-scope edit, then calls `finish`.
   Ownership must transfer directly to the exact coordinator verification
   reservation. Executor emits its genuine final; the trusted Stop hook must capture
   the exact native thread, completed turn, and bytes after the result is sealed.
5. Coordinator waits for executor completion using the generated
   `prepare-receipt` action and records the unmodified `wait_threads` result. Exact
   receipt must match the hook capture. Coordinator reviews and verifies the exact
   revision, choosing finish. Queue acknowledgement, if the optional message path
   is exercised, remains separate and is not receipt.
6. Coordinator prepares executor retirement once, invokes the exact
   `set_thread_archived` action, then uses `list_archived_threads` for affirmative
   observation if the background result is not itself affirmative. Ambiguity causes
   observation, never a repeated archive. The retained checkout and refs must remain.
7. Coordinator emits its genuine final. Director records exact receipt through the
   same Stop-capture plus `wait_threads` comparison, independently accepts the
   result, and archives the coordinator only after all child duties are affirmatively
   complete. Replay `retire` and show that no second native archive action appears.
8. Director prepares and creates the useful successor with its selected model/effort.
   The successor starts at the accepted revision, commits one useful in-scope edit,
   finishes, reports, and is archived without replaying historical HEAD or deleting
   source. Pending unrelated reporting must not block its source admission.

Capture task IDs/hosts, assignment IDs/generations, commit revisions, every exact
native action/result, hook event task/turn/digest, wait cursor and matched bytes,
receipt/decision, archive action ID and affirmative observation, checkout/ref state,
and per-stage elapsed time. Report local protocol time separately from native
provisioning/model latency. The provisional 6,000 plugin-visible-token ceiling and
three ordinary startup protocol calls remain targets until this fresh run measures
them. Do not claim source fixtures or repaired attempts as uninterrupted native proof.
