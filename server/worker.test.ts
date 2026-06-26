/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from "vitest";
import { app, type Env } from "./worker";

// spec: docs/specs/cloud-deployment.md §Behaviour.3, 4, 5; acceptance criteria
// Construction/smoke test for the Cloudflare Worker entry. Merely importing ./worker exercises its
// import graph — if it pulled in a node:child_process / node:fs module (NodeMediaStore, *-node
// services, the libSQL factory), this test would still load it, so it is paired with the static
// import-graph review noted in the spec. The assertions cover the practice-only contract: health
// reports all-false capabilities, and an unmounted CLI-backed route returns NOT_FOUND (not 500).

// Minimal binding stubs: neither exercised path queries D1 or reads R2, so empty objects suffice —
// the injection middleware only constructs the Drizzle/R2 wrappers, which do not touch the bindings.
const env: Env = {
  DB: {} as unknown as D1Database,
  MEDIA: {} as unknown as R2Bucket,
};

describe("worker entry (Cloudflare practice-only runtime)", () => {
  it("reports all-false capabilities on /api/health", async () => {
    const res = await app.request("/api/health", undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; capabilities: Record<string, boolean> };
    };
    expect(body.data.status).toBe("ok");
    expect(body.data.capabilities).toEqual({
      aiScoring: false,
      transcription: false,
      imports: false,
    });
  });

  it("returns NOT_FOUND (not 500) for an unmounted CLI-backed route", async () => {
    const res = await app.request(
      "/api/questions/import",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } | null };
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("enforces the shared-secret header when ACCESS_SHARED_SECRET is set", async () => {
    const guarded: Env = { ...env, ACCESS_SHARED_SECRET: "s3cret" };
    const denied = await app.request("/api/health", undefined, guarded);
    expect(denied.status).toBe(401);

    const allowed = await app.request(
      "/api/health",
      { headers: { "x-access-secret": "s3cret" } },
      guarded,
    );
    expect(allowed.status).toBe(200);
  });
});
