# Mockups — Key Pages

Low-fidelity ASCII wireframes for the primary screens. These are visual references for the
specs in `docs/specs/`, not implementation. Each mockup cites the spec behaviour it reflects.

Legend: `(•)` selected radio · `( )` unselected · `[ Button ]` · `▸` active/highlighted ·
`✓` correct · `✗` incorrect.

---

## 1. Session Setup — mode selection

> spec: quiz-session.md §Mode selection.1–2 · reading-quiz-ui.md §Session setup.1–2 ·
> section-navigation.md §Behaviour.1, 3, 6 (all four sections — Milestone 12)

All four sections are selectable here and from the persistent top menu (mockup §20).
**Reading** and **Listening** continue into the Mode + Difficulty steps shown below;
**Writing** and **Speaking** hand off to their own setup screens (mockups §11, §15).

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Canada Prep    Reading Listening Writing Speaking │ Hist  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Start a session                                            │
│                                                              │
│   Section                                                    │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │ ▸ Reading│ │ Listening│ │ Writing  │ │ Speaking │        │
│   │ MCQ ·    │ │ MCQ ·    │ │ 3 tasks  │ │ 3 tasks  │        │
│   │ passage  │ │ audio    │ │ /20      │ │ /20 ·🎤  │        │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                              │
│   ── Reading / Listening: ──────────────────────────────────  │
│   Mode                                                       │
│   ┌──────────────────┐   ┌──────────────────┐                │
│   │ ▸ Learning       │   │   Real           │                │
│   │ no timer,        │   │ 60 min · 39 q,   │                │
│   │ feedback each Q  │   │ no feedback      │                │
│   └──────────────────┘   └──────────────────┘                │
│                                                              │
│   ▼ Difficulty (Learning only)                               │
│   (see next mockup)                                          │
│                                                              │
│                                          [ Start ]  ◄ disabled│
│                                            until difficulty   │
└──────────────────────────────────────────────────────────────┘
```

Selecting **Writing** or **Speaking** instead routes straight to that section's own
Training/Real setup (the Mode + Difficulty block above is Reading/Listening-specific).

---

## 2. Session Setup — difficulty picker (Learning mode)

> spec: quiz-session.md §Mode selection.3 · reading-quiz-ui.md §Session setup.1

Shown only when **Learning** is selected. Each band maps to a scoring tier; the label
carries both the descriptive name and the point value.

```
┌──────────────────────────────────────────────────────────────┐
│   Difficulty                                                  │
│                                                              │
│   ( ) Beginner            Q1–4      · 3 pts                   │
│   ( ) Elementary          Q5–10     · 9 pts                   │
│   (•) Intermediate        Q11–19    · 15 pts                  │
│   ( ) Upper-Intermediate  Q20–29    · 21 pts                  │
│   ( ) Advanced            Q30–35    · 26 pts                  │
│   ( ) Expert              Q36–39    · 33 pts                  │
│                                                              │
│                                          [ Start ]  ◄ enabled │
└──────────────────────────────────────────────────────────────┘
```

Real mode has no difficulty step — it always runs the full 39-question section.

---

## 3. Reading Quiz — Learning mode (before confirming)

> spec: reading-quiz-ui.md §Layout.3–6, §Answering.7–10

Counter reflects the **filtered band size** (Intermediate = 9 questions). No timer.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep            Reading · Learning          Q3 of 9      │
├───────────────────────────────┬──────────────────────────────┤
│  PASSAGE                       │  Question 3                  │
│                               │  Quel est l'objectif          │
│  Le télétravail s'est imposé   │  principal du texte ?         │
│  dans de nombreuses entre-     │                              │
│  prises depuis 2020. Si        │  ( ) A  Décrire un lieu      │
│  certains employés y voient    │  (•) B  Analyser une         │
│  une liberté nouvelle,         │         tendance             │
│  d'autres regrettent le lien   │  ( ) C  Donner une recette   │
│  social du bureau…             │  ( ) D  Raconter un voyage   │
│                               │                              │
│  [ scrollable ▲▼ ]            │       [ Confirm answer ]     │
└───────────────────────────────┴──────────────────────────────┘
```

---

## 4. Reading Quiz — Learning mode (after confirming, with explanation)

> spec: reading-quiz-ui.md §Learning mode feedback.11–13 · llm-enrichment.md (bundled response)

Correct option marked green `✓`, the user's wrong pick marked red `✗`. LLM explanation
appears below if it exists; otherwise the explanation block is omitted.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep            Reading · Learning          Q3 of 9      │
├───────────────────────────────┬──────────────────────────────┤
│  PASSAGE                       │  Question 3                  │
│                               │  Quel est l'objectif          │
│  Le télétravail s'est imposé   │  principal du texte ?         │
│  dans de nombreuses entre-     │                              │
│  prises depuis 2020…           │  ✗ A  Décrire un lieu  ◄ you │
│                               │  ✓ B  Analyser une tendance  │
│                               │    C  Donner une recette     │
│                               │    D  Raconter un voyage     │
│                               │  ──────────────────────────  │
│                               │  Why B is right: le texte    │
│                               │  examine l'évolution du…     │
│                               │  Why A is wrong: aucun lieu  │
│                               │  précis n'est décrit…        │
│                               │                              │
│  [ scrollable ▲▼ ]            │        [ Next question ]     │
└───────────────────────────────┴──────────────────────────────┘
```

---

## 5. Reading Quiz — Real mode

> spec: reading-quiz-ui.md §Layout.6, §Real mode.14–17 · quiz-session.md §Real mode.8–12

Header shows a countdown timer. Counter is `of 39`. No feedback; confirming auto-advances.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep      Reading · Real     ⏱ 47:12      Q3 of 39       │
├───────────────────────────────┬──────────────────────────────┤
│  PASSAGE                       │  Question 3                  │
│                               │  Quel est l'objectif          │
│  Le télétravail s'est imposé   │  principal du texte ?         │
│  dans de nombreuses entre-     │                              │
│  prises depuis 2020…           │  ( ) A  Décrire un lieu      │
│                               │  (•) B  Analyser une tend.   │
│                               │  ( ) C  Donner une recette   │
│                               │  ( ) D  Raconter un voyage   │
│                               │                              │
│                               │  [ Confirm answer ]          │
│                               │                              │
│  [ scrollable ▲▼ ]            │              [ Submit exam ] │
└───────────────────────────────┴──────────────────────────────┘
```

---

## 6. Listening Quiz — Learning mode

> spec: listening-quiz-ui.md §Layout.3–6, §Answering.7–10 · listening-player.md

Player with subtitle overlay sits above the question. Counter reflects band size.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep            Listening · Learning        Q2 of 6      │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ▶  ────●───────────────────────────  0:14 / 0:38       │  │
│  │                                                        │  │
│  │   « …je voudrais réserver une table pour ▸deux▸ … »    │  │
│  │     ↑ click a phrase to seek                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Question 2                                                  │
│  Combien de personnes ?                                      │
│                                                              │
│  ( ) A  Une          (•) B  Deux                             │
│  ( ) C  Trois        ( ) D  Quatre                           │
│                                                              │
│                                        [ Confirm answer ]    │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Results Summary — Learning mode

> spec: quiz-session.md §Results.13 (learning) · progress-tracking.md §Results summary.2

Learning shows **correct / total only** (no points) plus the band practised. No time taken.

```
┌──────────────────────────────────────────────────────────────┐
│                     Session complete                         │
│                                                              │
│              Reading · Learning                              │
│              Intermediate (Q11–19, 15 pts)                   │
│                                                              │
│                   7 / 9 correct                              │
│                                                              │
│        [ Review answers ]      [ Back to home ]              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Results Summary — Real mode

> spec: quiz-session.md §Results.13 (real), §Scoring.15–17 · progress-tracking.md §2

Real shows **points scored / 699**, correct count, and time taken.

```
┌──────────────────────────────────────────────────────────────┐
│                     Session complete                         │
│                                                              │
│              Reading · Real                                  │
│                                                              │
│                   387 / 699 points                           │
│                   28 / 39 correct                            │
│                   Completed in 43:12                         │
│                                                              │
│        [ Review answers ]      [ Back to home ]              │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Session History

> spec: progress-tracking.md §Session history.4–8

Most recent first. Learning rows show difficulty + correct/total, time as `—`.
Real rows show points + correct/total + time. Abandoned sessions are hidden.

```
┌──────────────────────────────────────────────────────────────┐
│  History                                          ← Home      │
├──────────────────────────────────────────────────────────────┤
│  Date        Section    Mode      Score        Correct  Time  │
│ ───────────────────────────────────────────────────────────  │
│  06-07 14:23 Reading    Real      387 / 699    28/39   43:12  │
│  06-07 11:02 Reading    Learning  Intermediate  7/9      —    │
│                                   (Q11–19,15pts)             │
│  06-06 19:40 Listening  Real      612 / 699    34/39   31:55  │
│  06-06 18:10 Listening  Learning  Expert        2/4      —    │
│                                   (Q36–39,33pts)             │
│ ───────────────────────────────────────────────────────────  │
│  ▸ click a row to open Review mode for that session          │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Review Mode

> spec: review-mode.md §Question review list.3–6, §Retry.7–10

Read-only. Each question shows the user's pick and the correct answer; learning sessions
show explanations. Retry is **grouped by difficulty band**.

```
┌──────────────────────────────────────────────────────────────┐
│  Review — Reading · Learning · Intermediate       ← Back      │
├──────────────────────────────────────────────────────────────┤
│  Question 1                                          ✓ correct │
│  Quel est l'objectif principal du texte ?                     │
│    ✗ A  Décrire un lieu                                       │
│    ✓ B  Analyser une tendance          ◄ your answer, correct │
│      C  Donner une recette                                   │
│      D  Raconter un voyage                                   │
│  ── Why B is right: le texte examine l'évolution du… ───────  │
│                                                              │
│  Question 2                                        ✗ incorrect │
│  D'après le texte, le télétravail… ?                          │
│    ✓ A  divise les avis           ◄ correct                   │
│    ✗ C  est obligatoire           ◄ your answer               │
│  ── Why A is right: « si certains… d'autres… » oppose deux…   │
│                                                              │
│ ───────────────────────────────────────────────────────────  │
│  Wrong answers by band:  Intermediate (1)                     │
│                              [ Retry Intermediate (1) ]       │
└──────────────────────────────────────────────────────────────┘
```

When wrong answers span multiple bands, one retry button per band is shown
(e.g. `Intermediate (3)` and `Advanced (1)`), each starting a separate learning session.

---

## 11. Writing — Setup (mode + task selection)

> spec: writing-ui.md §Entry & mode selection.1–3

Training exposes a single-task / all-three picker; Real always runs all three.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Canada Prep                                   ☰  History  │
├──────────────────────────────────────────────────────────────┤
│   Writing · Expression écrite                                 │
│   Three tasks, scored /20 with feedback from the local Claude.│
│                                                              │
│   Mode                                                       │
│   ┌──────────────────┐   ┌──────────────────┐                │
│   │ ▸ Training        │   │   Real           │                │
│   │ no timer · sample │   │ 60 min · 3 tasks │                │
│   │ answers · correct │   │ · no guidance    │                │
│   └──────────────────┘   └──────────────────┘                │
│                                                              │
│   Tasks  (Training only)                                     │
│   [ ▸ All three ] [ Task 1 ] [ Task 2 ] [ Task 3 ]           │
│                                                              │
│                                        [ Start writing ]     │
└──────────────────────────────────────────────────────────────┘
```

---

## 12. Writing — Training editor

> spec: writing-ui.md §Editor.5–8, §Training mode.9–11 · virtual-keyboard.md §Behaviour.1 (M12)

Per-task tabs (✓ = scored). Live word counter `current / target` (target = `minWords`).
Sample-answer / template panels and the accent keyboard (Milestone 12) appear here.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep      Writing · Training                  [ Finish ] │
├──────────────────────────────────────────────────────────────┤
│  [ ▸ Task 1 ✓ ] [ Task 2 ] [ Task 3 ]                         │
├───────────────────────────────┬──────────────────────────────┤
│  Task 1 · Message à un ami     │  33 / 60   [Correct][Submit] │
│  Un ami vous demande des       │  ┌────────────────────────┐  │
│  conseils sur les transports.  │  │ é è ê ë   à â ù û       │  │ ◄ accent
│  Répondez-lui.        (lang=fr)│  │ ô î ï ç   œ æ « »  ⇧abc │  │  keyboard
│                               │  └────────────────────────┘  │  (M12)
│  ▸ Sample answer        ▾      │  ┌────────────────────────┐  │
│  ▸ Answer template      ▾      │  │ Salut Pierre, je te     │  │
│                               │  │ conseille le métro…     │  │
│                               │  │              (lang=fr)  │  │
│                               │  └────────────────────────┘  │
│                               │  ── Score 14 / 20 · NCLC 8 ─ │
│                               │  Strengths: clear structure  │
│                               │  Errors: a few agreements    │
│                               │  Improvements: vary linkers  │
└───────────────────────────────┴──────────────────────────────┘
```

`Get correction` renders corrected text + suggestions inline (training only).
`Submit for score` may be re-run after editing; the displayed result updates.

---

## 13. Writing — Real mode

> spec: writing-ui.md §Real mode.13–15

Single 60-minute countdown across all three tasks. No sample answer / template /
correction. The accent keyboard stays (the real TCF software provides it).

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep   Writing · Real    ⏱ 58:41        [ Submit exam ]  │
├──────────────────────────────────────────────────────────────┤
│  [ ▸ Task 1 ] [ Task 2 ] [ Task 3 ]                           │
├───────────────────────────────┬──────────────────────────────┤
│  Task 1 · Message à un ami     │  47 / 60                     │
│  Un ami vous demande des       │  ┌────────────────────────┐  │
│  conseils…            (lang=fr)│  │ é è ê ë   à â ù û       │  │
│                               │  │ ô î ï ç   œ æ « »  ⇧abc │  │
│  (no guidance in real mode)    │  └────────────────────────┘  │
│                               │  ┌────────────────────────┐  │
│                               │  │ Salut Pierre, …         │  │
│                               │  └────────────────────────┘  │
└───────────────────────────────┴──────────────────────────────┘
```

---

## 14. Writing — Results

> spec: writing-ui.md §Results.16–17 · progress-tracking.md §Writing & speaking sessions

Overall average /20 + tasks submitted; per-task score + NCLC. An unanswered task
shows `—` / not submitted. Reachable read-only via `GET /api/writing/sessions/:id`.

```
┌──────────────────────────────────────────────────────────────┐
│                     ✓ Writing complete                        │
│                                                              │
│                         12 / 20                              │
│            average · 2 / 3 tasks submitted · 41:12           │
│ ───────────────────────────────────────────────────────────  │
│   Task 1 · Message            NCLC 8              14 / 20     │
│   Task 2 · Récit              NCLC 6              11 / 20     │
│   Task 3 · Opinion            not submitted          —       │
│ ───────────────────────────────────────────────────────────  │
│                       [ Back to home ]                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 15. Speaking — Setup (mode + task selection)

> spec: speaking-ui.md §Entry & mode selection.1–4

Same shape as Writing setup. Real mode uses per-task TCF prep + recording limits.

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Canada Prep                                   ☰  History  │
├──────────────────────────────────────────────────────────────┤
│   Speaking · Expression orale                                 │
│   Record in-browser → transcribed (Whisper) + scored (Claude).│
│                                                              │
│   Mode                                                       │
│   ┌──────────────────┐   ┌──────────────────┐                │
│   │ ▸ Training        │   │   Real           │                │
│   │ no timer · sample │   │ per-task prep +  │                │
│   │ answers · correct │   │ record limits    │                │
│   └──────────────────┘   └──────────────────┘                │
│                                                              │
│   Tasks  (Training only)                                     │
│   [ ▸ All three ] [ Task 1 ] [ Task 2 ] [ Task 3 ]           │
│                                                              │
│                                       [ Start speaking ]     │
└──────────────────────────────────────────────────────────────┘
```

---

## 16. Speaking — Training recorder

> spec: speaking-ui.md §Recorder.5–7, §Training mode.8–11

Record / stop / local playback / re-record; the take uploads and a transcript
appears. Training adds a sample answer, "Get correction", and "Submit for score".

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep      Speaking · Training                 [ Finish ] │
├──────────────────────────────────────────────────────────────┤
│  [ ▸ Task 1 ✓ ] [ Task 2 ] [ Task 3 ]                         │
├──────────────────────────────────────────────────────────────┤
│  Task 1                                                      │
│  Présentez-vous : parlez de votre travail…       (lang=fr)   │
│                                                              │
│  [ ● Record ]   ▶ ──●──── 0:14   (Re-record)                 │
│                                                              │
│  Transcript                                                  │
│  « Bonjour, je m'appelle Camille, je travaille… » (lang=fr)  │
│                                                              │
│  [ Get correction ]               [ Submit for score ]       │
│                                                              │
│  ▸ Sample answer  ▾                                          │
│  ── Score 15 / 20 · NCLC 8 ───────────────────────────────   │
│  Strengths: fluent, good range  ·  Errors: gender slips      │
│  Improvements: use more connectors                           │
└──────────────────────────────────────────────────────────────┘
```

`Get correction` returns a corrected transcript + suggestions (ephemeral, training
only). A `TRANSCRIPTION_FAILED` upload keeps the local take and offers a retry.

---

## 17. Speaking — Real mode (prep → record, auto-advance)

> spec: speaking-ui.md §Real mode.12–14 · speaking-session.md §Configuration.18

One task at a time. A prep countdown (recording disabled) is followed by a recording
countdown; recording auto-starts when prep ends and auto-stops at zero, then uploads
and advances. No sample answer / correction. (Task 1 has prepSeconds = 0.)

```
  Phase 1 — Preparation (recording disabled)
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep   Speaking · Real   Task 2 · Preparation     ⏱ 1:48 │
├──────────────────────────────────────────────────────────────┤
│  Task 2                                                      │
│  Vous appelez une école pour vous inscrire…      (lang=fr)   │
│                                                              │
│  Prepare your answer. Recording starts automatically when    │
│  the timer ends.                                             │
│  [ ● Record ]  ◄ disabled during prep                        │
└──────────────────────────────────────────────────────────────┘
        │  prep timer → 0:00  → recording starts automatically
        ▼
  Phase 2 — Recording (auto-stops at 0:00, user may stop early)
┌──────────────────────────────────────────────────────────────┐
│  TCF Prep   Speaking · Real   Task 2 · Recording       ⏱ 3:29 │
├──────────────────────────────────────────────────────────────┤
│  Task 2                                                      │
│  Vous appelez une école…                         (lang=fr)   │
│                                                              │
│  ● Recording — stops automatically at 0:00                   │
│  [ ■ Stop recording ]                                        │
└──────────────────────────────────────────────────────────────┘
        │  stop  →  "Transcribing…"  →  auto-advance to Task 3
        ▼
```

---

## 18. Speaking — Results (read-only review with playback)

> spec: speaking-ui.md §Results.15–16 · progress-tracking.md §Writing & speaking sessions

Overall average /20 + tasks submitted; per task: streamed audio playback, transcript,
score /20 + NCLC + feedback. Training review also shows the sample answer; real does not.

```
┌──────────────────────────────────────────────────────────────┐
│                    ✓ Speaking complete                        │
│                         13 / 20                              │
│            average · 3 / 3 tasks submitted · 9:42            │
│ ───────────────────────────────────────────────────────────  │
│   Task 1                       NCLC 8             15 / 20     │
│   Task 2                       NCLC 6             11 / 20     │
│   Task 3                       NCLC 7             13 / 20     │
│ ───────────────────────────────────────────────────────────  │
│   Task 1   ▶ ──●────── 0:18                                  │
│            « Bonjour, je m'appelle… »            (lang=fr)   │
│            Strengths / Errors / Improvements                 │
│                       [ Back to home ]                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 19. On-screen virtual keyboard (French accents) · Milestone 12

> spec: virtual-keyboard.md §Behaviour.4–5

The exact 16-key 4×4 grid of the real TCF software plus a `⇧ abc` shift toggle,
rendered as a compact toolbar above each Writing textarea (see mockups 12–13).
Clicking inserts the glyph at the caret and returns focus to the textarea.

```
┌─────────────────────────────┐
│   é    è    ê    ë           │
│   à    â    ù    û           │
│   ô    î    ï    ç           │
│   œ    æ    «    »           │
│  [  ⇧ abc  ]                 │   ◄ shift → uppercase
└─────────────────────────────┘
```

`⇧ abc` toggles the 14 letter keys to `É È Ê Ë À Â Ù Û Ô Î Ï Ç Œ Æ`; the
guillemets `«` `»` are unaffected. Inserted text updates the word count and
autosaves exactly like typed input.

---

## 20. Unified section navigation · Milestone 12

> spec: section-navigation.md §Behaviour.1–6

All four sections selectable from the landing screen and a persistent top menu
(plus History + Question Bank). Consistent order/labels everywhere; the active
section is highlighted in the menu; a section with no content shows an empty state.

```
┌──────────────────────────────────────────────────────────────┐
│ TCF Canada Prep   Reading Listening Writing Speaking │ Hist QB │ ◄ persistent
├──────────────────────────────────────────────────────────────┤   top menu
│   Choose a section                                            │
│   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│   │ Reading   │ │ Listening │ │ Writing   │ │ Speaking  │    │
│   │ MCQ on a  │ │ MCQ on an │ │ 3 written │ │ 3 spoken  │    │
│   │ passage   │ │ audio clip│ │ tasks /20 │ │ tasks /20 │    │
│   └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
│                                                              │
│   ▸ a section with no imported content → "No content yet"    │
└──────────────────────────────────────────────────────────────┘
```

The in-session header (timer / progress) is unchanged; this is the landing /
section-select chrome and the per-section "Home" affordance returns to it.

---

## Revision history

- 2026-06-07: Initial mockups for setup, reading/listening quiz, results, history, review
- 2026-06-18: Added Writing (Milestone 10) and Speaking (Milestone 11) mockups — setup, training
  editor/recorder, real mode, results — and Milestone 12 mockups for the on-screen French-accent
  keyboard (writing editor integration) and the unified four-section navigation.
