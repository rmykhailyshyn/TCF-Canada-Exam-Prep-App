import { useState } from 'react';
import type { ReactNode } from 'react';
import type { WritingMode } from '../../lib/api';
import type { WritingConfig } from './types';

// spec: docs/specs/writing-ui.md §Entry & mode selection (Behaviour.2–3)
// Training (untimed, guidance + correction) or Real (single 60-min budget, all three tasks). In
// training the user practises a single task or all three.

type Props = { onStart: (config: WritingConfig) => void };

type TaskChoice = 'all' | 1 | 2 | 3;

export function WritingSetup({ onStart }: Props): JSX.Element {
  const [mode, setMode] = useState<WritingMode | null>(null);
  const [taskChoice, setTaskChoice] = useState<TaskChoice>('all');

  function start(): void {
    if (!mode) return;
    const taskNumbers = mode === 'learning' && taskChoice !== 'all' ? [taskChoice] : undefined;
    onStart({ mode, taskNumbers });
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-in-up px-6 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Writing · Expression écrite</h1>
      <p className="mt-2 text-slate-500">
        Three tasks, scored out of 20 with feedback from the local Claude CLI.
      </p>

      <section className="mt-9">
        <Label>Mode</Label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Card
            selected={mode === 'learning'}
            onClick={() => setMode('learning')}
            icon="🧠"
            title="Training"
            subtitle="No timer · sample answers · on-request correction"
          />
          <Card
            selected={mode === 'real'}
            onClick={() => setMode('real')}
            icon="⏱️"
            title="Real"
            subtitle="60 min · all 3 tasks · no guidance"
          />
        </div>
      </section>

      {mode === 'learning' && (
        <section className="mt-7 animate-fade-in">
          <Label>Tasks</Label>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {(['all', 1, 2, 3] as TaskChoice[]).map((choice) => (
              <Card
                key={String(choice)}
                selected={taskChoice === choice}
                onClick={() => setTaskChoice(choice)}
                title={choice === 'all' ? 'All three' : `Task ${choice}`}
                subtitle={choice === 'all' ? '1 · 2 · 3' : ' '}
              />
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          disabled={!mode}
          onClick={start}
          className="rounded-xl bg-brand-600 px-7 py-3 font-semibold text-white shadow-brand-glow transition enabled:hover:bg-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          Start writing
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</h2>
  );
}

type CardProps = {
  title: string;
  subtitle: string;
  icon?: string;
  selected?: boolean;
  onClick?: () => void;
};

function Card({ title, subtitle, icon, selected, onClick }: CardProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition ${
        selected
          ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
          : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card'
      }`}
    >
      <div className="flex items-center gap-2">
        {icon && (
          <span aria-hidden className="text-lg">
            {icon}
          </span>
        )}
        <span className={`font-semibold ${selected ? 'text-brand-900' : 'text-slate-900'}`}>
          {title}
        </span>
      </div>
      <div className={`mt-1 text-sm ${selected ? 'text-brand-700/80' : 'text-slate-500'}`}>
        {subtitle}
      </div>
    </button>
  );
}
