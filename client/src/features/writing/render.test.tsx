import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  Capabilities,
  WritingCompleteResult,
  WritingTask,
} from "../../lib/api";
import { CapabilitiesContext } from "../../lib/capabilities-context";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { VK_KEYS, computeInsertion, glyphFor } from "./vkKeys";
import { WordCounter } from "./WordCounter";
import { WritingEditor } from "./WritingEditor";
import { WritingResults } from "./WritingResults";
import { WritingSetup } from "./WritingSetup";
import { countWords } from "./types";
import type { WritingSession } from "./useWritingSession";

const tasks: WritingTask[] = [
  {
    taskId: 1,
    taskNumber: 1,
    title: "Message",
    prompt: "Écrivez un message à un ami.",
    instructions: null,
    minWords: 60,
    maxWords: 120,
    sampleAnswer: "Salut !",
    template: "- Salutation",
  },
];

const FULL_CAPS: Capabilities = {
  aiScoring: true,
  transcription: true,
  imports: true,
};

// Render a tree with a fixed capability context (the async provider effect doesn't run under SSR).
function renderWithCaps(node: JSX.Element, caps: Capabilities): string {
  return renderToStaticMarkup(
    <CapabilitiesContext.Provider value={caps}>
      {node}
    </CapabilitiesContext.Provider>,
  );
}

function fakeSession(overrides: Partial<WritingSession> = {}): WritingSession {
  return {
    status: "active",
    error: null,
    sessionId: 1,
    mode: "learning",
    tasks,
    drafts: { 1: "Bonjour mon ami" },
    counts: { 1: 3 },
    evaluations: {},
    corrections: {},
    busyTask: null,
    taskError: {},
    remainingMs: null,
    results: null,
    elapsedMs: null,
    setDraft: vi.fn(),
    saveNow: vi.fn(),
    submit: vi.fn(),
    correct: vi.fn(),
    finish: vi.fn(),
    submitExam: vi.fn(),
    ...overrides,
  };
}

describe("countWords", () => {
  it("counts whitespace-separated words and handles empties", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("un deux trois")).toBe(3);
    expect(countWords("  espacé   irrégulier ")).toBe(2);
  });
});

describe("WordCounter", () => {
  it("shows current / target using minWords as the target", () => {
    const html = renderToStaticMarkup(
      <WordCounter count={33} minWords={60} maxWords={120} />,
    );
    expect(html).toContain("33");
    expect(html).toContain("60");
  });

  it("flags exceeding the maximum", () => {
    const html = renderToStaticMarkup(
      <WordCounter count={130} minWords={60} maxWords={120} />,
    );
    expect(html).toContain("over 120");
  });
});

describe("WritingSetup", () => {
  it("offers Training and Real modes", () => {
    const html = renderToStaticMarkup(<WritingSetup onStart={vi.fn()} />);
    expect(html).toContain("Training");
    expect(html).toContain("Real");
    expect(html).toContain("Start writing");
  });
});

describe("WritingEditor", () => {
  it("renders the prompt, the draft, and training actions in training mode", () => {
    const html = renderWithCaps(
      <WritingEditor session={fakeSession()} />,
      FULL_CAPS,
    );
    expect(html).toContain("Écrivez un message à un ami.");
    expect(html).toContain("Bonjour mon ami");
    expect(html).toContain("Submit for score");
    expect(html).toContain("Get correction");
    expect(html).toContain('lang="fr"');
  });

  it("shows the countdown and hides guidance in real mode", () => {
    const html = renderWithCaps(
      <WritingEditor
        session={fakeSession({ mode: "real", remainingMs: 3_600_000 })}
      />,
      FULL_CAPS,
    );
    expect(html).toContain("Submit exam");
    expect(html).not.toContain("Get correction");
    expect(html).toContain("⏱");
  });

  // spec: docs/specs/content-deploy.md §Behaviour.4 — online (aiScoring=false) there is no
  // "Get correction" and the submit action is relabelled "Save & lock".
  it("hides Get correction and relabels submit when aiScoring is off", () => {
    const html = renderWithCaps(<WritingEditor session={fakeSession()} />, {
      aiScoring: false,
      transcription: false,
      imports: false,
    });
    expect(html).not.toContain("Get correction");
    expect(html).not.toContain("Submit for score");
    expect(html).toContain("Save &amp; lock");
  });
});

describe("VirtualKeyboard", () => {
  // spec: docs/specs/virtual-keyboard.md §Behaviour.4 — exact 16-key 4×4 grid + ⇧ abc toggle.
  it("renders the exact 16-key grid and the shift toggle", () => {
    const html = renderToStaticMarkup(
      <VirtualKeyboard textareaRef={createRef()} />,
    );
    for (const glyph of [
      "é",
      "è",
      "ê",
      "ë",
      "à",
      "â",
      "ù",
      "û",
      "ô",
      "î",
      "ï",
      "ç",
      "œ",
      "æ",
      "«",
      "»",
    ]) {
      expect(html).toContain(`Insert ${glyph}`);
    }
    expect(html).toContain("⇧ abc");
    expect(VK_KEYS).toHaveLength(16);
  });

  // spec: §Behaviour.4 — shift uppercases the 14 letter keys; guillemets are unaffected.
  it("maps letters to uppercase under shift and leaves guillemets unchanged", () => {
    expect(glyphFor({ lower: "é", upper: "É" }, true)).toBe("É");
    expect(glyphFor({ lower: "ç", upper: "Ç" }, true)).toBe("Ç");
    expect(glyphFor({ lower: "œ", upper: "Œ" }, true)).toBe("Œ");
    expect(glyphFor({ lower: "é", upper: "É" }, false)).toBe("é");
    // Guillemets have no `upper`, so shift does not change them.
    expect(glyphFor({ lower: "«" }, true)).toBe("«");
    expect(glyphFor({ lower: "»" }, true)).toBe("»");
  });

  // spec: §Behaviour.2 — caret-aware insertion replaces the selection and advances the caret.
  it("inserts at the caret and reports the new caret position", () => {
    expect(computeInsertion("abc", 1, 1, "é")).toEqual({
      value: "aébc",
      caret: 2,
    });
    // A selection [1,3) is replaced by the glyph.
    expect(computeInsertion("abc", 1, 3, "œ")).toEqual({
      value: "aœ",
      caret: 2,
    });
  });
});

describe("WritingResults", () => {
  it("renders the overall average and per-task scores", () => {
    const results: WritingCompleteResult = {
      tasks: [
        { taskNumber: 1, score: 14, level: "NCLC 8" },
        { taskNumber: 2, score: 12, level: "NCLC 7" },
        { taskNumber: 3, score: null, level: null },
      ],
      overallScore: 9,
      submitted: 2,
    };
    const html = renderToStaticMarkup(
      <WritingResults
        results={results}
        tasks={tasks}
        elapsedMs={null}
        onHome={vi.fn()}
      />,
    );
    expect(html).toContain("9");
    expect(html).toContain("14 / 20");
    expect(html).toContain("NCLC 8");
    expect(html).toContain("2 / 3 tasks submitted");
  });

  // spec: docs/specs/content-deploy.md §Behaviour.7 — a null overall score (online practice) renders
  // an unscored state rather than "0 / 20".
  it("renders an unscored practice state when overallScore is null", () => {
    const results: WritingCompleteResult = {
      tasks: [{ taskNumber: 1, score: null, level: null }],
      overallScore: null,
      submitted: 0,
    };
    const html = renderToStaticMarkup(
      <WritingResults
        results={results}
        tasks={tasks}
        elapsedMs={null}
        onHome={vi.fn()}
      />,
    );
    expect(html).toContain("Practice");
    expect(html).not.toContain("0 / 20");
    expect(html).toContain("—");
  });
});
