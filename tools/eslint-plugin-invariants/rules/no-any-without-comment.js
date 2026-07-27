// spec: docs/specs/static-analysis.md §Behaviour.5 (advisory: no `any` without a rationale comment)
//
// CLAUDE.md invariant: no `any` without an inline comment explaining why. Advisory (warn-level, per
// spec Open Q5). Flags a bare `any` type annotation with no comment on the same or immediately
// preceding line.

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require an inline rationale comment next to any `any` annotation (CLAUDE.md: no any without a comment).",
    },
    messages: {
      anyWithoutComment:
        "`any` requires an inline comment explaining why (CLAUDE.md invariant): add a rationale on the same or preceding line, or use a precise type.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    return {
      TSAnyKeyword(node) {
        const line = node.loc.start.line;
        const hasComment = sourceCode.getAllComments().some((c) => {
          const startLine = c.loc.start.line;
          const endLine = c.loc.end.line;
          // same line, or the comment ends on the immediately preceding line
          return (
            startLine === line || endLine === line || endLine === line - 1
          );
        });
        if (!hasComment) {
          context.report({ node, messageId: "anyWithoutComment" });
        }
      },
    };
  },
};
