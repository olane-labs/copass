/**
 * Base error for all Copass API errors.
 */
export class CopassApiError extends Error {
  constructor(
    message: string,
    /** HTTP status code. */
    public readonly status: number,
    /** Raw response body. */
    public readonly body?: unknown,
    /** The request path that failed. */
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'CopassApiError';
  }
}

/**
 * Network-level error (DNS, timeout, connection refused).
 */
export class CopassNetworkError extends Error {
  constructor(
    message: string,
    /** The underlying error. */
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'CopassNetworkError';
  }
}

/**
 * Client-side validation error (invalid parameters before sending request).
 */
export class CopassValidationError extends Error {
  constructor(
    message: string,
    /** The field(s) that failed validation. */
    public readonly fields?: string[],
  ) {
    super(message);
    this.name = 'CopassValidationError';
  }
}
