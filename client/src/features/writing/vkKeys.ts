// spec: docs/specs/virtual-keyboard.md §Behaviour.2,4 — pure data + helpers for the accent keyboard,
// kept separate from the component so they are unit-testable and don't break fast-refresh.

export type VirtualKey = {
  /** Lowercase glyph (the default). */
  lower: string;
  /** Uppercase glyph shown while shift is active; omitted for keys unaffected by shift (guillemets). */
  upper?: string;
};

// The exact 16 keys, in the official 4×4 order (§Behaviour.4):
//   é è ê ë / à â ù û / ô î ï ç / œ æ « »
export const VK_KEYS: readonly VirtualKey[] = [
  { lower: 'é', upper: 'É' },
  { lower: 'è', upper: 'È' },
  { lower: 'ê', upper: 'Ê' },
  { lower: 'ë', upper: 'Ë' },
  { lower: 'à', upper: 'À' },
  { lower: 'â', upper: 'Â' },
  { lower: 'ù', upper: 'Ù' },
  { lower: 'û', upper: 'Û' },
  { lower: 'ô', upper: 'Ô' },
  { lower: 'î', upper: 'Î' },
  { lower: 'ï', upper: 'Ï' },
  { lower: 'ç', upper: 'Ç' },
  { lower: 'œ', upper: 'Œ' },
  { lower: 'æ', upper: 'Æ' },
  { lower: '«' },
  { lower: '»' },
];

// spec: §Behaviour.4 — shift uppercases the 14 letter keys only; guillemets (no `upper`) are unaffected.
export function glyphFor(key: VirtualKey, shift: boolean): string {
  return shift && key.upper ? key.upper : key.lower;
}

// Pure caret-aware insertion: replace [start, end) with the glyph and report the new caret position.
// spec: §Behaviour.2
export function computeInsertion(
  value: string,
  start: number,
  end: number,
  glyph: string,
): { value: string; caret: number } {
  return { value: value.slice(0, start) + glyph + value.slice(end), caret: start + glyph.length };
}
