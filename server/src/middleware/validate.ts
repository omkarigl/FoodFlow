import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

type Source = 'body' | 'query' | 'params';

function formatIssues(error: unknown): Array<{ path: string; message: string }> {
  const issues = (error as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues ?? [];
  return issues.map((issue) => ({ path: issue.path.join('.') || '_root', message: issue.message }));
}

/** Validates and REPLACES the given request section with the parsed (coerced, stripped) value. */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = formatIssues(result.error);
      next(ApiError.validation(errors[0]?.message ?? 'Invalid request payload.', errors));
      return;
    }
    if (source === 'query') {
      // Express 5 exposes req.query as a getter; assign via defineProperty for safety.
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}

export function validateAll(schemas: Partial<Record<Source, ZodTypeAny>>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ path: string; message: string }> = [];
    for (const source of ['params', 'query', 'body'] as Source[]) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        errors.push(...formatIssues(result.error).map((e) => ({ path: `${source}.${e.path}`, message: e.message })));
      } else if (source === 'query') {
        Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
      } else {
        req[source] = result.data as never;
      }
    }
    if (errors.length > 0) {
      next(ApiError.validation(errors[0]?.message ?? 'Invalid request.', errors));
      return;
    }
    next();
  };
}