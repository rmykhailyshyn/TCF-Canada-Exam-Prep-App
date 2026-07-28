import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSqliteDir } from "../db/sqlite-path";
import {
  getDatabaseUrl,
  getMediaDir,
  getPort,
  resolveMediaPath,
} from "./env";

// spec: docs/specs/database-sqlite.md §Behaviour.1; docs/specs/question-export-import.md
// §Export document format; docs/specs/server-runtime.md §Behaviour.5
// Environment resolution is what keeps every entry point (server, migrate, seed, e2e, the CLI
// importers) pointed at ONE database and ONE media directory regardless of cwd — these are the rules
// that make the stored relative paths portable.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDatabaseUrl", () => {
  it("defaults to the repo-local SQLite file so a fresh checkout works with no setup", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const url = getDatabaseUrl();
    expect(url.startsWith("file:")).toBe(true);
    expect(url.endsWith(`data${sep}tcf_prep.db`)).toBe(true);
  });

  // libSQL resolves relative paths against process.cwd(), which differs per workspace — anchoring
  // to the repo root is what stops server/ and root-run tooling opening different files.
  it("anchors a relative file: path to the repo root, not the cwd", () => {
    vi.stubEnv("DATABASE_URL", "file:./data/custom.db");
    const url = getDatabaseUrl();
    expect(isAbsolute(url.slice("file:".length))).toBe(true);
    expect(url.endsWith(`data${sep}custom.db`)).toBe(true);
  });

  it("leaves an absolute file: path untouched", () => {
    const abs = resolve(tmpdir(), "abs.db");
    vi.stubEnv("DATABASE_URL", `file:${abs}`);
    expect(getDatabaseUrl()).toBe(`file:${abs}`);
  });

  it("leaves :memory: untouched", () => {
    vi.stubEnv("DATABASE_URL", "file::memory:");
    expect(getDatabaseUrl()).toBe("file::memory:");
  });

  it("leaves a non-file libSQL URL untouched", () => {
    vi.stubEnv("DATABASE_URL", "libsql://example.turso.io");
    expect(getDatabaseUrl()).toBe("libsql://example.turso.io");
  });
});

describe("getPort", () => {
  it("defaults to 3001", () => {
    vi.stubEnv("PORT", undefined);
    expect(getPort()).toBe(3001);
  });

  it("reads PORT from the environment", () => {
    vi.stubEnv("PORT", "8080");
    expect(getPort()).toBe(8080);
  });
});

describe("getMediaDir / resolveMediaPath", () => {
  it("defaults to <repo-root>/data/media alongside the SQLite file", () => {
    vi.stubEnv("MEDIA_DIR", undefined);
    expect(getMediaDir().endsWith(`data${sep}media`)).toBe(true);
  });

  it("resolves MEDIA_DIR to an absolute path", () => {
    vi.stubEnv("MEDIA_DIR", "./my-media");
    expect(isAbsolute(getMediaDir())).toBe(true);
    expect(getMediaDir().endsWith("my-media")).toBe(true);
  });

  // The DB stores relative keys (the portable form); the serve layer joins them onto MEDIA_DIR.
  it("joins a relative stored key onto MEDIA_DIR", () => {
    const dir = resolve(tmpdir(), "tcf-media-test");
    vi.stubEnv("MEDIA_DIR", dir);
    expect(resolveMediaPath("listening/30q2.mp3")).toBe(
      join(dir, "listening", "30q2.mp3"),
    );
  });

  // Legacy rows written before the media-path migration hold absolute paths.
  it("passes an absolute stored path through unchanged", () => {
    vi.stubEnv("MEDIA_DIR", resolve(tmpdir(), "tcf-media-test"));
    const abs = resolve(tmpdir(), "elsewhere", "old.mp3");
    expect(resolveMediaPath(abs)).toBe(abs);
  });
});

describe("ensureSqliteDir", () => {
  it("creates the parent directory of a local file: URL", () => {
    const base = mkdtempSync(join(tmpdir(), "tcf-sqlite-"));
    try {
      const nested = join(base, "deep", "nested");
      ensureSqliteDir(`file:${join(nested, "app.db")}`);
      expect(statSync(nested).isDirectory()).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("ignores non-file URLs", () => {
    expect(() => ensureSqliteDir("libsql://example.turso.io")).not.toThrow();
  });

  it("ignores :memory: and an empty path", () => {
    expect(() => ensureSqliteDir("file::memory:")).not.toThrow();
    expect(() => ensureSqliteDir("file:")).not.toThrow();
  });

  it("does nothing for a bare filename in the cwd", () => {
    expect(() => ensureSqliteDir("file:app.db")).not.toThrow();
  });
});
