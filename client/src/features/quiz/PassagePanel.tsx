import type { SessionQuestion } from '../../lib/api';

// spec: docs/specs/reading-quiz-ui.md §Layout.3–4 — passage on the left/top, scrollable
// independently of the question panel.
type Props = { passage: SessionQuestion['passage'] };

export function PassagePanel({ passage }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">Passage</h2>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
        {passage ? (
          <p className="whitespace-pre-line leading-relaxed text-slate-800">{passage.text}</p>
        ) : (
          <p className="italic text-slate-400">No passage for this question.</p>
        )}
      </div>
    </div>
  );
}
