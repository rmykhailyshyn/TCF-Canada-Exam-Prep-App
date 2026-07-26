// spec: docs/specs/static-analysis.md §Behaviour.5 (Drizzle-only DB access invariant)
import { it } from "vitest";
import ESLintPkg from "eslint";
import parser from "@typescript-eslint/parser";
import rule from "./no-raw-sql.js";

const { RuleTester } = ESLintPkg;

const ruleTester = new RuleTester({
  languageOptions: { parser, ecmaVersion: 2022, sourceType: "module" },
});

it("no-raw-sql flags raw-string DB execution but allows the drizzle sql tag and non-executed strings", () => {
  ruleTester.run("no-raw-sql", rule, {
    valid: [
      { code: "db.run(sql`SELECT 1`);", filename: "server/services/x.ts" },
      { code: "db.execute(sql`SELECT ${1}`);", filename: "server/services/x.ts" },
      {
        code: 'const stmt = "INSERT OR REPLACE INTO questions VALUES (1)";',
        filename: "server/lib/deploy-sql.ts",
      },
      {
        code: "export const created = sql`(unixepoch())`;",
        filename: "server/db/schema.ts",
      },
      {
        code: "db.select().from(users).where(eq(users.id, 1));",
        filename: "server/services/x.ts",
      },
      // Framework `.get`/`.all` calls collide with the exec-method names but are not SQL — the arg
      // must lead with a SQL keyword to be flagged. spec: static-analysis.md §Scope (genuine raw SQL).
      { code: 'router.get("/export", handler);', filename: "server/routes/x.ts" },
      { code: 'c.get("db");', filename: "server/routes/x.ts" },
      { code: 'app.all("/api/*", handler);', filename: "server/index.ts" },
    ],
    invalid: [
      {
        code: 'db.run("DELETE FROM sessions");',
        filename: "server/services/x.ts",
        errors: [{ messageId: "rawSql" }],
      },
      {
        code: 'db.execute("SELECT * FROM users");',
        filename: "server/services/x.ts",
        errors: [{ messageId: "rawSql" }],
      },
      {
        code: "conn.all(`SELECT ${x} FROM t`);",
        filename: "server/services/x.ts",
        errors: [{ messageId: "rawSql" }],
      },
    ],
  });
});
