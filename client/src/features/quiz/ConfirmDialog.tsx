// spec: docs/specs/reading-quiz-ui.md §Real mode.17 — confirmation dialog before early submit.
type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  return (
    <div className="fixed inset-0 z-20 flex animate-fade-in items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm animate-scale-in rounded-2xl border border-slate-200/60 bg-white p-6 shadow-card-hover">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-slate-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
