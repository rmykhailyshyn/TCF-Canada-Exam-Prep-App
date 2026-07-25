// spec: docs/specs/static-analysis.md §Behaviour.5 (thin route handlers invariant)
import { it } from "vitest";
import ESLintPkg from "eslint";
import parser from "@typescript-eslint/parser";
import rule from "./thin-route-handlers.js";

const { RuleTester } = ESLintPkg;

const ruleTester = new RuleTester({
  languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
});

it("thin-route-handlers flags direct DB / child_process use inside route files, allows service calls", () => {
  ruleTester.run("thin-route-handlers", rule, {
    valid: [
      {
        code: 'import { listQuestions } from "../services/questions.js";\nexport const h = () => listQuestions();',
        filename: "server/routes/questions.ts",
      },
      {
        code: 'import { spawnSync } from "node:child_process";\nexport const h = () => spawnSync("x");',
        filename: "server/routes/node-routes.ts",
      },
      {
        code: "export const h = () => db.select().from(t);",
        filename: "server/services/questions.ts",
      },
    ],
    invalid: [
      {
        code: "export const h = () => db.select().from(questions);",
        filename: "server/routes/questions.ts",
        errors: [{ messageId: "fatRouteHandler" }],
      },
      {
        code: 'import { spawnSync } from "node:child_process";',
        filename: "server/routes/sessions.ts",
        errors: [{ messageId: "fatRouteHandler" }],
      },
    ],
  });
});
