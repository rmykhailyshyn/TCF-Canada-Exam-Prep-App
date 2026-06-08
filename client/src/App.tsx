import { useEffect, useState } from 'react';

type HealthState = 'checking' | 'ok' | 'unreachable';

/**
 * Milestone 1 scaffold landing page. Confirms the client renders and that the
 * Express backend is reachable through the Vite /api proxy.
 */
function App() {
  const [health, setHealth] = useState<HealthState>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('bad status'))))
      .then((body: { data: { status: string } | null }) => {
        if (!cancelled) {
          setHealth(body.data?.status === 'ok' ? 'ok' : 'unreachable');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth('unreachable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl bg-white shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold">TCF Canada Exam Prep</h1>
        <p className="mt-2 text-slate-600">
          Local study app for the Reading and Listening sections.
        </p>
        <div className="mt-6 flex items-center gap-2 text-sm">
          <span className="text-slate-500">Backend:</span>
          <StatusBadge health={health} />
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ health }: { health: HealthState }) {
  const config: Record<HealthState, { label: string; className: string }> = {
    checking: { label: 'checking…', className: 'bg-slate-100 text-slate-600' },
    ok: { label: 'connected', className: 'bg-green-100 text-green-700' },
    unreachable: { label: 'unreachable', className: 'bg-red-100 text-red-700' },
  };
  const { label, className } = config[health];
  return <span className={`rounded-full px-2.5 py-0.5 font-medium ${className}`}>{label}</span>;
}

export default App;
