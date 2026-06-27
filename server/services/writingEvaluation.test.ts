import { describe, expect, it } from "vitest";
import { ClaudeError } from "../lib/claude-cli";
import {
  buildCorrectionPrompt,
  buildScorePrompt,
  parseCorrectionResponse,
  parseScoreResponse,
} from "./writingEvaluation";

describe("buildScorePrompt", () => {
  it("includes the task prompt, the response, and the word guidance", () => {
    const prompt = buildScorePrompt({
      taskNumber: 1,
      prompt: "Écrivez un message.",
      minWords: 60,
      maxWords: 120,
      responseText: "Bonjour …",
    });
    expect(prompt).toContain("Expression écrite");
    expect(prompt).toContain("Écrivez un message.");
    expect(prompt).toContain("Bonjour …");
    expect(prompt).toContain("60–120 words");
    expect(prompt).toContain('"score"');
  });

  it("phrases the word guidance for a min-only constraint", () => {
    const prompt = buildScorePrompt({
      taskNumber: 2,
      prompt: "Tâche",
      minWords: 120,
      maxWords: null,
      responseText: "x",
    });
    expect(prompt).toContain("at least 120 words");
  });

  it("phrases the word guidance for a max-only constraint", () => {
    const prompt = buildScorePrompt({
      taskNumber: 2,
      prompt: "Tâche",
      minWords: null,
      maxWords: 200,
      responseText: "x",
    });
    expect(prompt).toContain("at most 200 words");
  });

  it("phrases the word guidance when neither bound is set", () => {
    const prompt = buildScorePrompt({
      taskNumber: 3,
      prompt: "Tâche",
      minWords: null,
      maxWords: null,
      responseText: "x",
    });
    expect(prompt).toContain("no specific length requirement");
  });

  it("substitutes a placeholder for an empty response", () => {
    const prompt = buildScorePrompt({
      taskNumber: 1,
      prompt: "Tâche",
      minWords: null,
      maxWords: null,
      responseText: "   ",
    });
    expect(prompt).toContain("(empty response)");
  });
});

describe("parseScoreResponse", () => {
  it("parses a valid object and clamps/rounds the score", () => {
    const result = parseScoreResponse(
      JSON.stringify({
        score: 14.6,
        strengths: "Clear structure.",
        errors: "A few agreement slips.",
        improvements: "Vary the connectors.",
      }),
    );
    expect(result.score).toBe(15);
    expect(result.feedback.strengths).toBe("Clear structure.");
  });

  it("tolerates a code fence / surrounding prose", () => {
    const raw =
      'Here you go:\n```json\n{"score":10,"strengths":"a","errors":"b","improvements":"c"}\n```';
    expect(parseScoreResponse(raw).score).toBe(10);
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

  it("throws when the extracted object is not valid JSON", () => {
    // A brace-balanced slice that JSON.parse rejects exercises the parseObject catch.
    expect(() => parseScoreResponse("here you go {nope: not json}")).toThrow(
      ClaudeError,
    );
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => parseScoreResponse("the model refused")).toThrow(ClaudeError);
  });
});

describe("buildCorrectionPrompt + parseCorrectionResponse", () => {
  it("builds a prompt with the draft and parses the corrected text + suggestions", () => {
    const prompt = buildCorrectionPrompt({
      prompt: "Tâche",
      responseText: "mon brouillon",
    });
    expect(prompt).toContain("mon brouillon");

    const parsed = parseCorrectionResponse(
      JSON.stringify({
        correctedText: "Mon brouillon corrigé.",
        suggestions: ["use the subjunctive", ""],
      }),
    );
    expect(parsed.correctedText).toBe("Mon brouillon corrigé.");
    expect(parsed.suggestions).toEqual(["use the subjunctive"]);
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
