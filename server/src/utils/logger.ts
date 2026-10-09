type Level = 'info' | 'warn' | 'error' | 'debug';

const colors: Record<Level, string> = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};
const reset = '\x1b[0m';

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const stamp = new Date().toISOString().slice(11, 23);
  const line = `${colors[level]}${stamp} ${level.toUpperCase().padEnd(5)}${reset} [${scope}] ${message}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta),
  debug: (scope: string, message: string, meta?: unknown) => emit('debug', scope, message, meta),
};