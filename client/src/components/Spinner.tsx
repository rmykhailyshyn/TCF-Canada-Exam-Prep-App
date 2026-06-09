// Shared loading spinner: a brand-tinted ring used in session-loading states.

type Props = { label?: string };

export function Spinner({ label = 'Loading…' }: Props): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 text-slate-500" role="status">
      <span
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600"
        aria-hidden
      />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
