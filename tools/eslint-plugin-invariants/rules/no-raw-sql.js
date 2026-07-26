// spec: docs/specs/static-analysis.md §Behaviour.5 (Drizzle-only DB access invariant)
//
// CLAUDE.md invariant: no raw SQL — all DB access goes through Drizzle. Flags genuine raw-string
// execution `.run/.execute/.all/.get/.values(<string | untagged template>)`. Allows the drizzle-orm
// `sql` tagged template (arg is a TaggedTemplateExpression, not a bare Literal/TemplateLiteral) and
// non-executed string literals (e.g. server/lib/deploy-sql.ts building SQL text by design).

const EXEC_METHODS = new Set(["run", "execute", "all", "get", "values"]);

// The exec-method names above collide with common non-DB APIs — Hono routing/context (`app.get(path)`,
// `app.all(path, h)`, `c.get("db")`), Map/Headers `.get()`, etc. Per the spec this rule "targets only
// genuine raw-string DB execution", so we additionally require the string/template argument to actually
// begin with a SQL statement keyword. This removes the framework false-positives while still flagging
// real raw SQL (`db.run("DELETE …")`, `client.execute("PRAGMA …")`, `conn.all(`SELECT ${x} …`)`).
// spec: docs/specs/static-analysis.md §Scope (no-raw-sql: "targets only genuine raw-string DB execution")
const SQL_LEADING =
  /^\s*\(?\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|ANALYZE|ATTACH|DETACH|REINDEX|EXPLAIN|TRUNCATE)\b/i;

/** @param {import("estree").Node} arg */
function looksLikeSql(arg) {
  if (arg.type === "Literal" && typeof arg.value === "string")
    return SQL_LEADING.test(arg.value);
  if (arg.type === "TemplateLiteral") {
    const first = arg.quasis[0];
    return SQL_LEADING.test(first ? (first.value.cooked ?? first.value.raw) : "");
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw-string SQL execution outside Drizzle query builders (CLAUDE.md: no raw SQL).",
    },
    messages: {
      rawSql:
        "No raw SQL (CLAUDE.md invariant): all DB access must go through Drizzle. Use the drizzle-orm `sql` tagged template or the query builder instead of a raw string.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        const prop = callee.property;
        const name =
          prop.type === "Identifier"
            ? prop.name
            : prop.type === "Literal"
              ? prop.value
              : null;
        if (typeof name !== "string" || !EXEC_METHODS.has(name)) return;
        const arg = node.arguments[0];
        if (!arg) return;
        // A raw-string/untagged-template argument that actually reads as SQL. The drizzle-orm `sql`
        // tagged template is a TaggedTemplateExpression (not a bare Literal/TemplateLiteral) and is
        // therefore allowed; framework `.get("/path")` / `.all(path, handler)` calls don't lead with
        // a SQL keyword and are ignored.
        if (looksLikeSql(arg)) {
          context.report({ node, messageId: "rawSql" });
        }
      },
    };
  },
};
