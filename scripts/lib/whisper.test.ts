import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhisperError, parseWhisperJson, runWhisper } from "./whisper";

// The Whisper CLI is Apple-Silicon-only; mock the process boundary so runWhisper's own logic
// (argv construction, error mapping, output discovery) is testable on any platform.
const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

// spec: docs/specs/listening-import.md §Behaviour.7 — phrase-level (text, start_ms, end_ms),
// ordered by sequence with start_ms <= end_ms.

describe("parseWhisperJson", () => {
  it("converts seconds to ordered ms segments and reports the clip duration", () => {
    const raw = JSON.stringify({
      text: "Bonjour. Comment allez-vous ?",
      segments: [
        { start: 0, end: 1.5, text: " Bonjour." },
        { start: 1.5, end: 3.2, text: "Comment allez-vous ? " },
      ],
    });
    const { segments, durationMs } = parseWhisperJson(raw);
    expect(segments).toEqual([
      { sequence: 1, text: "Bonjour.", startMs: 0, endMs: 1500 },
      { sequence: 2, text: "Comment allez-vous ?", startMs: 1500, endMs: 3200 },
    ]);
    expect(durationMs).toBe(3200);
  });

  it("drops blank segments and renumbers sequence contiguously", () => {
    const raw = JSON.stringify({
      segments: [
        { start: 0, end: 1, text: "Un" },
        { start: 1, end: 2, text: "   " },
        { start: 2, end: 3, text: "Deux" },
      ],
    });
    const { segments } = parseWhisperJson(raw);
    expect(segments.map((s) => s.text)).toEqual(["Un", "Deux"]);
    expect(segments.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("clamps end_ms to be at least start_ms", () => {
    const raw = JSON.stringify({
      segments: [{ start: 2, end: 1.5, text: "oops" }],
    });
    const { segments } = parseWhisperJson(raw);
    expect(segments[0].startMs).toBe(2000);
    expect(segments[0].endMs).toBe(2000);
  });

  it("returns no segments and null duration for an empty transcript", () => {
    expect(parseWhisperJson(JSON.stringify({ segments: [] }))).toEqual({
      segments: [],
      durationMs: null,
    });
  });

  it("throws WhisperError on unparseable JSON", () => {
    expect(() => parseWhisperJson("not json")).toThrow(WhisperError);
  });

  it("treats missing start/end timestamps as zero", () => {
    const { segments } = parseWhisperJson(
      JSON.stringify({ segments: [{ text: "bonjour" }] }),
    );
    expect(segments).toEqual([
      { sequence: 1, text: "bonjour", startMs: 0, endMs: 0 },
    ]);
  });

  it("clamps a negative start to zero", () => {
    const { segments } = parseWhisperJson(
      JSON.stringify({ segments: [{ start: -1, end: 2, text: "salut" }] }),
    );
    expect(segments[0].startMs).toBe(0);
  });

  it("returns no segments when the JSON has no segments key", () => {
    expect(parseWhisperJson(JSON.stringify({ text: "x" }))).toEqual({
      segments: [],
      durationMs: null,
    });
  });
});

// spec: docs/specs/listening-import.md §Behaviour.12 — a missing binary or a non-zero exit is
// surfaced as WhisperError so the orchestrator skips the file and continues. The CLI itself is
// Apple-Silicon-only, so `spawnSync` is mocked and the JSON it would have written is staged on disk.
describe("runWhisper", () => {
  const outDirs: string[] = [];

  beforeEach(() => {
    spawnSync.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    for (const dir of outDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Make spawnSync behave like a successful run that wrote `<name>.json` into --output-dir. */
  function succeedWriting(fileName: string, contents: unknown): void {
    spawnSync.mockImplementation((_bin: string, args: string[]) => {
      const outDir = args[args.indexOf("--output-dir") + 1];
      outDirs.push(outDir);
      writeFileSync(join(outDir, fileName), JSON.stringify(contents));
      return { status: 0, stdout: "", stderr: "" };
    });
  }

  const OUTPUT = {
    segments: [{ start: 0, end: 1.5, text: "Bonjour." }],
  };

  it("parses the JSON the CLI wrote for the input file", () => {
    succeedWriting("clip.json", OUTPUT);
    const result = runWhisper("/audio/clip.mp3");
    expect(result.segments).toEqual([
      { sequence: 1, text: "Bonjour.", startMs: 0, endMs: 1500 },
    ]);
    expect(result.durationMs).toBe(1500);
  });

  it("defaults to the mlx_whisper binary and the turbo model", () => {
    succeedWriting("clip.json", OUTPUT);
    runWhisper("/audio/clip.mp3");
    const [bin, args] = spawnSync.mock.calls[0] as [string, string[]];
    expect(bin).toBe("mlx_whisper");
    expect(args[args.indexOf("--model") + 1]).toBe(
      "mlx-community/whisper-large-v3-turbo",
    );
    expect(args[args.indexOf("--language") + 1]).toBe("fr");
  });

  it("honours WHISPER_CMD and WHISPER_MODEL", () => {
    vi.stubEnv("WHISPER_CMD", "/venv/bin/mlx_whisper");
    vi.stubEnv("WHISPER_MODEL", "tiny");
    succeedWriting("clip.json", OUTPUT);
    runWhisper("/audio/clip.mp3");
    const [bin, args] = spawnSync.mock.calls[0] as [string, string[]];
    expect(bin).toBe("/venv/bin/mlx_whisper");
    expect(args[args.indexOf("--model") + 1]).toBe("tiny");
  });

  // Falls back to the first .json in the directory when the CLI's naming differs across versions.
  it("falls back to the only JSON produced when the name does not match the input", () => {
    succeedWriting("unexpected-name.json", OUTPUT);
    expect(runWhisper("/audio/clip.mp3").segments).toHaveLength(1);
  });

  it("throws a helpful WhisperError when the binary is missing", () => {
    spawnSync.mockReturnValue({
      error: new Error("spawnSync mlx_whisper ENOENT"),
      status: null,
      stdout: "",
      stderr: "",
    });
    expect(() => runWhisper("/audio/clip.mp3")).toThrow(WhisperError);
    expect(() => runWhisper("/audio/clip.mp3")).toThrow(/pip install mlx-whisper/);
  });

  it("throws WhisperError with the stderr on a non-zero exit", () => {
    spawnSync.mockReturnValue({
      status: 2,
      stdout: "",
      stderr: "  model not found  ",
    });
    expect(() => runWhisper("/audio/clip.mp3")).toThrow(/exited 2/);
    expect(() => runWhisper("/audio/clip.mp3")).toThrow(/model not found/);
  });

  it("throws WhisperError when the CLI wrote no JSON at all", () => {
    spawnSync.mockImplementation((_bin: string, args: string[]) => {
      outDirs.push(args[args.indexOf("--output-dir") + 1]);
      return { status: 0, stdout: "", stderr: "" };
    });
    expect(() => runWhisper("/audio/clip.mp3")).toThrow(/produced no JSON/);
  });
});
