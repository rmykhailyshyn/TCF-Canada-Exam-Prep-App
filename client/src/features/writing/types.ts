import type { WritingMode } from "../../lib/api";

// spec: docs/specs/writing-ui.md §Entry & mode selection
export type WritingConfig = {
  mode: WritingMode;
  // Training mode only: a single task ([n]) or all three (undefined / [1,2,3]). Ignored in real mode.
  taskNumbers?: number[];
};

// spec: docs/specs/writing-ui.md §Editor.6 — words counted like the server (whitespace-split).
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
