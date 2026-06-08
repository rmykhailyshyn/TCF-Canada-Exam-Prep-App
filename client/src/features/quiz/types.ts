import type { DifficultySlug, Mode, Section } from '../../lib/api';

// spec: docs/specs/reading-quiz-ui.md §Session setup
// The user's chosen session parameters, produced by the setup screen and consumed by the hook.
export type SessionConfig = {
  section: Section;
  mode: Mode;
  difficulty?: DifficultySlug;
};
