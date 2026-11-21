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

### 11. An assertion that cannot fail is worse than no test at all
**Applies:** expect(|toBeDefined|assert|.spec.ts|.test.ts|a11y|accessibility
**What happens:** A named check sits in the suite, runs on every PR, reports
green, and is incapable of reporting anything else. It is counted as coverage by
everyone reading the board.
**Why:** Two independent ways to write one, both found in a single accessibility
test:
- **The assertion is trivially true.** `expect(hasFocusStyle).toBeDefined()`
  where `hasFocusStyle` is a locally computed boolean. `false` is defined, so the
  check passes no matter what the page rendered.
- **The predicate is trivially true.** `styles.outline !== 'none'` looks like a
  real comparison, but computed `outline` is a triple such as
  `"rgb(0, 0, 0) none 0px"` — never the bare string `none` — so the clause is
  always true regardless of the element.

Rewriting that one test to assert what it claimed immediately found a real
WCAG 2.4.7 defect: Dockview ships `.dv-tab { outline: none }` at the same
specificity as the app's global `:focus-visible` rule and loads after it, so
every editor panel tab was keyboard-reachable with no visible focus indicator.
The vacuous test had been reporting that as fine.
**Prevention:** Before trusting a green test, ask what value would make it fail
and confirm that value is reachable. Assert on *content*, not existence. When a
check walks a collection, assert the walk was non-empty — otherwise zero items
inspected reads as zero problems found. Deliberate reporting-only checks are
fine, but say so at the call site so the next reader does not count them as
gates.
**Also:** measure with the right modality. A first probe using `el.focus()`
reported missing focus rings on controls that were fine, because Chromium does
not apply `:focus-visible` to programmatic focus following a pointer event.
Driving real `Tab` presses is what made the result trustworthy — a wrong
measurement would have sent a fix at healthy code.
**Ticket:** #9604

### 12. A bot-comment sweep taken before a branch update is stale by the time you report it
**Applies:** gh pr update-branch|update-branch|gh api graphql|reviewThreads|isResolved
**What happens:** You sweep a PR's review threads, find them all resolved, run
`gh pr update-branch` to satisfy the strict-status-check policy, and report the
PR as merge-ready. A reviewer comment posted in between is missed entirely —
reported live on #9601, where a Sentry (Seer) thread landed at 21:30:09Z and the
sweep that declared "0 unresolved threads" had run before it.
**Why:** The branch update pushes a new head commit, and every bot reviewer is
triggered by exactly that. So the update is not a neutral rebase — it is the
event that generates the comments the sweep was checking for. Ordering the two
that way guarantees the sweep can never see the reviewers it just woke up.
**Prevention:** The bot-comment sweep is the LAST step before reporting, after
every push and every `update-branch`, not a box ticked earlier in the sequence.
On this repo the two are coupled by the ruleset (`strict_required_status_checks_policy`
means each merge invalidates the next PR, so every PR gets an update-branch), so
"CI is green" and "comments are clear" must both be re-established against the
SAME head SHA. Quote that SHA when reporting merge-readiness — it is what makes
the claim checkable, and it is what makes a stale sweep visible instead of silent.
**Ticket:** #9196

### 13. A comparison gate whose reference state is never written compares against nothing
**Applies:** chromatic|baseline|snapshot|visual regression|quality-gates.yml|workflow_call|UI Tests|golden|approve
**What happens:** A diffing check reports the SAME result on every PR forever —
here, `UI Tests | 92 visual and accessibility changes must be accepted as
baselines`, where 92 is 100% of published stories and the count was byte-identical
across three unrelated heads. Everyone learns to read the amber as background
noise, so the one PR that genuinely breaks the UI looks exactly like the four
dev-only dependency bumps that cannot possibly change rendering.
**Why:** The gate ran only on the comparison side. `quality-gates.yml`'s
`chromatic` job is `workflow_call` only; its callers are `ci.yml`
(`pull_request`) and `cd.yml`, and `cd.yml` deliberately skips quality-gates on
push to main. So no build was ever produced on `main`, the branch every PR build
diffs against. Baselines were written solely by a manual `workflow_dispatch`.
This is lesson #1's family with a different mechanism: not "asserts the wrong
property" but "has no reference to assert against", and it fails OPEN and
permanently rather than once.
**Prevention:** A diff-based gate has TWO halves and they live on different
triggers. Whenever you add or review one — visual snapshots, coverage ratchets,
bundle-size budgets, golden files, perf baselines — find the job that writes the
reference on the trunk and confirm it actually runs there. If the only writer is
a manual dispatch, there is no baseline. The tell is cheap and specific: **the
same non-zero count on two unrelated commits**, and no status of that name on any
recent trunk commit (`gh api repos/{owner}/{repo}/commits/<sha>/status`). Also
keep the two halves' settings distinct on purpose — TurboSnap/`onlyChanged` is
right for the PR side and wrong for the baseline, because a partial reference
reproduces the bug on the next unrelated PR.
**Ticket:** #9621

### 14. A mocked transport test pins whatever contract you believed, right or wrong
**Applies:** upstash|rateLimit/distributed|healthChecks|responseCache
**What happens:** A unit test asserts the exact URL and body the code sends,
passes for four months, and the provider has been refusing every one of those
requests with 400 the whole time. Here: `distributedRateLimit` posted its Lua
script to `POST <base>/eval` with the arguments as the body. Upstash appends a
POST body to a path-form command as ONE trailing argument, so the script arrived
with no `numkeys`. The catch degraded to the SDK limiter, so nothing failed —
the only trace was a sampled Sentry event (`SPAWNFORGE-AI-B`) that read
"400 Bad Request" and nothing else, and `/api/health` reported the rate limiter
healthy because two environment variables existed.
**Why:** A mock cannot disagree with you. `mockFetch` proves what the code
sends, never what the provider accepts, and it pins a wrong contract with the
same confidence as a right one. A fallback that swallows the failure then turns
a 100% error rate into silence (lesson #1's family).
**Prevention:** Cite the provider's documented encoding (or its SDK's — here
`["eval", script, keys.length, ...keys, ...args]` posted to the base URL) next
to the assertion, and pin THAT. Make the health probe execute the same request
shape the code path uses, never an adjacent property. Treat any non-zero count
of a `*.failOpen` Sentry action as a contract break to diagnose, not noise, and
carry the provider's error body into the captured exception so the next break
is readable.
**Ticket:** #9623

### 15. A gate with no producer has unreachable states, and reads as one constant signal
**Applies:** gate|status|verdict|marker|check-|board-verdict|producer|callers
**What happens:** A check ships, runs on every PR, and can only ever report one
value. `board-verdict.sh` turned a review-board marker in a PR comment into a
`review-board` commit status — and nothing in the repository emitted that
marker. The board workflow computed PASS/FAIL and returned it into a
conversation. So `success` and `failure` were states no code path could produce,
and every PR read `pending` forever. That is lesson #13's tell (the same result
on unrelated commits) arriving through a different door, and it is worse than
inert: a status that never changes trains everyone to ignore it, which is the
habit the check was written to break.
**Why:** Writing the consumer feels like writing the feature. The producer is a
one-line call somewhere else, so it reads as wiring rather than as the other
half of the mechanism. `agent-operations.md` §7 already says it — "grep for the
call sites that SHOULD use it; the module is not done until callers are wired" —
and the grep was not run.
**Prevention:** Before claiming a gate exists, name the code path that produces
EVERY state it can report, and run it once. If a state is only reachable by a
human remembering a command, say so at the definition. For a marker-based
check, assert the round trip in the suite: what the producer writes must be what
the consumer recognises, in one test, or the two regexes drift apart silently.
**Ticket:** #9743

### 16. A source pin written as a containment check passes on the commented-out line
**Applies:** toContain|grep -q|source pin|regression|sentry-regressions|nodeVersionConsistency|literal member
**What happens:** A test asserts a source file contains a call that must happen,
the call is commented out, and the test stays green — the name is still
byte-present. Measured three ways in one session: `expect(content).toContain(
'setSentryDeepRedactor')` passed with `// setSentryDeepRedactor(...)`; a suite
asserted a workflow "invokes the gate" with a containment grep that survives a
second `run:` key appended under it; and an allowlist entry anchored with `$`
was matched against `path:line:content`, where the anchor can never hold.
**Why:** A source pin exists precisely for properties no runtime test can see —
a bundle edge, a build-time substitution, a wiring call whose absence changes
nothing observable. That is exactly the situation where the pin is the only
guard, so its strength is the whole guarantee, and "the string appears
somewhere" is much weaker than it reads.
**Prevention:** Assert an EXECUTABLE occurrence: anchor to line start, exclude a
leading comment marker, or count occurrences rather than testing membership.
Then MUTATE — comment the line out, append a duplicate key, delete the call —
and confirm the pin goes red. A source pin you have not mutated is a source pin
you have not tested, and it is guarding the one thing nothing else can.
**Ticket:** #9743, #9739

### 17. Do not assert facts about the OPERATING environment you did not check
**Applies:** runbook|docs/guides|on-call|alert|escalat|rotation|notify|SLA|incident|postmortem|process
**What happens:** A document states, as fact, something about how this project
is run that nobody verified, and it reads with the same authority as the parts
that were measured. Written into `health-monitor-cron.md`: a rehearsal step
warned that a synthetic failure "can page on-call" and told the reader to "tell
someone before you run this". **There is no on-call — this is a
single-developer project.** The phrasing came from a review agent's report and
was repeated as fact.
**Why:** Environment facts feel like background rather than claims, so they skip
the check that any code claim would get. They are also the easiest thing to
import from a generic template, from another project's habits, or from an
agent's summary — and an agent's report is a SOURCE, not a verification. Worse,
`docs/sentry-alert-rules.md` looks like evidence that alert rules exist; its own
first paragraph says the opposite ("recommended … actual rules must be created
in the Sentry dashboard"). A document describing a system is not proof the
system is configured.
**Prevention:** Write the property you can point at in the repository, and stop
there. "The Sentry `environment` tag comes from `NODE_ENV`, so preview issues
are tagged `production`" is checkable and useful; "so this will page someone" is
neither. When the next step depends on infrastructure outside the repo — an
alert rule, a rotation, a dashboard setting, a notification channel — say what
you could not verify and name where to look, rather than predicting the outcome.
Never carry a subagent's framing into a claim of your own without checking the
thing it was framing.
**Ticket:** #9718
