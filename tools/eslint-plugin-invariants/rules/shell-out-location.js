// spec: docs/specs/static-analysis.md §Behaviour.5 (platform-scoped shell-out invariant)
//
// CLAUDE.md invariant: no Apple-Silicon/macOS shell-outs (child_process — Whisper/Tesseract/Claude
// CLI) outside scripts/, server/services/, and server/lib/ (the last for claude-cli.ts). Flags any
// `child_process` / `node:child_process` import elsewhere.

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict child_process shell-outs to scripts/, server/services/, server/lib/ (CLAUDE.md: platform-scoped shell-outs).",
    },
    messages: {
      shellOutOutsideAllowed:
        "Shell-outs (child_process) are only allowed under scripts/, server/services/, or server/lib/ (CLAUDE.md invariant): keep platform-specific CLI calls out of the portable core and route/client code.",
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename || context.getFilename() || "").replace(
      /\\/g,
      "/",
    );
    const allowed =
      /(^|\/)scripts\//.test(filename) ||
      /(^|\/)server\/services\//.test(filename) ||
      /(^|\/)server\/lib\//.test(filename);

    return {
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (
          (src === "child_process" || src === "node:child_process") &&
          !allowed
        ) {
          context.report({ node, messageId: "shellOutOutsideAllowed" });
        }
      },
    };
  },
};
