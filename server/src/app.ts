import path from 'node:path';
import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config/env';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { requestId } from './utils/tokens';
import { logger } from './utils/logger';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  const allowed = [config.clientUrl, ...config.extraOrigins].filter(Boolean);
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / curl / server-to-server requests (no Origin header).
        if (!origin) return callback(null, true);
        if (allowed.includes(origin)) return callback(null, true);
        if (!config.isProd && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use(cookieParser(config.cookieSecret));
  app.use((req, _res, next) => {
    req.requestId = requestId();
    next();
  });

  if (!config.isTest) {
    app.use(
      morgan(':method :url :status :response-time ms', {
        skip: (req) => req.url === '/api/health' || req.url?.startsWith('/socket.io/'),
      }),
    );
  }

  app.use('/api', apiLimiter, routes);

  // Serve the built frontend when it exists (single-server production deployment).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info('http', `Express app ready (env: ${config.nodeEnv}, payment: ${config.paymentProvider})`);
  return app;
}