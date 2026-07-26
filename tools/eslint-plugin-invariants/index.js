// spec: docs/specs/static-analysis.md §Behaviour.5 (repo-local project-invariant ruleset)
//
// Local ESLint plugin bundling the CLAUDE.md project-invariant rules. Registered under the
// `invariants` namespace in eslint.analysis.config.js, so rule ids read `invariants/<id>`.

import portableCoreNoNodeBuiltins from "./rules/portable-core-no-node-builtins.js";
import noRawSql from "./rules/no-raw-sql.js";
import thinRouteHandlers from "./rules/thin-route-handlers.js";
import shellOutLocation from "./rules/shell-out-location.js";
import noAnyWithoutComment from "./rules/no-any-without-comment.js";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "eslint-plugin-invariants", version: "0.1.0" },
  rules: {
    "portable-core-no-node-builtins": portableCoreNoNodeBuiltins,
    "no-raw-sql": noRawSql,
    "thin-route-handlers": thinRouteHandlers,
    "shell-out-location": shellOutLocation,
    "no-any-without-comment": noAnyWithoutComment,
  },
};

export default plugin;
