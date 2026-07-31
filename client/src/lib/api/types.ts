// spec: docs/specs/quiz-session.md §API contract
// Vocabulary shared by every endpoint group (sessions, questions, export/import, writing, speaking).

export type OptionLabel = "A" | "B" | "C" | "D";
export type Section = "reading" | "listening";
export type Mode = "learning" | "real";
export type DifficultySlug =
  | "beginner"
  | "elementary"
  | "intermediate"
  | "upper-intermediate"
  | "advanced"
  | "expert";

export type Explanation = {
  correctReason: string;
  optionAReason: string;
  optionBReason: string;
  optionCReason: string;
  optionDReason: string;
};
