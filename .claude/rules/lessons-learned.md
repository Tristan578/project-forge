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

### 15. Upstream error text is not yours to forward
**Applies:** app/api/|route.ts|lib/api/errors|createGenerationHandler|lib/generate/|redactSecrets|sentryConfig|no-raw-response-in-catch|egressGuard|withEgressGuard|MAX_DEPTH|redactWith|hasCandidate|bench-egress-guard|opengraph-image|sitemap.ts|presigned|getSignedDownloadUrl
**What happens:** A route answers a failure with the upstream provider's own
words. It reads like good diagnostics and it is an egress channel: on the
platform path the credential in play is the PLATFORM's, so a provider that
echoes key material in a 401 body hands a platform secret to any signed-in
user. Found on twelve routes at once (#9736), all of the same shape:

    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Meshy status error (${response.status}): ${error}`);
    ...
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });

**Why:** Two habits meet. A client folds the response BODY into the thrown
error so a human can debug it, and a route forwards `err.message` because it
looks more helpful than a fixed string. Neither author sees the other half.
And the risk is not only credentials: upstream text carries internal
hostnames, SQL, and other tenants' identifiers, none of which a redactor can
recognise.
**Prevention:** A caught error goes to Sentry and to the server log; the client
gets fixed text. Where the message genuinely IS yours and belongs to the user
(a safety-filter reason), give it a **type** and narrow with `instanceof` —
never a message prefix, which any upstream error can also produce.

**And do not try to enforce this with a text detector.** The first attempt was
one: a vitest source scan that looked for a caught binding flowing into a
response body. A review board walked through it with ELEVEN ordinary shapes in
one sitting — `err.toString()`, `err.response.data`, an `if` instead of a
ternary, `const { message } = err`, `NextResponse.json(buildBody(err))`,
`new NextResponse(JSON.stringify(...))`, a header set after construction, an
assignment to an outer `let`, `parts.push(err.message)` then `join`, a promise
`.catch((e) => ...)` callback, and a plain `new Response(String(err))`. Every
one is the natural way to write the same thing. Enumerating how a body was
ASSEMBLED is unwinnable, because the ways to build a string are unbounded.

The second attempt fixed assembly and then enumerated the SITES: `.json`, an
assignment to an outer binding, an argument to a sanctioned constructor. A
second board defeated that one too, in an afternoon, with sinks the list did
not name — the RETURN VALUE of a catch scope (`.catch((e) => e.message)`, with
the response built at the call site), a header set on a SANCTIONED
constructor's result, a `redirect` whose URL carries the text, a receiver
rooted in a call (`getDb().update(x).set({ e: err.message })`), a stream's
`enqueue`, and `import { NextResponse as NR }`. **The set of sinks is as
unbounded as the set of ways to build a string.** Enumerating either one is the
same mistake wearing a different hat.

The third attempt inverted the model: instead of enumerating sinks, track the
caught binding and every value derived from it, and report wherever it CROSSES
OUT of the catch scope. The claim was that crossing out is a CLOSED set even
though sinks are not. A third board disproved that too, and the bypasses were
one-liners:

    const sink = cache; sink.set('last', err.message);   // alias an outer Map
    const R = NextResponse; return R.json({ detail });    // alias the ctor
    function detail() { return String(err); }             // hoisted declaration
    sql`UPDATE jobs SET error = ${err.message}`           // tagged template
    yield String(err);                                    // a fifth exit

The escape check compared NAME scope against REACHABILITY — "declared inside
the catch" was treated as "cannot outlive the request" — so one `const` that
aliased an outer object silenced every escape the previous two boards had
pinned. And the rule's own message ("keep the error inside the catch") is what
pushes an author toward writing exactly that alias.

**THE ACTUAL LESSON, after three passes: a hand-written static analysis cannot
carry a security property over an open-ended language. Put the control at
RUNTIME, on the one path every byte takes.** `withEgressGuard`
(`web/src/lib/security/egressGuard.ts`) wraps every App Router handler and
redacts the body, every header value, every `Set-Cookie` and the `Location`
before the response is returned. However the body was assembled — helper,
alias, hoisted function, tagged template, stream, a shape nobody has thought of
— it passes through one function. That property does not depend on anyone
having predicted the attack, which is the exact thing each of the three static
designs depended on.

Enforcement then stops being a dataflow question and becomes a SHAPE question,
which a parser can answer with certainty: `egressGuardCoverage.test.ts` walks
every `src/app/**/route.ts` and names any exported HTTP method that is not a
`withEgressGuard(...)` call. A route that forgets the wrapper is named; nothing
has to be inferred.

The lint rule is KEPT, and demoted to what it is: early feedback in the editor
for the common shapes, not the guarantee. That is a real thing to want — it
tells an author they are writing the defect before CI does — as long as nobody
reads its green as proof. Use `createErrorResponse`, `apiError` or
`redactedJson` from `@/lib/api/errors`; all of them run `redactSecrets`, and
the guard runs it again on the way out.

A generalisation worth carrying: when a control has a mandatory single path at
runtime, put the control THERE and use static analysis for the coverage
question ("is every handler wrapped?"), never for the semantic one ("can this
value reach a client?"). The first is decidable. The second is not.

Three more things this cost, each worth carrying forward:

- **Scope the gate to the PROPERTY, not the filename.** The glob was
  `src/app/api/**/route.ts` plus `src/lib/api`, which asserts "no route FILE
  leaks". Five response builders sat outside it, and nothing failed when they
  landed there. `noRawResponseInCatchCoverage.test.ts` now scans for every
  module that constructs a response and asks ESLint's own
  `calculateConfigForFile` whether the rule is on for it.
- **Scope an exemption to the VALUE, not just the branch.** Scoping
  `instanceof` narrowing to the branch (rather than to 400 nearby characters,
  which is what the text detector did) was necessary and not sufficient:
  `apiError(402, err.cause.body)` inside `if (err instanceof ApiKeyError)`
  inherited an exemption justified by "the MESSAGE is ours". The exemption now
  covers only the narrowed error's own message-shaped properties.
- **A RuleTester case can be vacuous.** The case named for the header channel
  built its response with a raw `NextResponse.json` on the line above, so its
  one expected error came from the site ban and deleting the header line left
  it green (lessons-learned #11, inside the file that cites #11). Write each
  case so the line under test is the only thing that can report, then DELETE
  that line and confirm the case fails.
- **Percent-encoding defeats a `\b`-anchored pattern.** Every credential shape
  in `redactSecrets` is left-anchored on a word boundary, and in
  `?e=invalid%20key%20sk-ant-AAA` the character before `sk-ant-` is the `0` of
  `%20` — a word character — so the boundary never matches. A redirect
  `Location` and a `Set-Cookie` value are percent-encoded by the time they are
  headers, so the two channels the guard closes structurally were passing the
  key through verbatim until the guard matched against a DECODED view and
  spliced the placeholder back at mapped offsets. Test a redactor on the
  encoding its output actually travels in.
**A FOURTH board found the runtime guard shipping a blocker of its own, and the
shape of it is the most transferable thing in this entry.** Redacting every
response meant parsing, walking and re-serialising every response — which
carried `redactSecrets`' `MAX_DEPTH = 8` onto the SUCCESS path. Past the bound
the sub-tree was replaced with the literal string
`[REDACTED: nesting depth limit]`. On the error path that was right: truncating
a diagnostic costs nothing, and the version before it emitted a deeply-nested
secret verbatim. On a 200 it was catastrophic. At
`{game:{sceneData:{entities:[{...}]}}}` an entity sits at depth 4, so a tilemap
layer's `tiles`, a skeleton bone's `localPosition` and an animation track's
`keyframes` all land at or past eight. Published games came back
undeserialisable, the editor wrote the truncated scene back on the next save,
and the GDPR export had holes in it. Silently — no status change, no log.

That is lesson #1 in a new costume: **a control that asserts the right property
on its old path and the wrong one on its new one.** When you move a control to a
different path, re-derive every bound it carries against the new input class.
"It was fail-closed where it came from" is not an argument that it is
fail-closed here; on the error path a truncated diagnostic is free, and on the
success path it is data loss served as if it were the data.

Three more, each of which cost a review pass:

- **The guard's own byte-identity test could not observe any of it.** The
  fixture was `{ ok, items:[1,2,3], nested:{ a, b } }` — two levels, small
  integers, nothing a JSON round-trip or a depth bound could damage — so the
  assertion passed for any implementation that round-trips JSON at all. That is
  #11, written by the same author who had just cited #11, in the file that cites
  it. When you assert "unchanged", pick a fixture where each way it could
  CHANGE is present and reachable, and prove the fixture is capable of failing.
- **The fix for the blocker was also the fix for the lossiness and the
  latency.** Scanning the raw text first and returning the ORIGINAL response
  when nothing matches means a body with no secret is never parsed, never
  walked, never re-serialised — so pretty-printing, integer-like key order,
  integers past 2^53, `1e400` and `-0` all survive without anyone enumerating
  them, and the cost falls to one linear pass. Reach for "do nothing when there
  is nothing to do" before reaching for "do it more carefully".
- **A redactor that runs on live output can BREAK the product it protects.**
  Two here, both real: `ASSET_R2_ACCESS_KEY_ID` matches a secret-name pattern on
  the word KEY and its value is embedded in every SigV4 presigned URL, so
  redacting it made R2 answer 403 and every paid asset download failed silently;
  and correcting the `forge_` shape (which could never match, because the route
  mints 64 hex characters and the pattern said `{32}`) would have redacted the
  key out of the 200 body whose entire purpose is to show it once. Before
  widening a redactor, ask which legitimate output carries the thing you are
  about to remove. A pattern with no match is useless; a pattern that fires on
  the product working is worse than useless.

And two enforcement notes: a gate that walks `route.ts` does not walk the files
Next.js routes (`route.js`, `.jsx`, `.mjs`, `.tsx` all count, and a floor of
"> 90 files" is satisfied by the ones you can see however many you cannot). A
gate that accepts a wrapper by IDENTIFIER TEXT is defeated by
`const withEgressGuard = (h) => h;` — the same aliasing that beat the three
static passes, reappearing inside the enforcement half of the design that
replaced them. Resolve the binding.
**Ticket:** #9736
