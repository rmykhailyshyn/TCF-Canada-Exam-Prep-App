import type { OptionLabel } from "../../lib/api";

// spec: docs/specs/reading-quiz-ui.md §Answering.8 + §Learning mode feedback.11
// One selectable answer row. Visual state reflects pending selection (real + learning) and,
// after confirming in learning mode, the correct/incorrect highlight.

export type OptionState = "idle" | "selected" | "correct" | "wrong" | "dimmed";

type Props = {
  label: OptionLabel;
  text: string;
  state: OptionState;
  disabled: boolean;
  onClick: () => void;
};

const STATE_STYLES: Record<OptionState, string> = {
  idle: "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40 enabled:hover:shadow-card",
  selected: "border-brand-500 bg-brand-50 ring-1 ring-brand-500 shadow-card",
  correct: "border-green-500 bg-green-50 ring-1 ring-green-500",
  wrong: "border-red-500 bg-red-50 ring-1 ring-red-500",
  dimmed: "border-slate-200 bg-white opacity-55",
};

const BADGE_STYLES: Record<OptionState, string> = {
  idle: "bg-slate-100 text-slate-600",
  selected: "bg-brand-600 text-white",
  correct: "bg-green-600 text-white",
  wrong: "bg-red-600 text-white",
  dimmed: "bg-slate-100 text-slate-500",
};

export function OptionRow({
  label,
  text,
  state,
  disabled,
  onClick,
}: Props): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition enabled:active:scale-[0.99] disabled:cursor-default ${STATE_STYLES[state]}`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-bold transition ${BADGE_STYLES[state]}`}
      >
        {label}
      </span>
      <span className="pt-0.5 text-slate-900">
        {text ? (
          <span lang="fr">{text}</span>
        ) : (
          <span className="italic text-slate-400">(audio option)</span>
        )}
      </span>
      {state === "correct" && (
        <span className="ml-auto pt-0.5 text-lg leading-none text-green-600">
          ✓
        </span>
      )}
      {state === "wrong" && (
        <span className="ml-auto pt-0.5 text-lg leading-none text-red-600">
          ✗
        </span>
      )}
    </button>
  );
}
