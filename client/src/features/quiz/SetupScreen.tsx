import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DifficultySlug, Mode, Section } from '../../lib/api';
import { DIFFICULTY_BANDS } from '../../lib/bands';
import type { SessionConfig } from './types';

// spec: docs/specs/reading-quiz-ui.md §Session setup.1–2 + docs/specs/listening-quiz-ui.md §1–2
// Choose section + mode (+ difficulty in learning). Start is disabled until the selection is
// complete. Both Reading and Listening sections are wired up as of Milestone 3.

type Props = { onStart: (config: SessionConfig) => void };

// Real-mode timing differs per section (reading 60 min, listening 35 min) — exam.config.json.
const REAL_SUBTITLE: Record<Section, string> = {
  reading: '60 min · 39 questions · no feedback',
  listening: '35 min · 39 questions · no feedback',
};

export function SetupScreen({ onStart }: Props): JSX.Element {
  const [section, setSection] = useState<Section>('reading');
  const [mode, setMode] = useState<Mode | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultySlug | null>(null);

  const canStart = mode === 'real' || (mode === 'learning' && difficulty !== null);

  function start(): void {
    if (!mode) return;
    onStart({ section, mode, difficulty: mode === 'learning' ? difficulty! : undefined });
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-in-up px-6 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Start a session</h1>
      <p className="mt-2 text-slate-500">
        Pick a section and a mode, then practise at your own pace or under exam conditions.
      </p>

      <section className="mt-9">
        <SectionLabel>Section</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Card
            selected={section === 'reading'}
            onClick={() => setSection('reading')}
            icon="📖"
            title="Reading"
            subtitle="Compréhension écrite"
          />
          <Card
            selected={section === 'listening'}
            onClick={() => setSection('listening')}
            icon="🎧"
            title="Listening"
            subtitle="Compréhension orale"
          />
        </div>
      </section>

      <section className="mt-7">
        <SectionLabel>Mode</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Card
            selected={mode === 'learning'}
            onClick={() => setMode('learning')}
            icon="🧠"
            title="Learning"
            subtitle="No timer · feedback after each question"
          />
          <Card
            selected={mode === 'real'}
            onClick={() => {
              setMode('real');
              setDifficulty(null);
            }}
            icon="⏱️"
            title="Real"
            subtitle={REAL_SUBTITLE[section]}
          />
        </div>
      </section>

      {mode === 'learning' && (
        <section className="mt-7 animate-fade-in">
          <SectionLabel>Difficulty</SectionLabel>
          <div className="mt-3 space-y-2">
            {DIFFICULTY_BANDS.map((band) => {
              const selected = difficulty === band.slug;
              return (
                <button
                  key={band.slug}
                  type="button"
                  onClick={() => setDifficulty(band.slug)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[11px] font-bold transition ${
                        selected
                          ? 'border-brand-500 bg-brand-500 text-white'
                          : 'border-slate-300 text-transparent'
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <span className="font-medium text-slate-900">{band.name}</span>
                  </span>
                  <span className="text-sm tabular-nums text-slate-500">
                    {band.range} · {band.points} pts
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          disabled={!canStart}
          onClick={start}
          className="rounded-xl bg-brand-600 px-7 py-3 font-semibold text-white shadow-brand-glow transition enabled:hover:bg-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          Start session
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</h2>
  );
}

type CardProps = {
  title: string;
  subtitle: string;
  icon?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function Card({ title, subtitle, icon, selected, disabled, onClick }: CardProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition ${
        selected
          ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
          : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card'
      } ${disabled ? 'cursor-not-allowed opacity-50 hover:translate-y-0 hover:border-slate-200 hover:shadow-none' : ''}`}
    >
      <div className="flex items-center gap-2">
        {icon && <span aria-hidden className="text-lg">{icon}</span>}
        <span
          className={`font-semibold ${selected ? 'text-brand-900' : 'text-slate-900'}`}
        >
          {title}
        </span>
      </div>
      <div className={`mt-1 text-sm ${selected ? 'text-brand-700/80' : 'text-slate-500'}`}>
        {subtitle}
      </div>
    </button>
  );
}
