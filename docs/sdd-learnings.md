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
*nothing*: the rounded-corner option backgrounds are emitted by print-to-PDF as bezier
**`curves`**. A faithful implementation of the approved spec would have produced an importer that
silently detected zero correct answers. SDD didn't prevent this error (the spec was confidently
wrong), but the discipline shaped the response well: the divergence was treated as a *spec
defect* — specs corrected first (mechanism + the previously-open RGB values + the `88` icon-glyph
artifact), flagged in revision history, then code written against the corrected spec. The
acceptance-criteria score cross-check (recompute weighted points from the answer key and compare
to the PDF's "X of 699") turned out to be the perfect oracle: reproducing 27/39 and 437/699
proved the colour detection without a hand-labelled fixture. **Lesson:** specs that encode an
*independent integrity check* (not just behaviour) pay for themselves the moment reality diverges.

**Approved ≠ validated.** `reading-import` was approved while carrying an explicit "needs a real
sample before implementation" caveat (passages embedded as text vs. separate images). At
implementation time no real *reading* PDF existed — only a listening one — so that open question
could not be closed; the importer shipped as a deliberately *partial* implementation with the gap
named in the spec status rather than hidden as an untested branch.

When a real reading PDF + image finally arrived (later the same day), the spec turned out to be
wrong about reading in **three** ways the listening sample could never have revealed: (1) reading
PDFs have **no `"N. Question"` header** at all — questions are delimited only by their option block
and result label; (2) the question prompt is **not in the PDF text layer** — it lives in a
per-question image alongside the passage; (3) those images are **separate files keyed by a
sequence number in the filename**, OCR'd and split at a footer line. None of this was guessable;
all of it was a five-minute confirmation against the artifact. This is the same lesson as the
`curves`-vs-`rects` defect, one level up: *the spec's confident description of a format it had
never seen was wrong in structural, not cosmetic, ways.* The order-based parser that resulted is
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
silent when they aren't), so listening import needed *zero* parser changes — `transcribe.ts` is a
near-mirror of `ocr.ts` swapping Tesseract-on-images for Whisper-on-MP3s; (2) `useQuizSession` was
written section-agnostic in M2, so the entire listening quiz lifecycle (create/answer/complete,
real-mode timer, learning feedback) is the *same hook* — only the screen chrome (player instead of
passage) differs; (3) the answer-key cross-check (`crossCheckScore`) and `extractSequenceFromFilename`
were reused verbatim. **Lesson:** specs that name a *shared* artifact (the results PDF, the session
model) and resist section-specific special-casing compound across milestones. The cost was paid in
M2; M3 collected the dividend.

**Open questions are cheaper to resolve at implementation than at spec time — when the decision is
reversible and local.** `listening-import` shipped to "approved" carrying four unresolved open
questions (Whisper variant, JSON shape, MP3 naming, score-mismatch policy). None blocked approval
because each had an obvious default and a narrow blast radius. At implementation all four resolved
in minutes, and one resolved *better* than the spec assumed: the spec proposed `q<NN>.mp3` and
flagged that native `20Q7.mp3` names might need a rename step — but reusing the existing
`extractSequenceFromFilename` (digits-after-Q, last-number fallback) handles *both* with no new
code. **Lesson:** the approval gate doesn't require *zero* open questions — it requires that each
open question is either (a) decision-forcing and therefore worth blocking on, or (b) reversible and
local and therefore safe to defer with a named default. Conflating the two would turn the gate into
a bottleneck. The image-bearing-questions item was correctly held in the *third* category: out of
scope, named in the spec, not silently dropped.

**Testability shaped the seam.** The "no DOM in the test env" constraint (tests run under
`renderToStaticMarkup` in node) pushed two clean separations that are good design independently of
testing: the Whisper seconds→ms transform is a pure `parseWhisperJson` split from the CLI call, and
the subtitle highlight math is a pure `activeSegmentIndex` split from the audio element. Both are
unit-tested without a browser; the side-effecting shells (`runWhisper`, the `useEffect` listeners)
stay thin. **Lesson:** an awkward test environment is a useful forcing function — it makes you name
the pure core that the spec's behaviours actually describe.
