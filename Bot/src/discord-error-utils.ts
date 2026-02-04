export type DiscordErrorInfo = {
  code?: string | number;
  status?: number;
  message?: string;
};

export function getErrorInfo(error: unknown): DiscordErrorInfo {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const { code, status, message } = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const info: DiscordErrorInfo = {};
  if (typeof code === "string" || typeof code === "number") {
    info.code = code;
  }
  if (typeof status === "number") {
    info.status = status;
  }
  if (typeof message === "string") {
    info.message = message;
  }
  return info;
}
