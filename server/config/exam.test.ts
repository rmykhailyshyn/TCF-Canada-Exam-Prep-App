import { describe, expect, it } from "vitest";
import { getExamConfig, getTimeLimitMs } from "./exam";

describe("exam config", () => {
  // spec: docs/specs/quiz-session.md §Configuration.18 — Reading 60 min, Listening 35 min
  it("reads the section time limits from exam.config.json", () => {
    const config = getExamConfig();
    expect(config.reading.timeLimitMinutes).toBe(60);
    expect(config.reading.questionCount).toBe(39);
    expect(config.listening.timeLimitMinutes).toBe(35);
    expect(config.listening.questionCount).toBe(39);
  });

  it("converts the configured limit to milliseconds", () => {
    expect(getTimeLimitMs("reading")).toBe(60 * 60_000);
    expect(getTimeLimitMs("listening")).toBe(35 * 60_000);
  });
});
