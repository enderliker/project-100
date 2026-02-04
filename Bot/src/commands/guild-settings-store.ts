import { createLogger } from "@project/shared";
import type { Pool } from "pg";
import type { GuildConfig } from "./storage";
import { getGuildConfig, setGuildSettings as persistGuildSettings } from "./storage";
import {
  buildGuildSettings,
  mergeGuildSettings,
  normalizeGuildSettings,
  type GuildSettings,
  type GuildSettingsUpdate
} from "./guild-settings";

const CACHE_TTL_MS = 60_000;
const settingsCache = new Map<string, { expiresAt: number; value: GuildSettings }>();
const logger = createLogger("discord");

function cacheKey(guildId: string): string {
  return guildId;
}

function cacheGet(guildId: string): GuildSettings | null {
  const entry = settingsCache.get(cacheKey(guildId));
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    settingsCache.delete(cacheKey(guildId));
    return null;
  }
  return entry.value;
}

function cacheSet(guildId: string, value: GuildSettings): void {
  settingsCache.set(cacheKey(guildId), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

export function clearGuildSettingsCache(guildId?: string): void {
  if (guildId) {
    settingsCache.delete(cacheKey(guildId));
    return;
  }
  settingsCache.clear();
}

function buildFromConfig(config: GuildConfig | null): GuildSettings {
  return buildGuildSettings(
    config
      ? {
          settings: config.settings ?? undefined,
          toggles: config.toggles ?? undefined,
          rulesText: config.rulesText ?? undefined,
          logsChannelId: config.logsChannelId ?? undefined
        }
      : undefined
  );
}

export async function getGuildSettings(pool: Pool, guildId: string): Promise<GuildSettings> {
  const cached = cacheGet(guildId);
  if (cached) {
    return cached;
  }
  try {
    const config = await getGuildConfig(pool, guildId);
    const settings = buildFromConfig(config);
    cacheSet(guildId, settings);
    return settings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`event=guild_settings_fetch_failed guild=${guildId} message="${message}"`);
    const fallback = buildFromConfig(null);
    cacheSet(guildId, fallback);
    return fallback;
  }
}

export async function updateGuildSettings(
  pool: Pool,
  guildId: string,
  update: GuildSettingsUpdate
): Promise<GuildSettings> {
  const current = await getGuildSettings(pool, guildId);
  const merged = mergeGuildSettings(current, update);
  await persistGuildSettings(pool, guildId, normalizeGuildSettings(merged));
  cacheSet(guildId, merged);
  return merged;
}
