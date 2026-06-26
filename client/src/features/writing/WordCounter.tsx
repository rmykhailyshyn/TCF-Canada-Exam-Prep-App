// spec: docs/specs/writing-ui.md §Editor.6 — live `current / target` counter (target = minWords).
type Props = {
  count: number;
  minWords: number | null;
  maxWords: number | null;
};

export function WordCounter({ count, minWords, maxWords }: Props): JSX.Element {
  const under = minWords != null && count < minWords;
  const over = maxWords != null && count > maxWords;
  const tone = over
    ? "bg-red-50 text-red-700 ring-red-200"
    : under
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ring-1 ${tone}`}
      aria-label="Word count"
    >
      {minWords != null ? (
        <>
          {count} / {minWords}
          {over && <span className="font-medium"> · over {maxWords}</span>}
        </>
      ) : (
        <>{count} words</>
      )}
    </span>
  );
}
