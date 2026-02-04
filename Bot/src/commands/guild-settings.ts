export interface CommandOverride {
  enabled?: boolean;
  cooldownSeconds?: number;
  allowRoles?: string[];
  denyRoles?: string[];
  allowUsers?: string[];
  denyUsers?: string[];
}

export interface RulesConfig {
  entries: string[];
  channelId: string | null;
  messageId: string | null;
  pin: boolean;
  title: string;
}

export interface GuildSettings {
  language: string;
  loggingChannelId: string | null;
  embed: {
    color: number | null;
  };
  translation: {
    enabled: boolean;
    defaultTarget: string;
    defaultSource: string | null;
    provider: string;
  };
  moderation: {
    requireReason: boolean;
    defaultTimeoutMinutes: number;
  };
  features: {
    welcome: boolean;
    goodbye: boolean;
    autorole: boolean;
    logs: boolean;
    rules: boolean;
  };
  commands: Record<string, CommandOverride>;
  rules: RulesConfig;
}

export type GuildSettingsUpdate = DeepPartial<GuildSettings>;

export interface LegacyGuildConfigInput {
  settings?: GuildSettings | null;
  toggles?: Record<string, boolean> | null;
  rulesText?: string | null;
  logsChannelId?: string | null;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<U>
    : T[K] extends object
    ? DeepPartial<T[K]>
    : T[K];
};

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  language: "en",
  loggingChannelId: null,
  embed: {
    color: null
  },
  translation: {
    enabled: true,
    defaultTarget: "en",
    defaultSource: null,
    provider: "libretranslate"
  },
  moderation: {
    requireReason: false,
    defaultTimeoutMinutes: 10
  },
  features: {
    welcome: true,
    goodbye: true,
    autorole: true,
    logs: true,
    rules: true
  },
  commands: {},
  rules: {
    entries: [],
    channelId: null,
    messageId: null,
    pin: false,
    title: "Server Rules"
  }
};

function cloneDefaults(): GuildSettings {
  return JSON.parse(JSON.stringify(DEFAULT_GUILD_SETTINGS)) as GuildSettings;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry)).filter((entry) => entry.length > 0);
}

function normalizeCommandOverride(value: CommandOverride | undefined): CommandOverride | undefined {
  if (!value) {
    return undefined;
  }
  return {
    enabled: value.enabled,
    cooldownSeconds:
      typeof value.cooldownSeconds === "number" && value.cooldownSeconds >= 0
        ? value.cooldownSeconds
        : undefined,
    allowRoles: normalizeStringArray(value.allowRoles),
    denyRoles: normalizeStringArray(value.denyRoles),
    allowUsers: normalizeStringArray(value.allowUsers),
    denyUsers: normalizeStringArray(value.denyUsers)
  };
}

function normalizeLanguage(value: string | undefined): string {
  if (!value || typeof value !== "string") {
    return DEFAULT_GUILD_SETTINGS.language;
  }
  return value.trim().toLowerCase() || DEFAULT_GUILD_SETTINGS.language;
}

function normalizeRulesEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 25);
}

export function mergeGuildSettings(base: GuildSettings, update: GuildSettingsUpdate): GuildSettings {
  const merged: GuildSettings = {
    ...base,
    ...update,
    embed: {
      ...base.embed,
      ...(update.embed ?? {})
    },
    translation: {
      ...base.translation,
      ...(update.translation ?? {})
    },
    moderation: {
      ...base.moderation,
      ...(update.moderation ?? {})
    },
    features: {
      ...base.features,
      ...(update.features ?? {})
    },
    rules: {
      ...base.rules,
      ...(update.rules ?? {})
    },
    commands: {
      ...base.commands
    }
  };

  if (update.commands) {
    for (const [command, override] of Object.entries(update.commands)) {
      if (!override) {
        continue;
      }
      merged.commands[command] = {
        ...base.commands[command],
        ...override
      };
    }
  }

  return normalizeGuildSettings(merged);
}

export function normalizeGuildSettings(settings: GuildSettings): GuildSettings {
  const normalized: GuildSettings = {
    ...settings,
    language: normalizeLanguage(settings.language),
    loggingChannelId: settings.loggingChannelId ?? null,
    embed: {
      color: settings.embed?.color ?? null
    },
    translation: {
      enabled: settings.translation?.enabled ?? true,
      defaultTarget: normalizeLanguage(settings.translation?.defaultTarget),
      defaultSource: settings.translation?.defaultSource ?? null,
      provider: settings.translation?.provider ?? DEFAULT_GUILD_SETTINGS.translation.provider
    },
    moderation: {
      requireReason: settings.moderation?.requireReason ?? false,
      defaultTimeoutMinutes:
        typeof settings.moderation?.defaultTimeoutMinutes === "number"
          ? settings.moderation.defaultTimeoutMinutes
          : DEFAULT_GUILD_SETTINGS.moderation.defaultTimeoutMinutes
    },
    features: {
      welcome: settings.features?.welcome ?? true,
      goodbye: settings.features?.goodbye ?? true,
      autorole: settings.features?.autorole ?? true,
      logs: settings.features?.logs ?? true,
      rules: settings.features?.rules ?? true
    },
    commands: {},
    rules: {
      entries: normalizeRulesEntries(settings.rules?.entries),
      channelId: settings.rules?.channelId ?? null,
      messageId: settings.rules?.messageId ?? null,
      pin: settings.rules?.pin ?? false,
      title: settings.rules?.title?.trim() || DEFAULT_GUILD_SETTINGS.rules.title
    }
  };

  for (const [command, override] of Object.entries(settings.commands ?? {})) {
    const normalizedOverride = normalizeCommandOverride(override);
    if (normalizedOverride) {
      normalized.commands[command] = normalizedOverride;
    }
  }

  return normalized;
}

export function buildGuildSettings(input?: LegacyGuildConfigInput | null): GuildSettings {
  const base = cloneDefaults();
  const settings = input?.settings ? mergeGuildSettings(base, input.settings) : base;

  if (input?.logsChannelId && !settings.loggingChannelId) {
    settings.loggingChannelId = input.logsChannelId;
  }

  if (input?.toggles) {
    for (const [feature, enabled] of Object.entries(input.toggles)) {
      if (feature in settings.features) {
        settings.features = {
          ...settings.features,
          [feature]: enabled
        };
      }
    }
  }

  if (settings.rules.entries.length === 0 && input?.rulesText) {
    const legacyEntries = input.rulesText
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    settings.rules.entries = legacyEntries.length > 0 ? legacyEntries : [input.rulesText];
  }

  return normalizeGuildSettings(settings);
}
