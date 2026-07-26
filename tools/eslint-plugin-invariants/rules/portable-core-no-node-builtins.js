// spec: docs/specs/static-analysis.md §Behaviour.5 (portable-core purity invariant)
//
// CLAUDE.md invariant: keep the portable core (server/app.ts) and the Worker-safe portable
// services free of Worker-forbidden node:* builtins (node:child_process / node:fs / node:stream).
// node:path and node:url are Worker-safe and always allowed. Node-only modules are exempt by
// basename (they never reach the Worker bundle). Path-scoped approximation of the invariant, per
// Open Q3 in the spec — ESLint cannot do true import-graph reachability.

const FORBIDDEN = new Set(["child_process", "fs", "stream"]);
const EXEMPT_BASENAMES = new Set([
  "node-routes.ts",
  "claude-cli.ts",
  "llm-provider-node.ts",
  "node-media-store.ts",
  "sqlite-path.ts",
  "migrate.ts",
]);

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid Worker-forbidden node:* builtins in the portable core (CLAUDE.md: portable core free of node:*).",
    },
    messages: {
      forbiddenNodeBuiltin:
        "Portable core must stay free of Worker-forbidden node builtins (CLAUDE.md invariant): '{{module}}' cannot be imported here — move this logic to a Node-only module (*-node.ts, node-routes.ts, server/lib, scripts/).",
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename || context.getFilename() || "").replace(
      /\\/g,
      "/",
    );
    // Only the server tree hosts the portable core; anything else is out of scope.
    if (!/(^|\/)server\//.test(filename)) return {};
    const base = filename.split("/").pop() || "";
    if (EXEMPT_BASENAMES.has(base) || /-node\.ts$/.test(base)) return {};

    return {
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (typeof src !== "string") return;
        const mod = src.replace(/^node:/, "");
        if (FORBIDDEN.has(mod)) {
          context.report({
            node,
            messageId: "forbiddenNodeBuiltin",
            data: { module: src },
          });
        }
      },
    };
  },
};
