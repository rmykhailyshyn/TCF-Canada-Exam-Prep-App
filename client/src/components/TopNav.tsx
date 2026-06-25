import { useNavigate } from "react-router-dom";
import { BrandMark } from "./BrandMark";

// spec: docs/specs/section-navigation.md §Behaviour.2,4,6 — a persistent top menu with quick links to
// all four sections (consistent order/labels) plus History and Question Bank, indicating the active
// section. Rendered on the landing/setup chrome (not over an in-session header).

export type NavKey =
  | "reading"
  | "listening"
  | "writing"
  | "speaking"
  | "history"
  | "questionBank";

// spec: §Behaviour.6 — the four sections always appear in this order, here and in the landing picker.
const SECTIONS: { key: NavKey; label: string }[] = [
  { key: "reading", label: "Reading" },
  { key: "listening", label: "Listening" },
  { key: "writing", label: "Writing" },
  { key: "speaking", label: "Speaking" },
];

const EXTRAS: { key: NavKey; label: string }[] = [
  { key: "history", label: "History" },
  { key: "questionBank", label: "Question Bank" },
];

type Props = { active?: NavKey };

export function TopNav({ active }: Props): JSX.Element {
  const navigate = useNavigate();

  // spec: §Behaviour.3 — route consistently to each section's existing setup/start. Reading/Listening
  // share the landing setup, so they go home with the section pre-selected via router state.
  function go(key: NavKey): void {
    switch (key) {
      case "reading":
      case "listening":
        navigate("/", { state: { section: key } });
        break;
      case "writing":
        navigate("/writing");
        break;
      case "speaking":
        navigate("/speaking");
        break;
      case "history":
        navigate("/history");
        break;
      case "questionBank":
        navigate("/question-bank");
        break;
    }
  }

  function linkClass(key: NavKey): string {
    return `text-sm transition ${
      active === key
        ? "font-semibold text-brand-700"
        : "text-sky-600 hover:text-sky-700"
    }`;
  }

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
      <button
        type="button"
        onClick={() => navigate("/")}
        aria-label="Home"
        className="text-left"
      >
        <BrandMark />
      </button>
      <nav aria-label="Sections" className="flex items-center gap-4">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => go(s.key)}
            aria-current={active === s.key ? "page" : undefined}
            className={linkClass(s.key)}
          >
            {s.label}
          </button>
        ))}
        <span className="text-slate-300" aria-hidden>
          |
        </span>
        {EXTRAS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => go(s.key)}
            aria-current={active === s.key ? "page" : undefined}
            className={linkClass(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
