import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionBankPage } from "../pages/QuestionBankPage";
import { type Capabilities, fetchCapabilities } from "./api";
import { CapabilitiesContext } from "./capabilities";

// spec: docs/specs/content-deploy.md §Behaviour.3, 8

function renderBank(caps: Capabilities): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <CapabilitiesContext.Provider value={caps}>
        <QuestionBankPage />
      </CapabilitiesContext.Provider>
    </MemoryRouter>,
  );
}

describe("fetchCapabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed capabilities on a healthy response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          data: {
            status: "ok",
            capabilities: {
              aiScoring: true,
              transcription: true,
              imports: true,
            },
          },
          error: null,
        }),
      })),
    );
    await expect(fetchCapabilities()).resolves.toEqual({
      aiScoring: true,
      transcription: true,
      imports: true,
    });
  });

  // spec: §Behaviour.8 — default-deny on any failure (network/error envelope/malformed payload).
  it("falls back to all-false when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchCapabilities()).resolves.toEqual({
      aiScoring: false,
      transcription: false,
      imports: false,
    });
  });

  it("falls back to all-false when capabilities are missing or malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          data: { status: "ok", capabilities: { aiScoring: "yes" } },
          error: null,
        }),
      })),
    );
    await expect(fetchCapabilities()).resolves.toEqual({
      aiScoring: false,
      transcription: false,
      imports: false,
    });
  });
});

describe("QuestionBankPage import gating", () => {
  it("shows the import panel when imports is true", () => {
    const html = renderBank({
      aiScoring: true,
      transcription: true,
      imports: true,
    });
    expect(html).toContain("Override existing questions");
    expect(html).toContain("Export");
  });

  // spec: §Behaviour.3 — online (imports=false) hides the import panel, keeps export.
  it("hides the import panel and keeps export when imports is false", () => {
    const html = renderBank({
      aiScoring: false,
      transcription: false,
      imports: false,
    });
    expect(html).not.toContain("Override existing questions");
    expect(html).toContain("Importing is only available in the local app.");
    expect(html).toContain("Export");
  });
});
