export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "APP_ERROR",
  ) {
    super(message);
  }
}

export function assert(condition: unknown, statusCode: number, message: string, code?: string): asserts condition {
  if (!condition) throw new AppError(statusCode, message, code);
}
