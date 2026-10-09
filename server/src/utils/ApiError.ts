export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_PAYMENT'
  | 'INSUFFICIENT_STOCK'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_STATUS_TRANSITION'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_NOT_CONFIGURED'
  | 'CANTEEN_CLOSED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_PAYMENT: 409,
  INSUFFICIENT_STOCK: 409,
  INSUFFICIENT_BALANCE: 409,
  INVALID_STATUS_TRANSITION: 409,
  PAYMENT_FAILED: 402,
  PAYMENT_NOT_CONFIGURED: 503,
  CANTEEN_CLOSED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly isOperational = true;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError('BAD_REQUEST', message, details);
  }
  static validation(message: string, details?: unknown) {
    return new ApiError('VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'You need to sign in to continue.') {
    return new ApiError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'The requested resource was not found.') {
    return new ApiError('NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError('CONFLICT', message, details);
  }
}

/** Wraps an async route handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (...args: any[]) => unknown>(fn: T) {
  return (...args: Parameters<T>): void => {
    void Promise.resolve(fn(...args)).catch(args[2] as (err: unknown) => void);
  };
}