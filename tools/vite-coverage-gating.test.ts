// spec: docs/specs/test-coverage.md §Behaviour.8 (client instrumented only under COVERAGE=1;
// plain build/dev unchanged)
import { describe, it, expect, vi, afterEach } from "vitest";

type PluginLike = { name?: string } | PluginLike[] | null | undefined;

function collectNames(plugins: PluginLike, acc: string[] = []): string[] {
  if (!plugins) return acc;
  if (Array.isArray(plugins)) {
    for (const p of plugins) collectNames(p, acc);
    return acc;
  }
  if (typeof plugins === "object" && typeof plugins.name === "string") {
    acc.push(plugins.name);
  }
  return acc;
}

async function pluginNamesWithCoverage(coverage: boolean): Promise<string[]> {
  vi.resetModules();
  const prev = process.env.COVERAGE;
  if (coverage) process.env.COVERAGE = "1";
  else delete process.env.COVERAGE;
  try {
    const mod = await import("../client/vite.config.ts");
    const raw = (mod as { default: unknown }).default;
    const config =
      typeof raw === "function"
        ? await raw({ command: "build", mode: "production" })
        : raw;
    const plugins = (config as { plugins?: PluginLike }).plugins;
    return collectNames(plugins);
  } finally {
    if (prev === undefined) delete process.env.COVERAGE;
    else process.env.COVERAGE = prev;
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("client vite config istanbul gating", () => {
  it("does NOT instrument (no istanbul plugin) when COVERAGE is unset", async () => {
    const names = await pluginNamesWithCoverage(false);
    expect(names.some((n) => n.includes("istanbul"))).toBe(false);
  });

  it("adds the istanbul instrumentation plugin when COVERAGE=1", async () => {
    const names = await pluginNamesWithCoverage(true);
    expect(names.some((n) => n.includes("istanbul"))).toBe(true);
  });
});
