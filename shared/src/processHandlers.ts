export type ProcessHandlerLogger = {
  error: (message: string) => void;
  fatal?: (message: string) => void;
};

type ProcessHandlerOptions = {
  logger: ProcessHandlerLogger;
  sensitiveEnv?: string[];
};

function sanitizeStack(stack: string, sensitiveEnv: string[]): string {
  let sanitized = stack;
  for (const name of sensitiveEnv) {
    const value = process.env[name];
    if (value) {
      sanitized = sanitized.split(value).join("***");
    }
  }
  return sanitized;
}

export function registerProcessHandlers(options: ProcessHandlerOptions): void {
  const logger = options.logger;
  const sensitiveEnv = options.sensitiveEnv ?? [];

  process.on("unhandledRejection", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? message : String(error);
    logger.error(`event=unhandled_rejection message="${message}"`);
    logger.error(`stack="${sanitizeStack(stack, sensitiveEnv)}"`);
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? message : String(error);
    const logFatal = logger.fatal ?? logger.error;
    logFatal(`event=uncaught_exception message="${message}"`);
    logFatal(`stack="${sanitizeStack(stack, sensitiveEnv)}"`);
    process.exit(1);
  });
}
