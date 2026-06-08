import type { LearningAnswerResult, Mode, OptionLabel, SessionQuestion } from '../../lib/api';
import { OptionRow, type OptionState } from './OptionRow';

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
};

function optionState(
  label: OptionLabel,
  selectedLabel: OptionLabel | null,
  feedback: LearningAnswerResult | null,
): OptionState {
  if (feedback) {
    if (label === feedback.correctLabel) return 'correct';
    if (label === selectedLabel) return 'wrong';
    return 'dimmed';
  }
  return label === selectedLabel ? 'selected' : 'idle';
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
}: Props): JSX.Element {
  const answered = feedback !== null;

  return (
    <div className="flex h-full flex-col">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
        Question {question.sequence}
      </h2>
      <p className="mt-1 text-lg text-slate-900">{question.text}</p>

      <div className="mt-4 space-y-2">
        {question.options.map((opt) => (
          <OptionRow
            key={opt.label}
            label={opt.label}
            text={opt.text}
            state={optionState(opt.label, selectedLabel, feedback)}
            disabled={answered || submitting}
            onClick={() => onSelect(opt.label)}
          />
        ))}
      </div>

      {feedback && (
        <p
          className={`mt-4 font-medium ${feedback.isCorrect ? 'text-green-700' : 'text-red-700'}`}
        >
          {feedback.isCorrect ? 'Correct!' : `Incorrect — the answer is ${feedback.correctLabel}.`}
        </p>
      )}

      {feedback?.explanation && <Explanation explanation={feedback.explanation} />}

      <div className="mt-6 flex justify-end">
        {answered ? (
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-sky-600 px-6 py-2.5 font-medium text-white transition hover:bg-sky-700"
          >
            Next question
          </button>
        ) : (
          <button
            type="button"
            disabled={selectedLabel === null || submitting}
            onClick={onConfirm}
            className="rounded-xl bg-sky-600 px-6 py-2.5 font-medium text-white transition enabled:hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {mode === 'real' ? 'Confirm & next' : 'Confirm answer'}
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
  explanation: NonNullable<LearningAnswerResult['explanation']>;
}): JSX.Element {
  const reasons: { label: OptionLabel; text: string }[] = [
    { label: 'A', text: explanation.optionAReason },
    { label: 'B', text: explanation.optionBReason },
    { label: 'C', text: explanation.optionCReason },
    { label: 'D', text: explanation.optionDReason },
  ];
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <p className="font-medium text-slate-900">{explanation.correctReason}</p>
      <ul className="mt-2 space-y-1 text-slate-600">
        {reasons.map((r) => (
          <li key={r.label}>
            <span className="font-semibold">{r.label}:</span> {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
