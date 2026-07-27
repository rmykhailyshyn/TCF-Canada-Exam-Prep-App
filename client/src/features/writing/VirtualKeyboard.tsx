import { useState } from "react";
import type { RefObject } from "react";
import { VK_KEYS, computeInsertion, glyphFor } from "./vkKeys";
import type { VirtualKey } from "./vkKeys";

// spec: docs/specs/virtual-keyboard.md §Behaviour.2,4,5 — on-screen accent toolbar mirroring the real
// TCF Canada exam software: a 4×4 grid of 16 keys + a `⇧ abc` shift toggle. Clicking a key inserts the
// glyph into the bound textarea at the caret, preserving native undo and reusing the editor's existing
// onChange (word count + autosave) path. Pure data/helpers live in ./vkKeys.

// Insert `glyph` into the textarea at the caret (§Behaviour.2,3,7). Primary path uses
// `execCommand('insertText')` so the insertion participates in the textarea's native undo history and
// fires the native `input` event — which means the editor's existing onChange (word count + debounced
// autosave) runs unchanged. Falls back to a native value-setter + dispatched `input` event for
// environments where execCommand is unavailable.
function insertIntoTextarea(
  textarea: HTMLTextAreaElement,
  glyph: string,
): void {
  textarea.focus();
  let inserted = false;
  try {
    inserted =
      typeof document !== "undefined" &&
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, glyph);
  } catch {
    inserted = false;
  }
  if (inserted) return;

  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const { value, caret } = computeInsertion(textarea.value, start, end, glyph);
  // Use the native setter so React's value tracker sees the change and onChange fires.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- native value setter is invoked with an explicit `this` via setter.call(textarea, …) below, so it is never called unbound.
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
}

type Props = { textareaRef: RefObject<HTMLTextAreaElement> };

export function VirtualKeyboard({ textareaRef }: Props): JSX.Element {
  const [shift, setShift] = useState(false);

  function insert(key: VirtualKey): void {
    const textarea = textareaRef.current;
    if (textarea) insertIntoTextarea(textarea, glyphFor(key, shift));
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-card">
      <div className="grid grid-cols-4 gap-1.5">
        {VK_KEYS.map((key) => {
          const glyph = glyphFor(key, shift);
          return (
            <button
              key={key.lower}
              type="button"
              aria-label={`Insert ${glyph}`}
              // Keep the textarea focused/selected so the insert targets it (no blur on mousedown).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(key)}
              className="rounded-xl border border-slate-200 bg-white py-2 text-base text-slate-800 transition hover:border-brand-300 hover:bg-brand-50/60 active:scale-[0.97]"
              lang="fr"
            >
              {glyph}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-pressed={shift}
        aria-label="Toggle uppercase accents"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShift((s) => !s)}
        className={`mt-1.5 w-full rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
          shift
            ? "border-brand-500 bg-brand-600 text-white shadow-brand-glow"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        ⇧ abc
      </button>
    </div>
  );
}
