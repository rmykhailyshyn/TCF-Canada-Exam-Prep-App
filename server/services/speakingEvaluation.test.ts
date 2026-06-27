import { describe, expect, it } from "vitest";
import { ClaudeError } from "../lib/claude-cli";
import {
  buildCorrectionPrompt,
  buildScorePrompt,
  parseCorrectionResponse,
  parseScoreResponse,
} from "./speakingEvaluation";

describe("buildScorePrompt", () => {
  it("includes the task question and the transcript, and asks for a score", () => {
    const prompt = buildScorePrompt({
      taskNumber: 2,
      question: "Renseignez-vous sur un cours.",
      transcript: "Bonjour, je voudrais des informations…",
    });
    expect(prompt).toContain("Expression orale");
    expect(prompt).toContain("Renseignez-vous sur un cours.");
    expect(prompt).toContain("Bonjour, je voudrais des informations…");
    expect(prompt).toContain('"score"');
    expect(prompt).toContain("transcribed");
  });
});

describe("parseScoreResponse", () => {
  it("parses a valid object and clamps/rounds the score", () => {
    const result = parseScoreResponse(
      JSON.stringify({
        score: 13.4,
        strengths: "Fluent delivery.",
        errors: "Some gender errors.",
        improvements: "Use more connectors.",
      }),
    );
    expect(result.score).toBe(13);
    expect(result.feedback.strengths).toBe("Fluent delivery.");
  });

  it("tolerates a code fence / surrounding prose", () => {
    const raw =
      'Sure:\n```json\n{"score":21,"strengths":"a","errors":"b","improvements":"c"}\n```';
    // 21 clamps to 20.
    expect(parseScoreResponse(raw).score).toBe(20);
  });

  it("throws when the score is missing or non-numeric", () => {
    expect(() =>
      parseScoreResponse(
        JSON.stringify({ strengths: "a", errors: "b", improvements: "c" }),
      ),
    ).toThrow(ClaudeError);
  });

  it("throws when a feedback field is empty", () => {
    expect(() =>
      parseScoreResponse(
        JSON.stringify({
          score: 12,
          strengths: "",
          errors: "b",
          improvements: "c",
        }),
      ),
    ).toThrow(ClaudeError);
  });

  it("substitutes a placeholder for an empty transcript", () => {
    const prompt = buildScorePrompt({
      taskNumber: 1,
      question: "Tâche",
      transcript: "   ",
    });
    expect(prompt).toContain("(empty response)");
  });

  it("throws when the extracted object is not valid JSON", () => {
    expect(() => parseScoreResponse("sure {nope: not json}")).toThrow(
      ClaudeError,
    );
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => parseScoreResponse("no json here")).toThrow(ClaudeError);
  });
});

describe("buildCorrectionPrompt + parseCorrectionResponse", () => {
  it("builds a prompt with the transcript and parses the corrected text + suggestions", () => {
    const prompt = buildCorrectionPrompt({
      question: "Tâche",
      transcript: "mon réponse orale",
    });
    expect(prompt).toContain("mon réponse orale");

    const parsed = parseCorrectionResponse(
      JSON.stringify({
        correctedText: "Ma réponse corrigée.",
        suggestions: ["watch liaisons", ""],
      }),
    );
    expect(parsed.correctedText).toBe("Ma réponse corrigée.");
    expect(parsed.suggestions).toEqual(["watch liaisons"]);
  });

  it("throws when suggestions is not an array", () => {
    expect(() =>
      parseCorrectionResponse(
        JSON.stringify({ correctedText: "x", suggestions: "nope" }),
      ),
    ).toThrow(ClaudeError);
  });

  it("throws when correctedText is missing", () => {
    expect(() =>
      parseCorrectionResponse(JSON.stringify({ suggestions: ["a"] })),
    ).toThrow(ClaudeError);
  });
});
