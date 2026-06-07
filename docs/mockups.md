# Mockups — Key Pages

Low-fidelity ASCII wireframes for the primary screens. These are visual references for the
specs in `docs/specs/`, not implementation. Each mockup cites the spec behaviour it reflects.

Legend: `(•)` selected radio · `( )` unselected · `[ Button ]` · `▸` active/highlighted ·
`✓` correct · `✗` incorrect.

---

## 1. Session Setup — mode selection
> spec: quiz-session.md §Mode selection.1–2 · reading-quiz-ui.md §Session setup.1–2

```
┌──────────────────────────────────────────────────────────────┐
│  TCF Canada Prep                                   ☰  History  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Start a session                                            │
│                                                              │
│   Section                                                    │
│   ┌──────────────────┐   ┌──────────────────┐                │
│   │ ▸ Reading        │   │   Listening      │                │
│   └──────────────────┘   └──────────────────┘                │
│                                                              │
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

## Revision history
- 2026-06-07: Initial mockups for setup, reading/listening quiz, results, history, review
