// spec: docs/specs/static-analysis.md §Behaviour.5 (portable-core purity invariant)
import { it } from "vitest";
import ESLintPkg from "eslint";
import parser from "@typescript-eslint/parser";
import rule from "./portable-core-no-node-builtins.js";

const { RuleTester } = ESLintPkg;

const ruleTester = new RuleTester({
  languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
});

it("portable-core-no-node-builtins flags Worker-forbidden node builtins in the portable set only", () => {
  ruleTester.run("portable-core-no-node-builtins", rule, {
    valid: [
      { code: 'import path from "node:path";', filename: "server/app.ts" },
      {
        code: 'import { fileURLToPath } from "node:url";',
        filename: "server/config/env.ts",
      },
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "server/lib/claude-cli.ts",
      },
      {
        code: 'import cp from "node:child_process";',
        filename: "server/lib/llm-provider-node.ts",
      },
      {
        code: 'import fs from "node:fs";',
        filename: "server/services/speaking-node.ts",
      },
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "server/routes/node-routes.ts",
      },
      {
        code: 'import fs from "node:fs";',
        filename: "server/db/migrate.ts",
      },
      {
        code: 'import fs from "node:fs";',
        filename: "server/db/sqlite-path.ts",
      },
      {
        code: 'import { createReadStream } from "node:fs";',
        filename: "server/runtime/node-media-store.ts",
      },
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "scripts/lib/whisper.ts",
      },
    ],
    invalid: [
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "server/app.ts",
        errors: [{ messageId: "forbiddenNodeBuiltin" }],
      },
      {
        code: 'import fs from "node:fs";',
        filename: "server/services/questions.ts",
        errors: [{ messageId: "forbiddenNodeBuiltin" }],
      },
      {
        code: 'import { Readable } from "node:stream";',
        filename: "server/routes/questions.ts",
        errors: [{ messageId: "forbiddenNodeBuiltin" }],
      },
    ],
  });
});
