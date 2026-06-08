import { useState } from 'react';
import type { DifficultySlug, Mode } from '../../lib/api';
import { DIFFICULTY_BANDS } from '../../lib/bands';
import type { SessionConfig } from './types';

// spec: docs/specs/reading-quiz-ui.md §Session setup.1–2
// Choose section + mode (+ difficulty in learning). Start is disabled until the selection is
// complete. Only Reading is wired up in Milestone 2; Listening is shown but disabled.

type Props = { onStart: (config: SessionConfig) => void };

export function SetupScreen({ onStart }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultySlug | null>(null);

  const canStart = mode === 'real' || (mode === 'learning' && difficulty !== null);

  function start(): void {
    if (!mode) return;
    onStart({ section: 'reading', mode, difficulty: mode === 'learning' ? difficulty! : undefined });
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Start a session</h1>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Section</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Card selected title="Reading" subtitle="Compréhension écrite" />
          <Card disabled title="Listening" subtitle="Coming soon" />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Mode</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Card
            selected={mode === 'learning'}
            onClick={() => setMode('learning')}
            title="Learning"
            subtitle="No timer · feedback after each question"
          />
          <Card
            selected={mode === 'real'}
            onClick={() => {
              setMode('real');
              setDifficulty(null);
            }}
            title="Real"
            subtitle="60 min · 39 questions · no feedback"
          />
        </div>
      </section>

      {mode === 'learning' && (
        <section className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Difficulty</h2>
          <div className="mt-2 space-y-2">
            {DIFFICULTY_BANDS.map((band) => (
              <button
                key={band.slug}
                type="button"
                onClick={() => setDifficulty(band.slug)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  difficulty === band.slug
                    ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className="font-medium text-slate-900">{band.name}</span>
                <span className="text-sm text-slate-500">
                  {band.range} · {band.points} pts
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          disabled={!canStart}
          onClick={start}
          className="rounded-xl bg-sky-600 px-6 py-2.5 font-medium text-white transition enabled:hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Start
        </button>
      </div>
    </div>
  );
}

type CardProps = {
  title: string;
  subtitle: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function Card({ title, subtitle, selected, disabled, onClick }: CardProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
          : 'border-slate-200 bg-white hover:border-slate-300'
      } ${disabled ? 'cursor-not-allowed opacity-50 hover:border-slate-200' : ''}`}
    >
      <div className="font-medium text-slate-900">{title}</div>
      <div className="text-sm text-slate-500">{subtitle}</div>
    </button>
  );
}
