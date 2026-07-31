// spec: docs/specs/quiz-session.md §API contract
// The transport shared by every typed client below: unwraps the standard { data, error } envelope
// and throws ApiError on a failure envelope so callers can branch on error.code.

type Envelope<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Unwrap a response body, throwing ApiError on the failure envelope.
export async function unwrap<T>(res: Response): Promise<T> {
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error) {
    throw new ApiError(envelope.error.code, envelope.error.message);
  }
  return envelope.data;
}

export function get<T>(path: string): Promise<T> {
  return fetch(path).then((res) => unwrap<T>(res));
}

export function send<T>(
  method: "PUT" | "POST",
  path: string,
  body: unknown,
): Promise<T> {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => unwrap<T>(res));
}

export function request<T>(path: string, body: unknown): Promise<T> {
  return send<T>("POST", path, body);
}
