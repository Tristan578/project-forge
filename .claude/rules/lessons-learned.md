# Lessons Learned — anti-patterns from real bugs in this repo

Every entry here cost something: a production outage, a red pipeline, or a
session spent rediscovering it. `.claude/hooks/inject-lessons-learned.sh` reads
this file and injects matching entries before any Edit, Write, or mutating Bash
call, so the format below is load-bearing.

## Why this file lives in the repo

It used to live at
`$HOME/.claude/projects/-Users-tristannolan-project-forge/memory/project_lessons_learned.md`
— a user-level absolute path containing one machine's username. On any other
machine it resolved to nothing, the hook took its `exit 0` branch, and
enforcement was silently off. Sixteen files referenced it; eight subagents were
instructed to read it as MANDATORY. The content was never in version control and
is unrecoverable (#9605).

Knowledge that gates a hook belongs where the hook is: in the repo, reviewed in
PRs, portable across machines and contributors.

## Format

    ### N. Short title
    **Applies:** substring|substring   <- optional, see below
    **What happens:** the observable failure
    **Why:** the mechanism
    **Prevention:** what to do instead
    **Ticket:** #NNNN

`**Applies:**` is an explicit, case-insensitive **substring** list matched
against the target — the file path for Edit/Write, or the whole command for
Bash. Substrings, deliberately not regexes: a typo'd regex aborts the awk pass
and the hook injects nothing, which is the one failure mode it must never have.
Annotated lessons are emitted first. Un-annotated lessons still match on prose
keywords, so a new entry works with no edit to the hook.

---

### 1. A gate that checks the wrong property passes while the artifact is broken
**Applies:** health|monitoring|check-|gate|/api/health|post-deploy
**What happens:** Every check is green and the feature is dead. This is the most
expensive class in this repo's history — it produced four separate production
failures in one day.
**Why:** The check asserts something adjacent to the property that actually
matters. Concretely, all four times:
- `/api/health` probed the CDN **host**, which is always up, instead of the
  versioned prefix the deploy had just stamped. Engine 404'd; check said "up".
- The replacement gate asserted **HTTP 200** on a real asset. The asset returned
  200 with **no `Content-Type`**, so the browser refused the module. Green again.
- The alias parity check compared **object counts** without anyone listing the
  bucket, so 8 stale `.d.ts` objects made parity unsatisfiable and blocked every
  deploy.
- The E2E gate **selected** `@ui` then grep-inverted `@dev`, excluding the specs
  by the same expression that chose them. 91 of 422 tests ran; the job read as an
  application gate.
**Prevention:** Name the property a user depends on, then assert *that*. "Does
the host respond" is not "does this deploy's asset load". Ask what a passing
check would still permit, and close that gap. Where the artifact is reachable,
verify the artifact in place rather than the pipeline's opinion of it.
**Ticket:** #9581, #9593, #9599, #9586

### 2. `aws s3 cp --recursive` over a missing prefix exits 0 having copied nothing
**Applies:** aws s3|s3 cp|s3 sync|alias-wasm|upload-wasm|r2
**What happens:** A deploy step succeeds and the bucket is empty.
**Why:** The CLI treats "no source objects" as success, so the exit code carries
no information about whether anything moved.
**Prevention:** Assert the source is non-empty before, and the destination after.
Exit status is not evidence of transfer.
**Ticket:** #9581

### 3. `--metadata-directive REPLACE` discards every header you do not restate
**Applies:** metadata-directive|cache-control|content-type|aws s3|alias-wasm
**What happens:** Objects copy successfully and the browser refuses them. A
module script served without a JavaScript MIME type is blocked outright;
`WebAssembly.instantiateStreaming` requires `application/wasm` and otherwise
buffers the whole module.
**Why:** REPLACE is all-or-nothing. Restating only `--cache-control` drops
`Content-Type` silently.
**Prevention:** Copy per content-type group and restate the type for each. Then
compare source and destination counts so a file type no group covers fails the
deploy instead of vanishing.
**Ticket:** #9593, #9599

### 4. An `if:` without `always()` cascade-skips when a dependency is SKIPPED
**Applies:** .github/workflows|ci.yml|cd.yml|quality-gates|needs.|always()
**What happens:** A job silently stops running and every job in the run is green.
**Why:** GitHub prepends an implicit `success()` to any `if:` lacking
`always()`, and a **skipped** dependency fails that check exactly like a failed
one. Adding `always()` then *removes* that implicit lock, so every dependency
must be gated explicitly or the guard is simply gone.
**Prevention:** When you make a job skippable, walk every job listing it in
`needs:`. Adding `always()` is half the fix; restating each dependency's
`.result` is the other half. Accept `'skipped'` only alongside proof the work
was genuinely unnecessary.
**Ticket:** #9581, #9578

### 5. Shell heredocs corrupt backslashes and the file still passes tests
**Applies:** heredoc|<<'|cat >|python - <<|perl -|sed -i|\\b|regex
**What happens:** The written file differs from what you wrote, in ways invisible
in normal output. Observed three times in one session:
- `\b` in a Python heredoc became a literal **backspace byte (0x08)** inside a
  regex, so a MIME check matched nothing and silently accepted everything.
- Backslash line continuations were stripped, collapsing a multi-line command
  onto one line. Valid shell, so nothing failed.
- `\\` + newline collapsed, so a byte-exact anti-tamper pin stopped matching.
**Why:** The content passes through shell quoting, then the interpreter's own
escape handling. Each layer eats backslashes.
**Prevention:** **Author backslash-bearing content with Write/Edit, never a
heredoc.** If you must use a heredoc, read the bytes back (`cat -A`) before
trusting it. `scripts/check-source-encoding.sh` catches control bytes in CI, but
that is hours later than the write.
**Ticket:** #9595

### 6. Verify the tree you are about to push, not the one you tested
**Applies:** git push|git commit|--force-with-lease|git rebase
**What happens:** CI fails on something that passed locally minutes earlier.
**Why:** A fix left uncommitted still sits in the working tree, so the local run
uses it and the pushed commit does not. Verified one artifact, shipped another.
**Prevention:** `git status --porcelain` must be **empty** immediately before
pushing. Treat a non-empty tree at push time as a blocking error.
**Ticket:** #9577

### 7. Resolving a conflict by keeping both sides duplicates scalar assignments
**Applies:** rebase|conflict|<<<<<<<|readonly |SELF_EXEC_EXPECTED_DROP
**What happens:** A `readonly NAME=` is declared twice on adjacent lines; the pin
it guards silently reads the wrong value.
**Why:** Keeping both sides is correct for a **list append**, where each side
contributes distinct entries. For a scalar both sides define the same name.
**Prevention:** After any mechanical conflict resolution, grep the changed files
for a `readonly` name declared more than once. Never assume the resolver knew
which kind of hunk it had.
**Ticket:** #9577, #9598

### 8. A measurement taken in a contaminated tree does not transfer to CI
**Applies:** playwright|vitest|e2e|measure|baseline|benchmark
**What happens:** You report a pass rate, CI reports a different one, and the
delta is your own leftover state.
**Why:** Artifacts fetched or built while investigating stay on disk. A local run
with `web/public/engine-pkg-webgl2/` present measured 375 passing; CI has no
engine there, so the number was wrong and one canvas spec went untagged.
**Prevention:** Before taking a number you intend to report, list what is in the
tree that CI will not have — including gitignored and untracked paths. State the
environment delta alongside the measurement, or clean the tree first.
**Ticket:** #9586

### 9. A test that skips its key assertion still reports success
**Applies:** test|skip|__tests__|.test.sh|.test.ts
**What happens:** "All tests passed" in front of a dead mechanism.
**Why:** A `skip` for a missing fixture reads as "not applicable" when it
actually means "the thing under test is not installed". The lessons hook's own
suite skipped its real-file sweep and printed success while enforcement had been
off for the entire session.
**Prevention:** A skip is only legitimate when the scenario genuinely does not
apply. If the skip condition means the feature is broken or absent, **fail**.
Every structural check should also fail when it matches nothing — a gate that
scans zero items passes vacuously and reads as coverage.
**Ticket:** #9605

### 10. Do not report readiness without evidence, or open a PR you expect to be red
**Applies:** gh pr create|gh pr ready|ready for review|merge
**What happens:** Someone else spends attention discovering what you already
suspected.
**Why:** "I could not verify this locally, so CI will tell us" is a reasonable
plan and a bad thing to put behind a review-ready label. It transfers your
uncertainty to the reviewer without their consent.
**Prevention:** State the evidence for each claim, or mark the PR **draft** and
say what is unverified. If you predicted a failure mode, do not describe the
work as ready until that prediction is tested.
**Ticket:** #9604
