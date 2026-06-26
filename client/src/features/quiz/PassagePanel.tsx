import { useState } from "react";
import type { SessionQuestion } from "../../lib/api";
import { passageImageUrl } from "../../lib/api";

// spec: docs/specs/reading-quiz-ui.md §Layout.3–4 + §Layout.3a–3c — the passage panel shows the
// original passage IMAGE on top and the OCR'd text directly below it, scrollable independently of
// the question panel. If the image can't be loaded (missing on disk), the panel degrades to
// text-only with no broken-image placeholder (Behaviour.3c). Keyed by question id in QuizScreen,
// so the failed-image state resets when the question changes.
type Props = { questionId: number; passage: SessionQuestion["passage"] };

export function PassagePanel({ questionId, passage }: Props): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        Passage
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
        {passage ? (
          <div className="space-y-4">
            {/* Original passage image on top; hidden if it fails to load (Behaviour.3a, 3c). */}
            {!imageFailed && (
              <img
                src={passageImageUrl(questionId)}
                alt="Original passage document"
                onError={() => setImageFailed(true)}
                className="w-full rounded-xl border border-slate-200/80"
              />
            )}
            {/* OCR'd text directly below the image (Behaviour.3a). French content → lang="fr". */}
            <p
              lang="fr"
              className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700"
            >
              {passage.text}
            </p>
          </div>
        ) : (
          <p className="italic text-slate-400">No passage for this question.</p>
        )}
      </div>
    </div>
  );
}
