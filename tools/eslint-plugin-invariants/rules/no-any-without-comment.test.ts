// spec: docs/specs/static-analysis.md §Behaviour.5 (advisory: no `any` without a rationale comment)
import { it } from "vitest";
import ESLintPkg from "eslint";
import parser from "@typescript-eslint/parser";
import rule from "./no-any-without-comment.js";

const { RuleTester } = ESLintPkg;

const ruleTester = new RuleTester({
  languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
});

it("no-any-without-comment flags bare `any`, allows `any` carrying an explanation comment", () => {
  ruleTester.run("no-any-without-comment", rule, {
    valid: [
      {
        code: "let x: any; // untyped third-party payload",
        filename: "server/x.ts",
      },
      {
        code: "// reason: dynamic shape from external lib\nfunction f(): any {\n  return 1;\n}",
        filename: "server/x.ts",
      },
    ],
    invalid: [
      {
        code: "let y: any;",
        filename: "server/x.ts",
        errors: [{ messageId: "anyWithoutComment" }],
      },
      {
        code: "function g(p: any) {\n  return p;\n}",
        filename: "server/x.ts",
        errors: [{ messageId: "anyWithoutComment" }],
      },
    ],
  });
});
