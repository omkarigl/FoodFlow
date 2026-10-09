import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { config } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

type MongooseErrorStatics = {
  CastError?: new (...args: unknown[]) => Error & { path?: string; value?: unknown };
  ValidationError?: new (...args: unknown[]) => Error & { errors?: Record<string, { path?: string; message: string }> };
};

const MongooseErrors = mongoose.Error as unknown as MongooseErrorStatics;
const CastError = MongooseErrors.CastError;
const ValidationError = MongooseErrors.ValidationError;

export const notFoundHandler: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
};

interface BodyLike {
  name?: string;
  message?: string;
  errors?: unknown;
}

export const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let payload: BodyLike = { name: 'InternalServerError', message: 'Something went wrong on our side.' };

  const errorName = (err as Error)?.name ?? '';
  const errorCode = (err as { code?: number | string })?.code;

  if (err instanceof ApiError) {
    status = err.statusCode;
    payload = { name: err.code, message: err.message, errors: err.details };
  } else if (err instanceof ZodError) {
    status = 422;
    payload = {
      name: 'ValidationError',
      message: 'Some of the submitted values are invalid.',
      errors: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  } else if (errorName === 'ValidationError') {
    status = 422;
    const validation = err as Error & { errors?: Record<string, { path?: string; message: string }> };
    payload = {
      name: 'ValidationError',
      message: 'Some of the submitted values are invalid.',
      errors: Object.values(validation.errors ?? {}).map((e) => ({ path: e.path ?? '', message: e.message })),
    };
  } else if (errorName === 'CastError') {
    status = 400;
    payload = { name: 'BadRequest', message: `Invalid value for "${(err as { path?: string }).path ?? 'id'}".` };
  } else if (errorCode === 11000 || errorName === 'DuplicateKeyError') {
    status = 409;
    const keys = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
    payload = {
      name: 'Conflict',
      message: keys.length ? `A record with this ${keys.join(', ')} already exists.` : 'That record already exists.',
    };
  } else if (CastError && err instanceof CastError) {
    status = 400;
    payload = { name: 'BadRequest', message: `Invalid value for "${(err as { path?: string }).path ?? 'id'}".` };
  } else if (ValidationError && err instanceof ValidationError) {
    status = 422;
    payload = { name: 'ValidationError', message: 'Some of the submitted values are invalid.' };
  } else if (isMongoNetworkError(err)) {
    status = 503;
    payload = { name: 'ServiceUnavailable', message: 'Database is unavailable right now, please retry.' };
  } else if ((err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    payload = { name: 'BadRequest', message: 'Request body is not valid JSON.' };
  }

  if (status >= 500) {
    logger.error('error', `${req.method} ${req.originalUrl} -> ${status}`, (err as Error)?.stack ?? err);
  } else {
    logger.debug('error', `${req.method} ${req.originalUrl} -> ${status} ${payload.message}`);
  }

  res.status(status).json({
    error: {
      name: payload.name,
      code: (payload.name ?? 'Error').toUpperCase(),
      message: payload.message,
      ...(payload.errors ? { errors: payload.errors } : {}),
      ...(config.isProd ? {} : { stack: status >= 500 ? (err as Error)?.stack : undefined }),
    },
    requestId: req.requestId,
  });
};

function isMongoNetworkError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as Error)?.message ?? '';
  return (
    name === 'MongooseServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoServerSelectionError' ||
    message.includes('buffering timed out') ||
    message.includes('ECONNREFUSED')
  );
}