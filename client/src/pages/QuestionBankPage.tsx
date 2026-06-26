import { useState } from "react";
import { TopNav } from "../components/TopNav";
import {
  ApiError,
  type DifficultyFilter,
  type DifficultySlug,
  type ExportDocument,
  type ImportSummary,
  type SectionFilter,
  fetchExport,
  importQuestions,
} from "../lib/api";
import { DIFFICULTY_BANDS } from "../lib/bands";
import { useCapabilities } from "../lib/capabilities-context";

// spec: docs/specs/question-export-import.md §Behaviour — the Question Bank page hosts an Export
// panel (section + complexity filters → downloaded JSON) and an Import panel (upload + override).

function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

// spec: docs/specs/question-export-import.md §Behaviour.5 — filename encodes section + complexity.
function exportFilename(doc: ExportDocument): string {
  const section = doc.filter.section;
  const complexity =
    doc.filter.difficulties === "all"
      ? "all"
      : doc.filter.difficulties.join("-");
  return `tcf-export-${section}-${complexity}-${todayStamp()}.json`;
}

function triggerDownload(doc: ExportDocument): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFilename(doc);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function QuestionBankPage(): JSX.Element {
  // spec: docs/specs/content-deploy.md §Behaviour.3 — import is a local/full-runtime capability;
  // online (imports=false) the import panel is hidden and replaced with an explanatory note. Export
  // (a pure read) always stays available.
  const { imports } = useCapabilities();
  return (
    <>
      {/* spec: section-navigation §Behaviour.2 — Question Bank is reachable via the persistent top menu.
          TopNav (a <header>/banner) sits outside <main> so its landmark role is preserved. */}
      <TopNav active="questionBank" />
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Question Bank
          </h1>
          <ExportPanel />
          {imports ? (
            <ImportPanel />
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Importing is only available in the local app.
            </p>
          )}
        </div>
      </main>
    </>
  );
}

// spec: docs/specs/question-export-import.md §Behaviour.1–6
function ExportPanel(): JSX.Element {
  const [section, setSection] = useState<SectionFilter>("all");
  // `null` = "All levels"; otherwise the explicit subset of selected band slugs.
  const [bands, setBands] = useState<DifficultySlug[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleBand(slug: DifficultySlug): void {
    setNotice(null);
    setBands((current) => {
      const base = current ?? [];
      const next = base.includes(slug)
        ? base.filter((s) => s !== slug)
        : [...base, slug];
      return next.length === 0 ? null : next;
    });
  }

  async function runExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const difficulties: DifficultyFilter = bands ?? "all";
    try {
      const doc = await fetchExport(section, difficulties);
      if (doc.questions.length === 0) {
        setNotice("No questions match this filter — nothing to export.");
        return;
      }
      triggerDownload(doc);
      setNotice(`Exported ${doc.questions.length} question(s).`);
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Export failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const sections: { value: SectionFilter; label: string }[] = [
    { value: "reading", label: "Reading" },
    { value: "listening", label: "Listening" },
    { value: "all", label: "Both" },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Export</h2>
      <p className="mt-1 text-sm text-slate-500">
        Download matching questions as a JSON file you can re-import later.
      </p>

      <Label>Section</Label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {sections.map((s) => (
          <Chip
            key={s.value}
            selected={section === s.value}
            onClick={() => setSection(s.value)}
          >
            {s.label}
          </Chip>
        ))}
      </div>

      <Label>Complexity</Label>
      <div className="mt-2 space-y-2">
        <Chip selected={bands === null} onClick={() => setBands(null)} full>
          All levels
        </Chip>
        <div className="grid grid-cols-2 gap-2">
          {DIFFICULTY_BANDS.map((band) => (
            <Chip
              key={band.slug}
              selected={bands?.includes(band.slug) ?? false}
              onClick={() => toggleBand(band.slug)}
            >
              {band.name}
            </Chip>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-4 text-sm text-slate-600">{notice}</p>}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={runExport}
          className="rounded-xl bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-brand-glow transition enabled:hover:bg-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {busy ? "Exporting…" : "Export"}
        </button>
      </div>
    </section>
  );
}

// spec: docs/specs/question-export-import.md §Behaviour.7–12
function ImportPanel(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function runImport(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const text = await file.text();
      let document: ExportDocument;
      try {
        document = JSON.parse(text) as ExportDocument;
      } catch {
        setError("Selected file is not valid JSON.");
        return;
      }
      const result = await importQuestions(document, override);
      setSummary(result);
    } catch (e) {
      setError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Import failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Import</h2>
      <p className="mt-1 text-sm text-slate-500">
        Upload a previously exported JSON file. Matching is by source file +
        sequence.
      </p>

      <Label>File</Label>
      <input
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setSummary(null);
          setError(null);
        }}
        className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
      />

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        Override existing questions
      </label>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {summary && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900">
            Processed {summary.total}: {summary.inserted} inserted ·{" "}
            {summary.overridden} overridden · {summary.skipped} skipped
          </p>
          {summary.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-700">
              {summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={busy || !file}
          onClick={runImport}
          className="rounded-xl bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-brand-glow transition enabled:hover:bg-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
      {children}
    </h3>
  );
}

function Chip({
  children,
  selected,
  onClick,
  full,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  full?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${full ? "w-full text-left" : "text-center"} ${
        selected
          ? "border-brand-500 bg-brand-50 text-brand-900 ring-1 ring-brand-500"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
