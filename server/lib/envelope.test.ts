import { describe, expect, it } from "vitest";
import { fail, ok } from "./envelope";

describe("envelope", () => {
  it("wraps success payloads with a null error", () => {
    expect(ok({ status: "ok" })).toEqual({
      data: { status: "ok" },
      error: null,
    });
  });

  it("wraps failures with a null data and a code/message", () => {
    expect(fail("NOT_FOUND", "Route not found")).toEqual({
      data: null,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
});
