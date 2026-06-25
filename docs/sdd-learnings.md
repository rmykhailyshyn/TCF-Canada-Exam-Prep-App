# SDD Learnings

Observations about the Spec-Driven Development process as it applies to this project.
Add entries as the project progresses.

---

## Key questions under evaluation

- Does writing specs before code reduce rework?
- Does the spec approval gate cause friction, or does it prevent bad decisions?
- Are spec traceability comments useful during debugging, or just noise?
- How well does this workflow scale to a solo dev vs. a small team?

---

## Log

### 2026-06-04 — Project kickoff

Specs drafted for all seven milestones before any implementation code was written.
The spec-writing process surfaced several ambiguities early (quiz modes, LLM provider
flexibility, import file structure, timing configuration) that would otherwise have
become code-level assumptions.

Notable: the interview-style clarification loop (asking questions before writing specs)
felt natural and forced precision on things like "what does session mean?" and
"one PNG per question or per passage?" These are exactly the kinds of decisions
that tend to get hardcoded silently without a spec step.

Open question: will the approval gate feel like useful friction or a bottleneck on a
solo project where the developer and the approver are the same person?

### 2026-06-08 — Milestone 2 implementation (reading import + session API + quiz UI)

**The spec was wrong in a way only the real artifact could reveal (Rule 4 in action).**
Both import specs asserted the correct-answer highlight was a vector **`rect`** fill and even
named the parser call (`rects[].non_stroking_color`). Against a real results PDF this finds
_nothing_: the rounded-corner option backgrounds are emitted by print-to-PDF as bezier
**`curves`**. A faithful implementation of the approved spec would have produced an importer that
silently detected zero correct answers. SDD didn't prevent this error (the spec was confidently
wrong), but the discipline shaped the response well: the divergence was treated as a _spec
defect_ — specs corrected first (mechanism + the previously-open RGB values + the `88` icon-glyph
artifact), flagged in revision history, then code written against the corrected spec. The
acceptance-criteria score cross-check (recompute weighted points from the answer key and compare
to the PDF's "X of 699") turned out to be the perfect oracle: reproducing 27/39 and 437/699
proved the colour detection without a hand-labelled fixture. **Lesson:** specs that encode an
_independent integrity check_ (not just behaviour) pay for themselves the moment reality diverges.

**Approved ≠ validated.** `reading-import` was approved while carrying an explicit "needs a real
sample before implementation" caveat (passages embedded as text vs. separate images). At
implementation time no real _reading_ PDF existed — only a listening one — so that open question
could not be closed; the importer shipped as a deliberately _partial_ implementation with the gap
named in the spec status rather than hidden as an untested branch.

When a real reading PDF + image finally arrived (later the same day), the spec turned out to be
wrong about reading in **three** ways the listening sample could never have revealed: (1) reading
PDFs have **no `"N. Question"` header** at all — questions are delimited only by their option block
and result label; (2) the question prompt is **not in the PDF text layer** — it lives in a
per-question image alongside the passage; (3) those images are **separate files keyed by a
sequence number in the filename**, OCR'd and split at a footer line. None of this was guessable;
all of it was a five-minute confirmation against the artifact. This is the same lesson as the
`curves`-vs-`rects` defect, one level up: _the spec's confident description of a format it had
never seen was wrong in structural, not cosmetic, ways._ The order-based parser that resulted is
strictly simpler and now serves **both** sections (re-validated: reading 19/266, listening
27/437). **Meta-lesson:** for spec items that describe an external artifact, "approved" should be
read as "approved pending first contact with reality" — the integrity cross-check, not the prose,
is what actually pins the behaviour down.

**Traceability comments earned their keep.** Writing `// spec: …§Behaviour.N` forced re-reading
the exact clause while coding (e.g. real-mode "auto-advance, no feedback" vs. learning-mode
"reveal + explanation") and caught a couple of would-be divergences before they were typed.

**Friction verdict (solo):** the approval gate was useful, not a bottleneck — the one place it
mattered was forcing a deliberate scope decision (defer import vs. build against a sample) up
front rather than discovering the sample problem mid-build.

### 2026-06-09 — Milestone 3 implementation (listening import + player + quiz UI)

**The spec investment from earlier milestones paid out as reuse, not rework.** Three structural
decisions made for reading turned out to carry listening almost for free: (1) the PDF parser was
already order-based and section-agnostic (it parses `"N. Question"` headers when present and is
silent when they aren't), so listening import needed _zero_ parser changes — `transcribe.ts` is a
near-mirror of `ocr.ts` swapping Tesseract-on-images for Whisper-on-MP3s; (2) `useQuizSession` was
written section-agnostic in M2, so the entire listening quiz lifecycle (create/answer/complete,
real-mode timer, learning feedback) is the _same hook_ — only the screen chrome (player instead of
passage) differs; (3) the answer-key cross-check (`crossCheckScore`) and `extractSequenceFromFilename`
were reused verbatim. **Lesson:** specs that name a _shared_ artifact (the results PDF, the session
model) and resist section-specific special-casing compound across milestones. The cost was paid in
M2; M3 collected the dividend.

**Open questions are cheaper to resolve at implementation than at spec time — when the decision is
reversible and local.** `listening-import` shipped to "approved" carrying four unresolved open
questions (Whisper variant, JSON shape, MP3 naming, score-mismatch policy). None blocked approval
because each had an obvious default and a narrow blast radius. At implementation all four resolved
in minutes, and one resolved _better_ than the spec assumed: the spec proposed `q<NN>.mp3` and
flagged that native `20Q7.mp3` names might need a rename step — but reusing the existing
`extractSequenceFromFilename` (digits-after-Q, last-number fallback) handles _both_ with no new
code. **Lesson:** the approval gate doesn't require _zero_ open questions — it requires that each
open question is either (a) decision-forcing and therefore worth blocking on, or (b) reversible and
local and therefore safe to defer with a named default. Conflating the two would turn the gate into
a bottleneck. The image-bearing-questions item was correctly held in the _third_ category: out of
scope, named in the spec, not silently dropped.

**Testability shaped the seam.** The "no DOM in the test env" constraint (tests run under
`renderToStaticMarkup` in node) pushed two clean separations that are good design independently of
testing: the Whisper seconds→ms transform is a pure `parseWhisperJson` split from the CLI call, and
the subtitle highlight math is a pure `activeSegmentIndex` split from the audio element. Both are
unit-tested without a browser; the side-effecting shells (`runWhisper`, the `useEffect` listeners)
stay thin. **Lesson:** an awkward test environment is a useful forcing function — it makes you name
the pure core that the spec's behaviours actually describe.

---

## Milestone 5 — Question bank export / import

**The spec's "no schema change" clause was a load-bearing design constraint, not a footnote.**
`question-export-import` committed up front to keying override on the existing
`UNIQUE(source_file, sequence)` rather than adding a portable UUID column. That one decision rippled
through the whole implementation: override updates rows _in place_ (same `questions.id`), so
`question_results` — which stores `chosen_label`, not option ids — stays linked with zero migration,
zero backfill, and zero risk to session history. The verification that mattered was a single
assertion (`idStable: true` after override), and it held because the spec had already reasoned the
identity through in §Data model. **Lesson:** a spec that names its _identity_ and its _referential
invariants_ explicitly turns the riskiest part of an import feature (don't orphan history) into a
one-line check.

**The pure-core / DB-shell seam paid off a third time.** Same pattern as M2/M3: all structural and
answer-key validation lives in `server/lib/export-import.ts` (DB-free, 22 unit tests covering every
rejection in §Behaviour.14), and the service is a thin transactional shell. Because validation runs
to completion _before_ the transaction opens, "failed validation leaves the DB unchanged"
(Behaviour.11) is true by construction rather than by careful rollback bookkeeping. **Lesson:** when
a spec says "validate before any write," the cheapest way to be correct is to make validation a pure
function that the write path calls first — the ordering becomes structural.

**One genuine spec gap, resolved per Rule 4.** The spec referenced "the configured media directory"
in three places but never named the mechanism. Implementation surfaced this immediately (import has
to resolve an audio basename to _something_), and it was resolved by introducing a `MEDIA_DIR` env
var with a `<repo-root>/media` default, recorded in the spec's revision history and `.env.example`.
This is the textbook Rule 4 case: the gap was real, local, and reversible, so it was fixed in the
spec + flagged rather than silently hard-coded. **Lesson:** "configured X" in a spec is a smell worth
catching at review time — it defers a decision (where does config live, what's the default) that
implementation cannot.

---

## Milestone 6 — Review mode

**The biggest win was a feature that needed almost no new code — because earlier specs over-built
the seam.** Review-mode's retry (Behaviour.8) sounded like the hard part: group wrong answers by
band, spin up a session per band, reject ids that don't belong. It turned out to be a _client-only_
feature. `POST /api/sessions` already accepted `questionIds` + `difficulty` and already enforced
`QUESTIONS_OUT_OF_BAND` — added in Milestone 2 for a quiz-session open question that hadn't shipped a
consumer yet. The review-mode spec was written against that contract (its API section literally says
"Reuses the session creation endpoint"), so retry reduced to one pure grouping function plus a
`navigate('/', { state })`. **Lesson:** a spec that commits to a _parameterised_ endpoint early
(question-id subsets, band constraint) pays out two milestones later when a new feature turns out to
be a new caller, not a new capability. The cost was a few unused branches in M2; the dividend was a
zero-backend feature in M6.

**"Consumes endpoint X" is a spec decision that still has an implementation fork.** The spec said
review mode consumes `GET /api/sessions/:id` — but that endpoint returned only `{questionId,
chosenLabel, isCorrect}`, nowhere near enough to render a question with its options and explanation.
Two honest readings: (a) enrich the existing endpoint, or (b) add a `/review` endpoint. The spec's
wording ("consumes … defined in progress-tracking") pointed at (a), so the per-question rows were
_additively_ enriched and the choice recorded in both specs' notes. Enriching also let the server
own Behaviour.6 (no explanations in real mode) as a query condition rather than trusting the client
to hide them. **Lesson:** "reuse endpoint X" reads like it removes a decision, but it only removes
the _routing_ decision — the payload-shape decision remains, and additive enrichment is the move
that keeps the consumed spec's contract intact.

**A test that silently never ran.** The first `groupByBand.test.ts` passed locally — because it
never executed: the `vitest` `include` glob was `client/**/*.test.tsx` (the only client tests so far
were `.tsx` render smokes), so a pure-logic `.test.ts` was invisible. The green run was a false
negative until the total test count failed to move. **Lesson:** when adding the first test of a new
_file-extension shape_ to a suite, confirm the count changed, not just that it's green — an
include-glob can quietly exclude a whole category, and "0 tests matched" still exits a per-file run
non-silently but vanishes in a full run.

---

## Milestone 7 — LLM enrichment (with a mid-stream spec pivot)

**A spec is cheapest to change while it's still a spec — this is the SDD payoff, observed directly.**
M7 was `approved` but unimplemented when the user asked for three changes at once: local CLI instead
of the HTTP API, English clue-citing explanations, and real-mode explanations in results. Because no
code existed yet, the "rework" was editing one spec file and answering three clarifying questions —
not unwinding a provider abstraction, a prompt template, and a gating rule already wired across
client and server. The approval gate (status → draft → re-approve) made the pivot a deliberate
checkpoint rather than a silent drift. **Lesson:** the gate's value isn't bureaucratic; it's that it
front-loads the expensive decisions (provider, language, where output surfaces) to the one moment
they're cheap to revise. Had M7 shipped on the first draft, the same request would have been a
refactor.

**One feature's change rippled into a _different_ implemented spec — and the specs caught it.** Making
real-mode results show explanations directly contradicted review-mode §Behaviour.6 ("real mode never
shows explanations"), an _already-implemented_ milestone. Because the rule was written down, the
conflict was visible at spec-edit time: the fix was an explicit "supersedes §Behaviour.6" note in
both specs plus removing one `session.mode === 'learning'` gate in the M6 query — not a confused
debugging session months later wondering why explanations leaked into real mode. **Lesson:**
cross-spec supersession is a normal event in a multi-milestone codebase; the discipline that makes it
safe is amending the _superseded_ spec in the same change, so the two specs never silently disagree.

**The model refusing to answer is a feature, not a bug — if the pipeline treats non-conforming output
as a skip.** The live smoke test hit a seed row whose passage didn't match its question; the model
declined to fabricate JSON and returned prose explaining the data mismatch. Behaviour.7 ("a CLI/parse
failure skips just this question and continues") turned that into a clean `failed 1`, not a crash or
a hallucinated explanation persisted to the bank. The "extract the first balanced JSON object, treat
its absence as failure" parser was the load-bearing piece. **Lesson:** when an LLM is in the loop,
"unparseable output" isn't an edge case to suppress — it's the channel through which the model signals
low confidence, and a spec that makes it a per-item skip converts model honesty into data integrity.

**CLI-as-provider slotted into the existing wrapper seam with no new shape.** The local `claude` CLI
wrapper (`scripts/lib/claude.ts`) is structurally identical to the Whisper/Tesseract wrappers the
project already had: pure prompt/parse helpers (unit-tested without spawning anything) plus one thin
`spawnSync` shell that surfaces non-zero exits as a typed error. The "shell calls live in
scripts/lib, pure transforms are exported and tested" convention — established in M2/M3 for OCR/audio
— absorbed a third external tool with zero architectural change. **Lesson:** a convention earns its
keep the third time you apply it without thinking; the LLM provider was "just another CLI" because
the seam for CLIs already existed.

---

## Milestone 8 — Randomized selection & ordering + reading passage image

**A spec written without a data-model change forced the _better_ implementation.** The M8 spec
revision (random per-session selection: shuffle the learning band; draw one question per position in
real mode) was deliberately authored with **no schema change** — the "Data model" section stayed
empty. At implementation that constraint did real work. The naïve way to make a randomly-drawn exam
"stable for review" is to persist the chosen set (a `session_questions` join table). But the existing
`question_results` rows _already are_ the per-session record (one row per answered position), so the
only genuinely new need was getting real-mode `total`/`pointsPossible` right when a position has
several imported candidates. That reduced to "count **distinct** sequence positions, not question
rows" — a three-line change in `completeSession`, no migration, no backfill, review/history
untouched. **Lesson:** the empty "Data model" section is a design assertion, not an omission. Holding
it forces you to ask whether the data you'd add is already implied by data you have — here it was, and
the spec's restraint is what surfaced that.

**The feature's correctness was provable at the API layer; the UI fallout was the expensive part.**
The two behaviours that _are_ M8 — real mode returns 39 distinct ascending positions, learning order
varies across sessions — are pinned by two short e2e API assertions that needed no browser. What cost
the most was a _second-order_ effect: shuffling learning order broke three listening e2e tests that
had hard-coded "Q1 is shown first" (its options, its transcript phrases). The tests weren't wrong
about the player; they were wrong to assume order. Making them order-tolerant (identify whichever
question is on screen by its unique correct option, then act) is the shape a test should have had all
along once order became non-deterministic. **Lesson:** a randomness feature's blast radius is every
test that silently depended on determinism it never declared. Budget for converting "assumes a fixed
order" tests, not just for the feature.

**The deepest bug was in the _test environment_, and only real data exposed it.** The e2e suite ran
against the shared dev database. That was invisibly fine until the developer imported real listening
exams — several questions per position — at which point the seeded "Beginner band = 4 questions"
assumption was false (it was 22), and the suite was non-deterministic in a way no code change could
fix. The honest fix was structural: isolate e2e onto a dedicated `tcf_prep_e2e` database that
global-setup creates, migrates and seeds, with the app launched against it. **Lesson:** "the suite
seeds its own data" is only half of self-containment; the other half is _owning the database it seeds
into_. A suite that writes its fixtures into a DB it shares with real data is deterministic only until
the real data arrives — and SDD's specs say nothing about test-harness isolation, so this class of
gap lives entirely outside the spec discipline and has to be caught by actually running the thing.

**Polish surfaced two pre-existing defects the specs couldn't have caught — because they were
_implementation_ drift, not _spec_ divergence.** (1) The dev seeds deleted questions without first
deleting the `explanations` / `question_results` that reference them — a latent FK error that only
fired once M7 explanations existed for seeded rows. (2) `listSessions` computed its "correct" count
with no `is_correct` filter, so every history row read N/N; the spec said "correct count," the code
quietly didn't. Both passed every gate (spec approved, types check, lint clean, prior tests green)
because nothing _exercised_ them with the right data. **Meta-lesson on the limits of SDD:** the spec
gate catches _divergence from intent_; it does not catch _code that never matched the intent it cited
and was never run against data that would tell_. Traceability comments point you at the right clause,
but a comment that says `// spec: …correct count` sitting above a query that counts everything is the
failure mode SDD can't see. Only an integrity check or an adversarial test does.

---

## Milestone 9 — Retrospective + polish: did SDD pay off?

A verdict on the four questions this project set out to evaluate, with the evidence from M1–M8.

**1. Does writing specs before code reduce rework?** _Yes, but indirectly — the reduction came from
reuse, not from getting code right the first time._ Specs were confidently **wrong** about external
artifacts more than once (rects-vs-curves in M2; the reading PDF's structure; the M7 provider pivot),
so "spec first" did not prevent those reworks. What it did was make the _seams_ generous: a
section-agnostic PDF parser and session hook (M2) carried listening for free (M3); a parameterised
`POST /api/sessions` (M2) made review-mode retry a zero-backend feature (M6); a CLI wrapper convention
(M2/M3) absorbed the LLM provider (M7); an empty "Data model" section (M8) forced the no-migration
design. The rework SDD avoids is **structural** rework — the kind where a missing parameter or a
section-specific assumption forces you to re-cut an interface two milestones later. Local, factual
rework (a wrong RGB value, a missing header) it does not prevent and shouldn't claim to.

**2. Does the approval gate cause friction or prevent bad decisions?** _Prevent — and its real value
showed up at exactly one moment per milestone, not continuously._ On a solo project the gate is not
about a second person; it is a forced _checkpoint_ that front-loads the expensive, hard-to-reverse
decisions to when they are still prose. The clearest payoff was M7: three changes (provider, language,
where output surfaces) requested while the spec was still `approved`-but-unbuilt cost one file edit
instead of unwinding a wired-in abstraction. The gate's discipline — "draft → re-approve" for a pivot,
"named default" for a reversible open question (M3), "out of scope, in writing" for a deferral —
is what kept it from becoming a bottleneck. **The gate is friction proportioned to reversibility**,
which is the right shape.

**3. Are traceability comments useful, or noise?** _Useful while writing, and a double-edged sword
while debugging._ Writing `// spec: …§Behaviour.N` repeatedly forced re-reading the exact clause and
caught would-be divergences before they were typed (M2). But M8 exposed the limit: a traceability
comment is an _assertion of intent_, and the `listSessions` "correct count" bug was a comment sitting
truthfully above code that didn't do what the comment said. The comments are a high-signal index into
the specs; they are **not** a verification that the code matches. Their honest value is navigation, not
proof — pair them with integrity checks, never lean on them as evidence.

**4. How well does this scale solo vs. to a team?** _Solo: clearly net-positive, because the specs are
the externalised memory a solo dev otherwise keeps in their head and loses._ The revision histories
("rects → curves, re-validated 27/437"; "supersedes review-mode §Behaviour.6") are the single best
artifact the project produced — they make a decision's _why_ legible months later. For a team the same
artifacts would do more work (shared context, async review at the gate), but two team-specific stresses
went **untested** here because author and approver were one person: genuine disagreement at the
approval gate, and concurrent specs editing the same surface. The one concrete team-shaped hazard that
_did_ appear — two PRs (M8, M9) both editing `milestones.md` and the same specs — is a merge-conflict
risk the gate does nothing about.

**Where SDD was silent.** Three of this project's most expensive issues lived entirely outside the
spec discipline and had to be caught by _running the system against real data_: e2e DB isolation, the
seed FK-ordering bug, and the history correct-count bug (M8/M9). SDD governs the boundary between
_intent_ and _code_; it has nothing to say about the boundary between _code_ and _reality_ (does the
PDF actually look like that? does the test DB actually contain what you think?). The project's best
defence there was not a spec but a habit the specs _encouraged_: encode an **independent integrity
check** (the weighted-score cross-check, the `idStable` assertion, the "39 distinct positions"
e2e) so reality has a way to contradict you. **Final lesson:** specs are necessary and they paid for
themselves, but the integrity checks they prompted — not the prose — are what actually pinned the
behaviour down. SDD's contribution was making those checks the natural thing to write.

## Milestone 11 — Speaking section (the "parallel section" stress test)

Milestone 11 was the strongest evidence yet for one specific SDD payoff: **specs as a reuse map.**
Speaking is structurally a sibling of Writing (M10) — sessions, per-task draw, /20 + NCLC + feedback,
training-vs-real — so almost every file had a named analog (`writing.ts` → `speaking.ts`,
`writingEvaluation.ts` → `speakingEvaluation.ts`, `useWritingSession` → `useSpeakingSession`). Because
the four specs were written _before_ the M10 code was treated as a template, the diff between the two
sections was legible up front: same shape, three deliberate differences (JSON import not markdown;
audio → Whisper → Claude not typed text; per-task two-phase timing not one global clock). The spec
made the _deltas_ the thing to think about and let the rest be mechanical. Rework was near-zero.

Two friction points worth recording:

- **The spec resolved a decision the code would otherwise have fumbled.** `import:speaking` takes
  `--file` (one JSON doc), not `--dir` like `import:writing` — a small divergence that's obvious in the
  spec and would have been an easy copy-paste bug without it. Same for `sequence` being 0-based: the
  spec flagged it as an open question and forced a choice before a line was written.
- **SDD is still silent on the code↔reality boundary, and here that boundary is a hardware one.**
  Whisper + Claude are Apple-Silicon/macOS-only, so on the Windows dev box the _spoken-answer →
  transcript → score_ path cannot actually run. The specs say what should happen; they cannot tell you
  whether `mlx_whisper` ingests a browser `webm/opus` blob. That open question (transcode or not) is
  marked in speaking-evaluation but is only truly closeable by running it on the target hardware — the
  same "does reality match?" gap M9 called out, now wearing a platform hat. The mitigation was the M9
  habit: keep the pure, testable seams (parser, prompt builders, JSON parsers) on the near side of the
  CLI boundary so the untestable part is as small as possible.

## Milestone 12 — UI polish (two presentation-only specs from detailed mockups)

M12 was the first milestone where the specs were **frontend-only and explicitly tied to mockups** —
both `virtual-keyboard.md` and `section-navigation.md` cited `docs/mockups.md` §19/§20, and the
keyboard spec even froze its 16-key layout from a screenshot of the real exam software. Two
observations:

- **A mockup closes the "what does it look like?" gap a behaviour list leaves open.** The keyboard
  spec's prose ("a 4×4 grid of 16 keys") plus the §19 wireframe and the exact glyph table left almost
  nothing to invent — the component was transcription, not design. Where the spec was prose-only
  (where to place the keyboard relative to the textarea) it deferred to "implementation detail," and
  that was the one spot that needed a judgement call. **Lesson:** for presentation specs, a pinned
  visual reference is worth more than more behaviour prose.
- **The spec's open questions were the real design decisions, and resolving them up front (via the
  approval gate) prevented a refactor.** Section-navigation listed two open questions — does the top
  menu show mid-session, and do Reading/Listening keep their shared inline setup — whose answers
  determined whether this was a small additive change or a routing rewrite. Deciding both _before_
  coding (in-session header stays; R/L inline, W/S route out) kept the change additive: one new
  `TopNav`, four cards in the existing `SetupScreen`, and header swaps — no session-flow changes.
- **The code↔reality gap reappeared, smaller.** The one behaviour SDD couldn't pin from prose was
  native-undo + autosave-on-insert (§Behaviour.3): it hinges on `execCommand('insertText')` firing the
  same `input` event React's `onChange` listens for, which the `node` test env can't exercise. The M9
  habit applied again — the pure seams (`glyphFor`, `computeInsertion`) are unit-tested; only the thin
  DOM wrapper is left to manual/e2e verification.

## Milestones 13–16 — Cloudflare hosting initiative (planning phase)

This is the first **cross-cutting infrastructure** change the project has attempted (everything M1–M12
was a vertical feature slice), and it surfaced two SDD observations _before any code was written_ —
worth recording while the specs are still drafts pending approval.

- **The architecture the earlier specs enforced is what makes this migration small — and the specs
  predicted its own blast radius.** Two long-standing conventions, each written down and held across
  milestones, are exactly what bound the change: "no raw SQL, all access via Drizzle" means the
  PostgreSQL → SQLite swap is confined to the schema definition + client + config (M13), not scattered
  across services; "route handlers are thin, business logic in services" means the Express → Hono swap
  (M14) touches handlers only, leaving every service untouched. The planning exploration could state the
  blast radius _with confidence_ because the invariants in CLAUDE.md had been enforced, not just
  aspirational. **Lesson (provisional, to confirm at implementation):** the payoff of a strict layering
  rule isn't visible in the feature that introduces it; it's visible the first time an orthogonal change
  (database, framework, runtime) has to pass through the layer and finds a clean seam instead of a smear.

- **A platform constraint, not a product decision, drove the scope — and writing it into specs forced
  the product decision into the open.** Cloudflare's free serverless cannot run the local CLI binaries
  (Whisper/Tesseract/Claude). That single fact dictates that the online instance is _practice-only_, which
  is a **user-facing** product change (online Writing/Speaking show sample answers, no AI score). Rather
  than let that leak out as an emergent property of "what happened to deploy," the specs name it directly:
  a `capabilities` flag (M14) is the one mechanism, and M16 spells out the degraded online behaviour as
  explicit numbered behaviours. **Lesson (provisional):** when an infrastructure limit forces a
  product-visible compromise, the spec is the right place to make it a _decision_ (named, gated, testable)
  instead of a _surprise_. The capabilities flag is the M2-style "parameterise the seam" move applied to a
  runtime difference rather than a request parameter.

- **All four milestones were spec'd up front (drafts) before approving any.** Unlike the M1 kickoff (seven
  specs drafted together for independent features), these four are a _dependency chain_ — M14 needs M13's
  DB factory, M15 needs M14's portable core, M16 needs M15's runtime. Drafting them together made the
  chain's seams (the DB factory, the `MediaStore` interface, the capabilities flag) visible as the three
  things that must be introduced in M14 to keep M15/M16 small. Whether front-loading the whole chain helps
  or whether the later specs churn once the earlier ones are implemented is the open SDD question to
  revisit in the retrospective.

## Milestone 13 — Database migration to SQLite (the layering bet pays off)

M13 was the first milestone to _implement_ a cross-cutting infrastructure change, and it confirmed the
provisional lesson logged during planning: the "all access via Drizzle" invariant made the blast radius
exactly what the spec predicted. Not one service, route, or seed had a _logic_ change — the diff is the
schema definition, the client, the config, the generated baseline, and mechanical `pool`→`client` renames
in seven scripts. The strict layering rule, written down and enforced across twelve feature milestones,
is what let an orthogonal engine swap pass through one seam instead of smearing across the codebase.

- **Where the spec was silent was the code-vs-reality boundary again — twice.** The spec's type-mapping
  table and behaviours were complete and correct, and `drizzle-kit generate` reproduced every
  CHECK/UNIQUE/index/FK faithfully (one open question closed positively). But two implementation realities
  the spec couldn't have known surfaced only when the code ran: (1) **libSQL resolves a relative `file:`
  path against `process.cwd()`**, and the server workspace (`server/`) has a different cwd than the
  root-run tooling — so they silently opened _different_ database files (the e2e suite failed with "no
  data" until `getDatabaseUrl()` was changed to anchor relative paths to the repo root). Postgres URLs are
  host-based and cwd-independent, so nothing in the prior twelve milestones could have flagged this. (2)
  **Windows holds the SQLite file handle** (server teardown / AV scan) for seconds after a run, breaking a
  delete-then-recreate e2e reset; the fix was to make the reset best-effort and lean on the _already-spec'd_
  idempotency of migrate + seeds. **Lesson:** SDD specs are strong at _what_ and _which seam_; they remain
  blind to host/runtime mechanics (cwd, file locks, driver quirks) that only the running system reveals —
  exactly the boundary M9 named. Rule 4 worked as intended: both findings went into the spec's revision
  history as discovered facts, not silent patches.

- **A "no behaviour change" spec is the easiest kind to verify — because the old tests _are_ the spec.**
  The acceptance criteria were almost entirely "the existing suites still pass on the new engine." 136 unit
  tests (pure, no DB) and 15 e2e tests (against an isolated SQLite file) carried the whole correctness
  argument with no new test-writing — the inherited suite doubled as the regression contract for the swap.

- **The data-migration script is a spec'd dead-end, and that's a feature.** The spec deliberately scoped a
  one-time, best-effort, local-only PG→SQLite copy with `pg` demoted to a devDependency, _and_ pre-declared
  (in M14's spec) that the script and `pg` get deleted once dev data is carried over. Writing the throwaway's
  obsolescence into the next milestone's spec stops it from rotting into permanent surface area — the
  retirement is planned, not hoped for. (Here the source dev DB happened to be empty, so only the read path
  ran live; the verbatim type-conversion write path is simple enough to carry on inspection.)
