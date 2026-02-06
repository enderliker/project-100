export type EnvParser<T> = (raw: string, name: string) => T;

export type EnvVarSpec<T> = {
  name: string;
  parse: EnvParser<T>;
  required?: boolean;
  default?: T;
};

export type EnvSpec<T> = {
  [K in keyof T]: EnvVarSpec<T[K]>;
};

export function loadConfig<T>(spec: EnvSpec<T>): T {
  const missing: string[] = [];
  const result = {} as T;

  for (const key of Object.keys(spec) as (keyof T)[]) {
    const entry = spec[key];
    const raw = process.env[entry.name];
    if (raw === undefined || raw === "") {
      if (entry.required) {
        missing.push(entry.name);
        continue;
      }
      if (entry.default !== undefined) {
        result[key] = entry.default;
      } else {
        result[key] = undefined as T[keyof T];
      }
      continue;
    }
    try {
      result[key] = entry.parse(raw, entry.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid value";
      throw new Error(`${entry.name} ${message}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return result;
}

export const envParsers = {
  nonEmptyString: (): EnvParser<string> => (raw, name) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("must be a non-empty string");
    }
    return trimmed;
  },
  numericString: (): EnvParser<string> => (raw, name) => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("must be a numeric string");
    }
    return trimmed;
  },
  positiveNumber: (): EnvParser<number> => (raw, name) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("must be a positive number");
    }
    return value;
  },
  optionalPositiveNumber: (): EnvParser<number | null> => (raw, name) => {
    if (!raw.trim()) {
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("must be a positive number when set");
    }
    return value;
  },
  booleanString: (): EnvParser<boolean> => (raw, name) => {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    throw new Error('must be "true" or "false"');
  },
  url: (): EnvParser<string> => (raw, name) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("must be a valid URL");
    }
    try {
      // eslint-disable-next-line no-new
      new URL(trimmed);
      return trimmed;
    } catch {
      throw new Error("must be a valid URL");
    }
  },
  urlList: (): EnvParser<string[]> => (raw, name) => {
    const urls = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (urls.length === 0) {
      throw new Error("must include at least one URL");
    }
    for (const url of urls) {
      try {
        // eslint-disable-next-line no-new
        new URL(url);
      } catch {
        throw new Error("must include only valid URLs");
      }
    }
    return urls;
  }
};
