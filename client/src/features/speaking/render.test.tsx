import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  Capabilities,
  SpeakingCompleteResult,
  SpeakingTask,
} from "../../lib/api";
import { CapabilitiesContext } from "../../lib/capabilities";
import { SpeakingResults } from "./SpeakingResults";
import { SpeakingSession } from "./SpeakingSession";
import { SpeakingSetup } from "./SpeakingSetup";
import type { SpeakingSession as SpeakingSessionState } from "./useSpeakingSession";

const tasks: SpeakingTask[] = [
  {
    taskId: 1,
    taskNumber: 1,
    question: "Présentez-vous.",
    sampleAnswer: "Bonjour !",
  },
  {
    taskId: 2,
    taskNumber: 2,
    question: "Renseignez-vous.",
    sampleAnswer: null,
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

function fakeSession(
  overrides: Partial<SpeakingSessionState> = {},
): SpeakingSessionState {
  return {
    status: "active",
    error: null,
    sessionId: 1,
    mode: "learning",
    tasks,
    timing: null,
    recordings: {},
    transcripts: { 1: "Bonjour, je m’appelle…" },
    evaluations: {},
    corrections: {},
    uploading: {},
    taskError: {},
    recordingTask: null,
    busyTask: null,
    micError: null,
    currentIndex: 0,
    realPhase: "prep",
    phaseRemainingMs: null,
    results: null,
    elapsedMs: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    submit: vi.fn(),
    correct: vi.fn(),
    finish: vi.fn(),
    submitExam: vi.fn(),
    ...overrides,
  };
}

describe("SpeakingSetup", () => {
  it("offers Training and Real modes", () => {
    const html = renderToStaticMarkup(<SpeakingSetup onStart={vi.fn()} />);
    expect(html).toContain("Training");
    expect(html).toContain("Real");
    expect(html).toContain("Start speaking");
  });
});

describe("SpeakingSession", () => {
  it("renders the question, transcript, and training actions in training mode", () => {
    const html = renderWithCaps(
      <SpeakingSession session={fakeSession()} />,
      FULL_CAPS,
    );
    expect(html).toContain("Présentez-vous.");
    expect(html).toContain("Submit for score");
    expect(html).toContain("Get correction");
    expect(html).toContain('lang="fr"');
  });

  it("shows the phase countdown and hides guidance in real mode", () => {
    const html = renderWithCaps(
      <SpeakingSession
        session={fakeSession({
          mode: "real",
          timing: [{ taskNumber: 1, prepSeconds: 0, recordSeconds: 120 }],
          realPhase: "recording",
          phaseRemainingMs: 120_000,
        })}
      />,
      FULL_CAPS,
    );
    expect(html).toContain("Submit exam");
    expect(html).not.toContain("Get correction");
    expect(html).toContain("⏱");
  });

  // spec: docs/specs/content-deploy.md §Behaviour.5 — online (transcription/aiScoring off) keeps
  // record + sample answer, but hides the transcript, correction and scoring affordances.
  it("hides transcript, correction and submit when capabilities are off", () => {
    const html = renderWithCaps(<SpeakingSession session={fakeSession()} />, {
      aiScoring: false,
      transcription: false,
      imports: false,
    });
    expect(html).toContain("Présentez-vous.");
    expect(html).toContain("Sample answer");
    expect(html).not.toContain("Transcript");
    expect(html).not.toContain("Get correction");
    expect(html).not.toContain("Submit for score");
  });
});

describe("SpeakingResults", () => {
  it("renders the overall average and per-task scores", () => {
    const results: SpeakingCompleteResult = {
      tasks: [
        { taskNumber: 1, score: 15, level: "NCLC 8" },
        { taskNumber: 2, score: 11, level: "NCLC 6" },
        { taskNumber: 3, score: null, level: null },
      ],
      overallScore: 9,
      submitted: 2,
    };
    const html = renderToStaticMarkup(
      <SpeakingResults results={results} elapsedMs={null} onHome={vi.fn()} />,
    );
    expect(html).toContain("9");
    expect(html).toContain("15 / 20");
    expect(html).toContain("NCLC 8");
    expect(html).toContain("2 / 3 tasks submitted");
  });

  // spec: docs/specs/content-deploy.md §Behaviour.7 — a null overall score (online practice) renders
  // an unscored state rather than "0 / 20".
  it("renders an unscored practice state when overallScore is null", () => {
    const results: SpeakingCompleteResult = {
      tasks: [{ taskNumber: 1, score: null, level: null }],
      overallScore: null,
      submitted: 0,
    };
    const html = renderToStaticMarkup(
      <SpeakingResults results={results} elapsedMs={null} onHome={vi.fn()} />,
    );
    expect(html).toContain("Practice");
    expect(html).not.toContain("0 / 20");
    expect(html).toContain("—");
  });
});
