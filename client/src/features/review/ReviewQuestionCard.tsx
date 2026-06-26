import type { OptionLabel, QuestionResultRow } from "../../lib/api";
import { OptionRow, type OptionState } from "../quiz/OptionRow";

// spec: docs/specs/review-mode.md §Behaviour.4–6
// One reviewed question: text (+ passage excerpt for reading), all four options with the correct
// option marked green and the user's wrong choice marked red, and — in learning mode — the
// explanation. Read-only: every option is disabled (Behaviour.2).

type Props = {
  index: number;
  result: QuestionResultRow;
  showExplanation: boolean;
};

// spec: docs/specs/review-mode.md §Behaviour.4 — correct option always green; the user's choice red
// when wrong (a correct choice is already green); every other option de-emphasised.
function optionState(
  label: OptionLabel,
  result: QuestionResultRow,
): OptionState {
  if (label === result.correctLabel) return "correct";
  if (label === result.chosenLabel) return "wrong";
  return "dimmed";
}

export function ReviewQuestionCard({
  index,
  result,
  showExplanation,
}: Props): JSX.Element {
  const explanation = result.explanation;
  const reasonByLabel: Record<OptionLabel, string> | null = explanation
    ? {
        A: explanation.optionAReason,
        B: explanation.optionBReason,
        C: explanation.optionCReason,
        D: explanation.optionDReason,
      }
    : null;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Question {index + 1}
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            result.isCorrect
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {result.isCorrect ? "Correct" : "Incorrect"}
        </span>
      </div>

      {result.passage && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
          {result.passage.text}
        </div>
      )}

      <p className="mt-3 font-medium text-slate-900">{result.text}</p>

      <div className="mt-4 space-y-2">
        {result.options.map((o) => (
          <OptionRow
            key={o.label}
            label={o.label}
            text={o.text}
            state={optionState(o.label, result)}
            disabled
            onClick={() => {}}
          />
        ))}
      </div>

      {showExplanation && explanation && reasonByLabel && (
        <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-700">
            Explanation
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            {explanation.correctReason}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
            {result.options.map((o) => (
              <li key={o.label}>
                <span className="font-semibold text-slate-800">{o.label}.</span>{" "}
                {reasonByLabel[o.label]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
