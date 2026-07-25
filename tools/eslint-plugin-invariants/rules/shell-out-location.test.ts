// spec: docs/specs/static-analysis.md §Behaviour.5 (platform-scoped shell-out invariant)
import { it } from "vitest";
import ESLintPkg from "eslint";
import parser from "@typescript-eslint/parser";
import rule from "./shell-out-location.js";

const { RuleTester } = ESLintPkg;

const ruleTester = new RuleTester({
  languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
});

it("shell-out-location allows child_process only under scripts/, server/services/, server/lib/", () => {
  ruleTester.run("shell-out-location", rule, {
    valid: [
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "server/lib/claude-cli.ts",
      },
      {
        code: 'import cp from "child_process";',
        filename: "scripts/lib/whisper.ts",
      },
      {
        code: 'import { spawn } from "node:child_process";',
        filename: "server/services/speaking-node.ts",
      },
      {
        code: 'import { listQuestions } from "./services.js";',
        filename: "server/routes/questions.ts",
      },
    ],
    invalid: [
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "server/routes/questions.ts",
        errors: [{ messageId: "shellOutOutsideAllowed" }],
      },
      {
        code: 'import cp from "child_process";',
        filename: "client/src/foo.ts",
        errors: [{ messageId: "shellOutOutsideAllowed" }],
      },
      {
        code: 'import { exec } from "node:child_process";',
        filename: "server/app.ts",
        errors: [{ messageId: "shellOutOutsideAllowed" }],
      },
    ],
  });
});
