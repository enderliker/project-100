import type { PermissionResolvable } from "discord.js";
import type { Command } from "./Command";
import type { CommandContext } from "./Context";
import { commandConfigStore } from "./command-config-store";
import { isCommandName, type CommandName } from "../commands/command-names";
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
  config: CommandConfig,
  options: { isModeration: boolean }
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

  if (!options.isModeration) {
    const hasAllowEntries = filteredAllowRoles.length > 0 || allowUsers.values.length > 0;
    if (hasAllowEntries) {
      changed = true;
    }
    return {
      allowRoles: [],
      denyRoles: filteredDenyRoles,
      allowUsers: [],
      denyUsers: denyUsers.values,
      changed
    };
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

type PermissionPolicy = {
  all?: PermissionResolvable[];
  any?: PermissionResolvable[];
};

const MODERATION_PERMISSION_POLICIES: Partial<Record<CommandName, PermissionPolicy>> = {
  ban: { all: ["BanMembers"] },
  unban: { all: ["BanMembers"] },
  kick: { all: ["KickMembers"] },
  timeout: { all: ["ModerateMembers"] },
  untimeout: { all: ["ModerateMembers"] },
  warn: { all: ["ModerateMembers"] },
  warnings: { all: ["ModerateMembers"] },
  clear: { all: ["ManageMessages"] },
  purge: { all: ["ManageMessages"] },
  lock: { all: ["ManageChannels"] },
  unlock: { all: ["ManageChannels"] },
  slowmode: { all: ["ManageChannels"] },
  nick: { all: ["ManageNicknames"] },
  logs: {
    any: ["BanMembers", "KickMembers", "ModerateMembers", "ManageMessages"]
  },
  say: { all: ["ManageMessages"] },
  report: { all: ["ModerateMembers"] }
};

function getPermissionPolicy(commandName: CommandName): PermissionPolicy | null {
  return MODERATION_PERMISSION_POLICIES[commandName] ?? null;
}

export function isModerationCommand(commandName: CommandName): boolean {
  return Boolean(getPermissionPolicy(commandName));
}

function hasNativePermissions(
  policy: PermissionPolicy | null,
  context: CommandContext
): boolean {
  if (!policy || !context.member) {
    return false;
  }
  if (context.member.permissions.has("Administrator")) {
    return true;
  }
  if (policy.any && policy.any.length > 0) {
    return policy.any.some((permission) => context.member?.permissions.has(permission));
  }
  if (policy.all && policy.all.length > 0) {
    return policy.all.every((permission) => context.member?.permissions.has(permission));
  }
  return false;
}

export async function canUseCommand(
  command: Command,
  context: CommandContext
): Promise<CommandPermissionResult> {
  if (!context.guild || !context.postgresPool) {
    return { ok: true };
  }

  if (!isCommandName(command.name)) {
    return { ok: true };
  }
  const commandName = command.name as CommandName;
  const permissionPolicy = getPermissionPolicy(commandName);
  const isModeration = Boolean(permissionPolicy);

  const config = await commandConfigStore.getCommandConfig(
    context.postgresPool,
    context.guild.id,
    commandName
  );
  if (config?.enabled === false) {
    return {
      ok: false,
      message: "This command is disabled for this server."
    };
  }

  const baseConfig: CommandConfig = config ?? { command: commandName };
  const normalized = normalizeCommandConfig(context, baseConfig, { isModeration });
  if (config && normalized.changed) {
    await commandConfigStore.updateCommandConfig(context.postgresPool, context.guild.id, {
      ...baseConfig,
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

  if (!isModeration) {
    return { ok: true, cooldownOverride: config?.cooldownSeconds };
  }

  if (!context.member || !context.guild) {
    return {
      ok: false,
      message: "This command can only be used in a server."
    };
  }

  if (hasNativePermissions(permissionPolicy, context)) {
    return { ok: true, cooldownOverride: config?.cooldownSeconds };
  }

  const allowUsers = normalized.allowUsers;
  const allowRoles = normalized.allowRoles;
  const isAllowedUser = allowUsers.includes(context.user.id);
  const isAllowedRole = allowRoles.some((roleId) => memberRoleIds.has(roleId));
  if (isAllowedUser || isAllowedRole) {
    return { ok: true, cooldownOverride: config?.cooldownSeconds };
  }

  return {
    ok: false,
    message: "You do not have permission to run this command."
  };
}
