import { createLogger } from "@project/shared";
import type { Pool } from "pg";
import {
  buildGuildSettings,
  type CommandOverride,
  type CommandConfig
} from "../commands/guild-settings";
import { type CommandName } from "../commands/command-names";
import { getGuildConfig } from "../commands/storage";
import { updateGuildSettings } from "../commands/guild-settings-store";

const logger = createLogger("discord");
const CACHE_TTL_MS = 0;

type CommandOverrides = Partial<Record<CommandName, CommandOverride>>;

interface CacheEntry {
  expiresAt: number;
  value: CommandOverrides;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(guildId: string): string {
  return guildId;
}

function cacheGet(guildId: string): CommandOverrides | null {
  const entry = cache.get(cacheKey(guildId));
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey(guildId));
    return null;
  }
  return entry.value;
}

function cacheSet(guildId: string, value: CommandOverrides): void {
  cache.set(cacheKey(guildId), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

async function loadCommandOverrides(
  pool: Pool,
  guildId: string
): Promise<CommandOverrides> {
  const config = await getGuildConfig(pool, guildId);
  const settings = buildGuildSettings(
    config
      ? {
          settings: config.settings ?? undefined,
          toggles: config.toggles ?? undefined,
          rulesText: config.rulesText ?? undefined,
          logsChannelId: config.logsChannelId ?? undefined
        }
      : undefined
  );
  return settings.commands;
}

export class CommandConfigStore {
  async getCommandOverrides(
    pool: Pool,
    guildId: string
  ): Promise<CommandOverrides> {
    const cached = cacheGet(guildId);
    if (cached) {
      return cached;
    }
    try {
      const overrides = await loadCommandOverrides(pool, guildId);
      cacheSet(guildId, overrides);
      return overrides;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `event=command_config_fetch_failed guild=${guildId} message="${message}"`
      );
      const fallback: CommandOverrides = {};
      cacheSet(guildId, fallback);
      return fallback;
    }
  }

  async getCommandConfig(
    pool: Pool,
    guildId: string,
    commandName: CommandName
  ): Promise<CommandConfig | null> {
    const overrides = await this.getCommandOverrides(pool, guildId);
    const override = overrides[commandName];
    if (!override) {
      return null;
    }
    return { command: commandName, ...override };
  }

  async updateCommandConfig(
    pool: Pool,
    guildId: string,
    config: CommandConfig
  ): Promise<void> {
    const nextOverride: CommandOverride = { ...config };
    delete (nextOverride as CommandOverride & { command?: string }).command;
    await updateGuildSettings(pool, guildId, {
      commands: {
        [config.command]: nextOverride
      }
    });
    this.invalidate(guildId);
  }

  invalidate(guildId?: string): void {
    if (guildId) {
      cache.delete(cacheKey(guildId));
      return;
    }
    cache.clear();
  }
}

export const commandConfigStore = new CommandConfigStore();
