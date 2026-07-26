// spec: docs/specs/static-analysis.md §Behaviour.5 (thin route handlers invariant)
//
// CLAUDE.md invariant: route handlers stay thin (validate → call a service → return). No direct DB
// access (`db.<member>()`) or shell-out (`child_process` import) inside server/routes/**. The
// Node-only route extension (node-routes.ts) is exempt — it is where Node-only wiring legitimately
// lives.

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep route handlers thin — no direct DB or child_process use (CLAUDE.md: business logic lives in services).",
    },
    messages: {
      fatRouteHandler:
        "Route handlers must stay thin (CLAUDE.md invariant): no direct DB access or child_process use in server/routes/** — move this into a server/services/* service.",
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename || context.getFilename() || "").replace(
      /\\/g,
      "/",
    );
    if (!/(^|\/)server\/routes\//.test(filename)) return {};
    const base = filename.split("/").pop() || "";
    if (base === "node-routes.ts") return {};

    return {
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (src === "child_process" || src === "node:child_process") {
          context.report({ node, messageId: "fatRouteHandler" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "db"
        ) {
          context.report({ node, messageId: "fatRouteHandler" });
        }
      },
    };
  },
};
