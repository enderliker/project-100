import type { Command } from "./Command";
import type { CommandContext } from "./Context";
import { commandConfigStore } from "./command-config-store";
import { isCommandName } from "../commands/command-names";
import { getGuildConfig } from "../commands/storage";
import type { CommandConfig } from "../commands/guild-settings";

export interface CommandPermissionResult {
  ok: boolean;
  message?: string;
  cooldownOverride?: number;
}

function normalizeIdList(list: string[] | undefined): { values: string[]; changed: boolean } {
  if (!Array.isArray(list)) {
    return { values: [], changed: false };
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  let changed = false;
  for (const entry of list) {
    const trimmed = String(entry).trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      changed = true;
      continue;
    }
    if (seen.has(trimmed)) {
      changed = true;
      continue;
    }
    if (trimmed !== entry) {
      changed = true;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  if (list.length !== normalized.length) {
    changed = true;
  }
  return { values: normalized, changed };
}

function normalizeCommandConfig(
  context: CommandContext,
  config: CommandConfig
): {
  allowRoles: string[];
  denyRoles: string[];
  allowUsers: string[];
  denyUsers: string[];
  changed: boolean;
} {
  const allowRoles = normalizeIdList(config.allowRoles);
  const denyRoles = normalizeIdList(config.denyRoles);
  const allowUsers = normalizeIdList(config.allowUsers);
  const denyUsers = normalizeIdList(config.denyUsers);

  const guildRoles = context.guild ? context.guild.roles.cache : null;
  let filteredAllowRoles = allowRoles.values;
  let filteredDenyRoles = denyRoles.values;
  let changed =
    allowRoles.changed || denyRoles.changed || allowUsers.changed || denyUsers.changed;

  if (guildRoles) {
    filteredAllowRoles = allowRoles.values.filter((roleId) => guildRoles.has(roleId));
    filteredDenyRoles = denyRoles.values.filter((roleId) => guildRoles.has(roleId));
    if (
      filteredAllowRoles.length !== allowRoles.values.length ||
      filteredDenyRoles.length !== denyRoles.values.length
    ) {
      changed = true;
    }
  }

  const denyRoleSet = new Set(filteredDenyRoles);
  const denyUserSet = new Set(denyUsers.values);
  const cleanedAllowRoles = filteredAllowRoles.filter((roleId) => !denyRoleSet.has(roleId));
  const cleanedAllowUsers = allowUsers.values.filter((userId) => !denyUserSet.has(userId));
  if (
    cleanedAllowRoles.length !== filteredAllowRoles.length ||
    cleanedAllowUsers.length !== allowUsers.values.length
  ) {
    changed = true;
  }

  return {
    allowRoles: cleanedAllowRoles,
    denyRoles: filteredDenyRoles,
    allowUsers: cleanedAllowUsers,
    denyUsers: denyUsers.values,
    changed
  };
}

async function hasAdminOverride(context: CommandContext): Promise<boolean> {
  if (!context.guild || !context.member || !context.postgresPool) {
    return false;
  }
  if (context.guild.ownerId && context.guild.ownerId === context.user.id) {
    return true;
  }
  if (context.member.permissions.has("Administrator")) {
    return true;
  }
  const config = await getGuildConfig(context.postgresPool, context.guild.id);
  if (config?.adminroleId && context.member.roles.cache.has(config.adminroleId)) {
    return true;
  }
  return false;
}

export async function canRunCommand(
  command: Command,
  context: CommandContext
): Promise<CommandPermissionResult> {
  if (!context.guild || !context.postgresPool) {
    return { ok: true };
  }

  if (!isCommandName(command.name)) {
    return { ok: true };
  }

  const config = await commandConfigStore.getCommandConfig(
    context.postgresPool,
    context.guild.id,
    command.name
  );
  if (!config) {
    return { ok: true };
  }

  if (config.enabled === false) {
    return {
      ok: false,
      message: "This command is disabled for this server."
    };
  }

  const normalized = normalizeCommandConfig(context, config);
  if (normalized.changed) {
    await commandConfigStore.updateCommandConfig(context.postgresPool, context.guild.id, {
      ...config,
      allowRoles: normalized.allowRoles,
      denyRoles: normalized.denyRoles,
      allowUsers: normalized.allowUsers,
      denyUsers: normalized.denyUsers
    });
  }

  if (normalized.denyUsers.includes(context.user.id)) {
    return {
      ok: false,
      message: "You are not allowed to use this command."
    };
  }

  const adminOverride = await hasAdminOverride(context);
  if (adminOverride) {
    return { ok: true, cooldownOverride: config.cooldownSeconds };
  }

  if (normalized.allowUsers.includes(context.user.id)) {
    return { ok: true, cooldownOverride: config.cooldownSeconds };
  }

  const memberRoleIds = context.member
    ? new Set(context.member.roles.cache.map((role) => role.id))
    : new Set<string>();
  const hasDeniedRole = normalized.denyRoles.some((roleId) => memberRoleIds.has(roleId));
  if (hasDeniedRole) {
    return {
      ok: false,
      message: "You are not allowed to use this command."
    };
  }

  const allowUsers = normalized.allowUsers;
  const allowRoles = normalized.allowRoles;
  if (allowUsers.length > 0 || allowRoles.length > 0) {
    const isAllowedRole = allowRoles.some((roleId) => memberRoleIds.has(roleId));
    if (!isAllowedRole) {
      return {
        ok: false,
        message: "You are not allowed to use this command."
      };
    }
  }

  return { ok: true, cooldownOverride: config.cooldownSeconds };
}
