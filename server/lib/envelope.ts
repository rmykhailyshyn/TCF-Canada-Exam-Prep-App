// Consistent JSON envelope shape returned by every route (see CLAUDE.md §Express).
// The envelope is constructed at the route layer only; services return plain values or throw.

export type ApiEnvelope<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

export function ok<T>(data: T): ApiEnvelope<T> {
  return { data, error: null };
}

export function fail(code: string, message: string): ApiEnvelope<never> {
  return { data: null, error: { code, message } };
}
