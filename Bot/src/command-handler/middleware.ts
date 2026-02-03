import type { PermissionResolvable } from "discord.js";
import type { Command } from "./Command";
import type { CommandContext } from "./Context";

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

function getMissingPermissions(
  permissions: PermissionResolvable[],
  context: CommandContext
): PermissionResolvable[] {
  if (!context.member) {
    return permissions;
  }
  const memberPermissions = context.member.permissions;
  return permissions.filter((permission) => !memberPermissions.has(permission));
}

function checkPermissions(command: Command, context: CommandContext): MiddlewareResult {
  if (!command.permissions || command.permissions.length === 0) {
    return { ok: true };
  }
  if (!context.guild || !context.member) {
    return {
      ok: false,
      message: "This command can only be used in a server."
    };
  }
  const missing = getMissingPermissions(command.permissions, context);
  if (missing.length > 0) {
    return {
      ok: false,
      message: "You do not have permission to run this command."
    };
  }
  return { ok: true };
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

function checkCooldown(command: Command, context: CommandContext): MiddlewareResult {
  if (!command.cooldownSeconds || command.cooldownSeconds <= 0) {
    return { ok: true };
  }
  const key = `${context.user.id}:${command.name}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(key);
  const cooldownMs = command.cooldownSeconds * 1000;
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

export function runMiddleware(command: Command, context: CommandContext): MiddlewareResult {
  const checks = [
    () => checkMaintenance(context),
    () => checkGuildDmRules(command, context),
    () => checkPermissions(command, context),
    () => checkCooldown(command, context)
  ];

  for (const check of checks) {
    const result = check();
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}
