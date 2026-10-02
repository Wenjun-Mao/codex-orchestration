# Versioned Evidence

Use these controls when consultation depends on a repository, dataset,
document set, build artifact, or other mutable evidence source.

## Bind The Evidence

Provide both:

- a **discovery locator** that lets the consultant find the material; and
- an **immutable evidence anchor** that identifies the exact version reviewed.

For Git, this normally means repository URL, branch or ref, and full commit
SHA. Confirm the remote ref resolves to that commit before dispatch. Ask the
consultant to state the commit actually inspected. If it is inaccessible, the
consultant should report the limitation and use only the supplied packet rather
than silently substituting another branch or mutable state.

For non-Git evidence, use the corresponding stable identity: dataset version,
document revision, release ID, artifact digest, or another source-owned
immutable identifier. Add extra hashes only when artifact identity materially
affects the inquiry.

## State Access Boundaries

For GitHub-only review, perform a publication check before handoff:

- Include all required review documents and safe supporting evidence, not only
  product source. Replace local-only links with accessible GitHub permalinks;
  relative links must resolve within the published tree.
- Verify the exact source commit and packet revision are remotely readable using
  the consultant's access level. For public-only access, check without our
  credentials; our authenticated access does not prove private-repo access for
  the consultant. State any unverified access limitation.
- If source and packet use different commits, identify both. Do not assume
  `main` contains the review branch or that an unpushed commit is accessible.
- Publish only with authorization and exclude secrets/private runtime data.
  A review branch can provide access without a release merge. If required
  material cannot be shared, narrow the assignment explicitly or keep it draft;
  do not silently replace source inspection with a local summary.

- List relevant inputs that are not available to the consultant, including
  ignored, proprietary, generated, machine-local, account-bound, or unpushed
  material.
- Summarize only the bounded facts needed from unavailable inputs. Do not invite
  the consultant to infer their contents.
- Repository or data access supplements the self-contained packet; it does not
  replace it.
- Never include credentials, secrets, private user data, or confidential source
  without explicit authorization for that disclosure and destination.

When an assignment uses multiple revisions or evidence sets, list each one with
its own locator, immutable anchor, relevant paths, and authority. Do not present
them as one composite state or imply supersession unless that relationship is
itself established.
