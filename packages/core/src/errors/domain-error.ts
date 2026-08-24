export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409 | 412 | 422 | 428 | 503,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
