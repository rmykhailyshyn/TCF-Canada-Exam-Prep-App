// Shared brand lockup: a small gradient logo glyph + wordmark, used in every app header.
// Keeps the identity consistent across the setup, reading, and listening shells.

type Props = {
  /** Secondary text shown after a separator, e.g. "Reading · Learning". */
  context?: string;
  /** Short wordmark; defaults to the full product name. */
  label?: string;
};

export function BrandMark({
  context,
  label = "TCF Canada Prep",
}: Props): JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-brand-glow"
      >
        TC
      </span>
      <span className="font-semibold tracking-tight text-slate-900">
        {label}
      </span>
      {context && (
        <>
          <span className="text-slate-300" aria-hidden>
            /
          </span>
          <span className="text-sm font-medium text-slate-500">{context}</span>
        </>
      )}
    </div>
  );
}
