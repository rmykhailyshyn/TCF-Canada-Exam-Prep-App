import type { DifficultySlug, Mode, Section } from "../../lib/api";

// spec: docs/specs/reading-quiz-ui.md §Session setup
// The user's chosen session parameters, produced by the setup screen and consumed by the hook.
// spec: docs/specs/review-mode.md §Behaviour.8 — a retry carries the band's incorrect `questionIds`.
export type SessionConfig = {
  section: Section;
  mode: Mode;
  difficulty?: DifficultySlug;
  questionIds?: number[];
};
