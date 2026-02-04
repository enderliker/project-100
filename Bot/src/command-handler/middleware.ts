import type { Command } from "./Command";
import type { CommandContext } from "./Context";
import { canUseCommand } from "./command-permissions";

const cooldowns = new Map<string, number>();

export interface MiddlewareResult {
  ok: boolean;
  message?: string;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseAllowlist(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return new Set(entries);
}

function checkGuildDmRules(command: Command, context: CommandContext): MiddlewareResult {
  if (command.guildOnly && !context.guild) {
    return {
      ok: false,
      message: "This command can only be used in a server."
    };
  }
  if (command.dmOnly && context.guild) {
    return {
      ok: false,
      message: "This command can only be used in DMs."
    };
  }
  return { ok: true };
}

function resolveCooldownSeconds(
  command: Command,
  overrideCooldown: number | undefined
): number | null {
  if (typeof overrideCooldown === "number" && overrideCooldown >= 0) {
    return overrideCooldown;
  }
  if (!command.cooldownSeconds || command.cooldownSeconds <= 0) {
    return null;
  }
  return command.cooldownSeconds;
}

function checkCooldown(
  command: Command,
  context: CommandContext,
  overrideCooldown?: number
): MiddlewareResult {
  const cooldownSeconds = resolveCooldownSeconds(command, overrideCooldown);
  if (!cooldownSeconds) {
    return { ok: true };
  }
  const key = `${context.user.id}:${command.name}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(key);
  const cooldownMs = cooldownSeconds * 1000;
  if (lastUsed && now - lastUsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastUsed)) / 1000);
    return {
      ok: false,
      message: `Please wait ${remaining}s before using this command again.`
    };
  }
  cooldowns.set(key, now);
  return { ok: true };
}

function checkMaintenance(context: CommandContext): MiddlewareResult {
  const maintenanceEnabled = parseBooleanEnv(process.env.BOT_MAINTENANCE_MODE);
  if (!maintenanceEnabled) {
    return { ok: true };
  }
  const allowlist = parseAllowlist(process.env.BOT_MAINTENANCE_ALLOWLIST);
  if (allowlist.has(context.user.id)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: "Bot maintenance is in progress. Please try again later."
  };
}

export async function runMiddleware(
  command: Command,
  context: CommandContext
): Promise<MiddlewareResult> {
  const checks = [
    () => checkMaintenance(context),
    () => checkGuildDmRules(command, context)
  ];

  for (const check of checks) {
    const result = check();
    if (!result.ok) {
      return result;
    }
  }

  const overrideResult = await canUseCommand(command, context);
  if (!overrideResult.ok) {
    return overrideResult;
  }

  return checkCooldown(command, context, overrideResult.cooldownOverride);
}
