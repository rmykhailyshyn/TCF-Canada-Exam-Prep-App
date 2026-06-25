import { describe, expect, it } from "vitest";
import {
  ClaudeError,
  type EnrichInput,
  buildEnrichPrompt,
  extractJsonObject,
  parseCliEnvelope,
  parseExplanationResponse,
} from "./claude";

// spec: docs/specs/llm-enrichment.md §Behaviour.3–7 — pure prompt + parsing helpers, tested
// without spawning the CLI.

const reading: EnrichInput = {
  sequence: 12,
  section: "reading",
  questionText: "Quel est le sujet du texte ?",
  options: [
    { label: "A", text: "Le sport" },
    { label: "B", text: "La cuisine" },
    { label: "C", text: "Le voyage" },
    { label: "D", text: "La musique" },
  ],
  correctLabel: "B",
  sourceText: "La recette commence par préparer les légumes.",
};

const listening: EnrichInput = {
  ...reading,
  section: "listening",
  sourceText: "Bonjour, le train part à huit heures.",
};

const validReasons = {
  correctReason: "B is right: the passage opens with a recipe.",
  optionAReason: "A is wrong, no sport is mentioned.",
  optionBReason: 'B matches "préparer les légumes".',
  optionCReason: "C is wrong, no travel.",
  optionDReason: "D is wrong, no music.",
};

describe("buildEnrichPrompt", () => {
  it("includes the PASSAGE and its text for a reading question", () => {
    const p = buildEnrichPrompt(reading);
    expect(p).toContain("PASSAGE");
    expect(p).not.toContain("TRANSCRIPT");
    expect(p).toContain("La recette commence");
  });

  it("includes the TRANSCRIPT and its text for a listening question", () => {
    const p = buildEnrichPrompt(listening);
    expect(p).toContain("TRANSCRIPT");
    expect(p).toContain("le train part");
  });

  it("lists all four options, states the correct label, and asks for English JSON", () => {
    const p = buildEnrichPrompt(reading);
    expect(p).toContain("A. Le sport");
    expect(p).toContain("D. La musique");
    expect(p).toContain("The correct answer is B.");
    expect(p).toContain("IN ENGLISH");
    expect(p).toContain('"correctReason"');
  });
});

describe("extractJsonObject", () => {
  it("returns a bare object unchanged", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("pulls the object out of a markdown code fence", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("pulls the object out of surrounding prose, respecting nested braces", () => {
    expect(extractJsonObject('Sure! {"a":{"b":2}} done')).toBe('{"a":{"b":2}}');
  });

  it("ignores braces inside string literals", () => {
    expect(extractJsonObject('{"a":"}{"}')).toBe('{"a":"}{"}');
  });

  it("throws when there is no object", () => {
    expect(() => extractJsonObject("no json here")).toThrow(ClaudeError);
  });
});

describe("parseExplanationResponse", () => {
  it("parses a clean JSON object", () => {
    expect(parseExplanationResponse(JSON.stringify(validReasons))).toEqual(
      validReasons,
    );
  });

  it("parses through a code fence + prose and trims fields", () => {
    const wrapped =
      "```json\n" +
      JSON.stringify({ ...validReasons, correctReason: "  B is right.  " }) +
      "\n```";
    expect(parseExplanationResponse(wrapped).correctReason).toBe("B is right.");
  });

  it("throws when a reason is missing", () => {
    const { correctReason, ...rest } = validReasons;
    void correctReason;
    expect(() => parseExplanationResponse(JSON.stringify(rest))).toThrow(
      /correctReason/,
    );
  });

  it("throws when a reason is empty or non-string", () => {
    expect(() =>
      parseExplanationResponse(
        JSON.stringify({ ...validReasons, optionCReason: "" }),
      ),
    ).toThrow(ClaudeError);
    expect(() =>
      parseExplanationResponse(
        JSON.stringify({ ...validReasons, optionCReason: 5 }),
      ),
    ).toThrow(ClaudeError);
  });
});

describe("parseCliEnvelope", () => {
  it("returns the result string from a success envelope", () => {
    expect(
      parseCliEnvelope(JSON.stringify({ is_error: false, result: '{"a":1}' })),
    ).toBe('{"a":1}');
  });

  it("throws on a reported error", () => {
    expect(() =>
      parseCliEnvelope(
        JSON.stringify({ is_error: true, result: "rate limited" }),
      ),
    ).toThrow(/rate limited/);
  });

  it("throws when result is missing or output is not JSON", () => {
    expect(() => parseCliEnvelope(JSON.stringify({ is_error: false }))).toThrow(
      ClaudeError,
    );
    expect(() => parseCliEnvelope("not json")).toThrow(ClaudeError);
  });
});
