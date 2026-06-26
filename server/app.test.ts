import { describe, expect, it } from "vitest";
import { createCoreApp } from "./app";

// spec: docs/specs/server-runtime.md §Behaviour.8; acceptance criterion (portable core)
// The portable core must be importable and constructible WITHOUT pulling in any module that imports
// `node:child_process` / `node:fs` (NodeMediaStore, the *-node services, claude-cli, whisper). This
// test merely importing ./app and constructing the app exercises that import graph — if a forbidden
// transitive dependency were introduced, vitest would still load it, so it is paired with the static
// import-graph review noted in the spec. Construction returning a Hono app is the smoke check.
describe("createCoreApp (portable core)", () => {
  it("constructs a mountable Hono app", () => {
    const app = createCoreApp();
    expect(typeof app.fetch).toBe("function");
    expect(typeof app.route).toBe("function");
  });
});
