// Typed error carrying the envelope `code` and HTTP status. Services throw these; the route
// layer catches them and renders the standard failure envelope (see CLAUDE.md §Express).

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
