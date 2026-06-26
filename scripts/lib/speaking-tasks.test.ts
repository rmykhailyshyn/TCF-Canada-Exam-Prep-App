import { describe, expect, it } from "vitest";
import { SpeakingTaskParseError, parseSpeakingTasks } from "./speaking-tasks";

describe("parseSpeakingTasks", () => {
  it("parses a valid array, assigning the 0-based index as sequence", () => {
    const results = parseSpeakingTasks(
      JSON.stringify([
        { task: 1, question: "Présentez-vous.", answer: "Bonjour…" },
        { task: 3, question: "Donnez votre avis." },
      ]),
    );
    expect(results).toEqual([
      {
        ok: true,
        task: {
          sequence: 0,
          taskNumber: 1,
          question: "Présentez-vous.",
          sampleAnswer: "Bonjour…",
        },
      },
      {
        ok: true,
        task: {
          sequence: 1,
          taskNumber: 3,
          question: "Donnez votre avis.",
          sampleAnswer: null,
        },
      },
    ]);
  });

  it("treats a blank or absent answer as a null sample answer", () => {
    const [a, b] = parseSpeakingTasks(
      JSON.stringify([
        { task: 2, question: "Q", answer: "   " },
        { task: 2, question: "Q" },
      ]),
    );
    expect(a.ok && a.task.sampleAnswer).toBeNull();
    expect(b.ok && b.task.sampleAnswer).toBeNull();
  });

  it("skips (does not throw) elements with an out-of-range task or empty question", () => {
    const results = parseSpeakingTasks(
      JSON.stringify([
        { task: 4, question: "too big" },
        { task: 1, question: "   " },
        { task: 2, question: "ok" },
      ]),
    );
    expect(results[0]).toMatchObject({ ok: false, sequence: 0 });
    expect(results[1]).toMatchObject({ ok: false, sequence: 1 });
    expect(results[2]).toMatchObject({ ok: true });
  });

  it("skips non-object elements with a reason", () => {
    const [r] = parseSpeakingTasks(JSON.stringify(["not an object"]));
    expect(r).toMatchObject({ ok: false, sequence: 0 });
    if (!r.ok) expect(r.reason).toMatch(/object/);
  });

  it("throws when the document is not valid JSON", () => {
    expect(() => parseSpeakingTasks("{not json")).toThrow(
      SpeakingTaskParseError,
    );
  });

  it("throws when the document is not a JSON array", () => {
    expect(() =>
      parseSpeakingTasks(JSON.stringify({ task: 1, question: "x" })),
    ).toThrow(SpeakingTaskParseError);
  });
});
