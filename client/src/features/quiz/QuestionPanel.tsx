import type {
  LearningAnswerResult,
  Mode,
  OptionLabel,
  SessionQuestion,
} from "../../lib/api";
import { OptionRow, type OptionState } from "./OptionRow";

// spec: docs/specs/reading-quiz-ui.md §Answering + §Learning mode feedback
// Renders the question, its four options (with the correct/incorrect highlight after a learning
// answer), the LLM explanation when present, and the confirm / next action.

type Props = {
  question: SessionQuestion;
  mode: Mode;
  selectedLabel: OptionLabel | null;
  feedback: LearningAnswerResult | null;
  submitting: boolean;
  onSelect: (label: OptionLabel) => void;
  onConfirm: () => void;
  onNext: () => void;
  // spec: docs/specs/listening-player.md §Behaviour.1 — options stay locked until audio loads.
  locked?: boolean;
};

function optionState(
  label: OptionLabel,
  selectedLabel: OptionLabel | null,
  feedback: LearningAnswerResult | null,
): OptionState {
  if (feedback) {
    if (label === feedback.correctLabel) return "correct";
    if (label === selectedLabel) return "wrong";
    return "dimmed";
  }
  return label === selectedLabel ? "selected" : "idle";
}

export function QuestionPanel({
  question,
  mode,
  selectedLabel,
  feedback,
  submitting,
  onSelect,
  onConfirm,
  onNext,
  locked = false,
}: Props): JSX.Element {
  const answered = feedback !== null;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        Question {question.sequence}
      </h2>
      <p
        lang="fr"
        className="mt-1.5 text-lg font-medium leading-snug text-slate-900"
      >
        {question.text}
      </p>

      <div className="mt-5 space-y-2.5">
        {question.options.map((opt) => (
          <OptionRow
            key={opt.label}
            label={opt.label}
            text={opt.text}
            state={optionState(opt.label, selectedLabel, feedback)}
            disabled={answered || submitting || locked}
            onClick={() => onSelect(opt.label)}
          />
        ))}
      </div>

      {feedback && (
        <div
          className={`mt-5 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium animate-scale-in ${
            feedback.isCorrect
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <span
            className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm font-bold text-white ${
              feedback.isCorrect ? "bg-green-600" : "bg-red-600"
            }`}
            aria-hidden
          >
            {feedback.isCorrect ? "✓" : "✗"}
          </span>
          {feedback.isCorrect
            ? "Correct!"
            : `Incorrect — the answer is ${feedback.correctLabel}.`}
        </div>
      )}

      {feedback?.explanation && (
        <Explanation explanation={feedback.explanation} />
      )}

      <div className="mt-6 flex justify-end">
        {answered ? (
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-brand-glow transition hover:bg-brand-700 active:scale-[0.98]"
          >
            Next question
          </button>
        ) : (
          <button
            type="button"
            disabled={selectedLabel === null || submitting || locked}
            onClick={onConfirm}
            className="rounded-xl bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-brand-glow transition enabled:hover:bg-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {mode === "real" ? "Confirm & next" : "Confirm answer"}
          </button>
        )}
      </div>
    </div>
  );
}

// spec: docs/specs/reading-quiz-ui.md §Learning mode feedback.12 — explanation below options.
function Explanation({
  explanation,
}: {
  explanation: NonNullable<LearningAnswerResult["explanation"]>;
}): JSX.Element {
  const reasons: { label: OptionLabel; text: string }[] = [
    { label: "A", text: explanation.optionAReason },
    { label: "B", text: explanation.optionBReason },
    { label: "C", text: explanation.optionCReason },
    { label: "D", text: explanation.optionDReason },
  ];
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm animate-fade-in">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">
        Explanation
      </p>
      <p className="mt-2 font-medium text-slate-900">
        {explanation.correctReason}
      </p>
      <ul className="mt-3 space-y-1.5 text-slate-600">
        {reasons.map((r) => (
          <li key={r.label} className="flex gap-2">
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
              {r.label}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
