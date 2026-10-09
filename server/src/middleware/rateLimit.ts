import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config/env';

const defaults: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { name: 'RateLimited', message: 'Too many requests, please slow down and try again shortly.' } },
};

const skipInTest = config.isTest ? () => true : undefined;

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  skip: skipInTest,
  ...defaults,
});

/** Tight limiter for credential endpoints to stop brute-force attempts. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  skipSuccessfulRequests: true,
  skip: skipInTest,
  ...defaults,
  message: {
    error: { name: 'RateLimited', message: 'Too many authentication attempts. Please try again in 15 minutes.' },
  },
});

/** Limits order + wallet creation so a compromised session cannot spam the kitchen. */
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  skip: skipInTest,
  ...defaults,
});