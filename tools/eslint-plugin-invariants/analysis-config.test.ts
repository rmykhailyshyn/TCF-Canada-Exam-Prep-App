// spec: docs/specs/static-analysis.md §Behaviour.2, §Behaviour.6, §Behaviour.9 (blocking gate,
// inline suppression, advisory severity) — exercises the committed eslint.analysis.config.js.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import ESLintPkg from "eslint";

const { ESLint } = ESLintPkg;
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// projectService/type-aware parsing is disabled here so the assertions depend only on the AST-based
// custom invariant rules (which need no type info) and are deterministic for synthetic file paths.
function makeESLint(): InstanceType<typeof ESLint> {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: "eslint.analysis.config.js",
    overrideConfig: {
      languageOptions: { parserOptions: { project: false, projectService: false } },
    },
  });
}

describe("eslint.analysis.config.js gate behaviour", () => {
  it("reports at least one error on a crafted invariant violation (non-zero gate)", async () => {
    const eslint = makeESLint();
    const code = [
      'import { spawnSync } from "node:child_process";',
      "export function handler(db) {",
      '  db.run("DELETE FROM sessions");',
      '  spawnSync("ls");',
      "}",
      "",
    ].join("\n");
    const [result] = await eslint.lintText(code, {
      filePath: "server/routes/__analysis_fixture__.ts",
    });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.messages.some((m) => m.ruleId?.startsWith("invariants/")),
    ).toBe(true);
  });

  it("reports zero errors on clean code (green gate)", async () => {
    const eslint = makeESLint();
    const code = "export function handler(list) {\n  return list();\n}\n";
    const [result] = await eslint.lintText(code, {
      filePath: "server/routes/__clean_fixture__.ts",
    });
    expect(result.errorCount).toBe(0);
  });

  it("respects an inline disable directive carrying a rationale", async () => {
    const eslint = makeESLint();
    const code = [
      "export function handler(db) {",
      "  // eslint-disable-next-line invariants/no-raw-sql -- fixture: intentional raw sql under test",
      '  db.run("SELECT 1");',
      "}",
      "",
    ].join("\n");
    const [result] = await eslint.lintText(code, {
      filePath: "server/services/__suppress_fixture__.ts",
    });
    expect(
      result.messages.every((m) => m.ruleId !== "invariants/no-raw-sql"),
    ).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("treats no-any-without-comment as an advisory warning, not a blocking error", async () => {
    const eslint = makeESLint();
    const code = "export function handler(x: any) {\n  return x;\n}\n";
    const [result] = await eslint.lintText(code, {
      filePath: "server/services/__any_fixture__.ts",
    });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(
      result.messages.some(
        (m) =>
          m.ruleId === "invariants/no-any-without-comment" && m.severity === 1,
      ),
    ).toBe(true);
  });
});
