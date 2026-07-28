import { vi } from "vitest";

// jsdom implements neither MediaRecorder, getUserMedia nor URL.createObjectURL. These doubles give
// the speaking hook a controllable recorder: `latest()` hands the test the live instance so it can
// drive ondataavailable / onstop exactly as a browser would.

export type FakeRecorder = {
  state: "inactive" | "recording" | "paused";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start: () => void;
  stop: () => void;
  /** Emit a chunk then fire onstop, the sequence a real recorder produces. */
  emit: (bytes?: number) => void;
};

export type MediaHarness = {
  latest: () => FakeRecorder | null;
  /** Tracks stopped via stream.getTracks()[].stop() — asserts the mic is released. */
  stoppedTracks: () => number;
  revoked: () => string[];
};

/**
 * Install MediaRecorder / navigator.mediaDevices / URL object-URL stubs.
 * `grantMic: false` makes getUserMedia reject, exercising the permission-denied path.
 */
export function stubMedia(options: { grantMic?: boolean } = {}): MediaHarness {
  const { grantMic = true } = options;
  let latest: FakeRecorder | null = null;
  let stoppedTracks = 0;
  const revoked: string[] = [];

  // Built as an object literal rather than a class so nothing has to alias `this` to hand the live
  // instance back to the test.
  function makeRecorder(mimeType: string): FakeRecorder {
    const rec: FakeRecorder = {
      state: "inactive",
      mimeType,
      ondataavailable: null,
      onstop: null,
      start: () => {
        rec.state = "recording";
      },
      stop: () => {
        rec.state = "inactive";
        rec.emit();
      },
      emit: (bytes = 8) => {
        rec.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
        rec.onstop?.();
      },
    };
    return rec;
  }

  const FakeMediaRecorder = Object.assign(
    function FakeMediaRecorder(
      _stream: unknown,
      opts?: { mimeType?: string },
    ): FakeRecorder {
      latest = makeRecorder(opts?.mimeType ?? "audio/webm");
      return latest;
    },
    {
      isTypeSupported: (type: string) => type === "audio/webm;codecs=opus",
    },
  );

  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaDevices: {
      getUserMedia: vi.fn(() =>
        grantMic
          ? Promise.resolve({
              getTracks: () => [
                {
                  stop: () => {
                    stoppedTracks += 1;
                  },
                },
              ],
            })
          : Promise.reject(new Error("NotAllowedError")),
      ),
    },
  });

  let n = 0;
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => `blob:take-${String(++n)}`),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });

  return {
    latest: () => latest,
    stoppedTracks: () => stoppedTracks,
    revoked: () => revoked,
  };
}
