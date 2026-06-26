// Seeded listening data for the Beginner band (Q1–4), mirroring scripts/seed-listening-dev.ts.
// `correct`/`wrong` are option texts; `phrase2` is a unique substring of the 2nd transcript segment
// and `phrase2StartS` its start (seconds). Learning mode randomizes order, so tests identify which
// question is on screen by its unique correct option rather than assuming Q1 is first.
// spec: docs/specs/quiz-session.md §Question selection.21
export type ListeningQuestion = {
  correct: string;
  wrong: string;
  phrase2: string;
  phrase2StartS: number;
};

export const LISTENING_QUESTIONS: ListeningQuestion[] = [
  {
    correct: "À la gare",
    wrong: "Au restaurant",
    phrase2: "Mon train part dans dix minutes",
    phrase2StartS: 2.0,
  },
  {
    correct: "Vendredi",
    wrong: "Lundi",
    phrase2: "Nous nous voyons vendredi matin",
    phrase2StartS: 2.0,
  },
  {
    correct: "Un thé",
    wrong: "Un café",
    phrase2: "Je voudrais un thé",
    phrase2StartS: 1.8,
  },
  {
    correct: "Il fera beau",
    wrong: "Il pleuvra",
    phrase2: "Le ciel sera dégagé toute la journée",
    phrase2StartS: 2.0,
  },
];
