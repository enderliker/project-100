export type LogPrefix =
  | "entrypoint"
  | "startup"
  | "git"
  | "redis"
  | "postgres"
  | "discord"
  | "http"
  | "health"
  | "worker"
  | "checker";

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export function createLogger(prefix: LogPrefix): Logger {
  const tag = `[${prefix}]`;
  return {
    info: (message: string) => {
      console.info(`${tag} ${message}`);
    },
    warn: (message: string) => {
      console.warn(`${tag} ${message}`);
    },
    error: (message: string) => {
      console.error(`${tag} ${message}`);
    }
  };
}
