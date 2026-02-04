import type { Command } from "./Command";
import type { CommandContext } from "./Context";
import { commandConfigStore } from "./command-config-store";
import { isCommandName } from "../commands/command-names";

export interface CommandPermissionResult {
  ok: boolean;
  message?: string;
  cooldownOverride?: number;
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

  if (config.denyUsers?.includes(context.user.id)) {
    return {
      ok: false,
      message: "You are not allowed to use this command."
    };
  }

  if (context.member) {
    const memberRoleIds = new Set(context.member.roles.cache.map((role) => role.id));
    if (config.denyRoles?.some((roleId) => memberRoleIds.has(roleId))) {
      return {
        ok: false,
        message: "You are not allowed to use this command."
      };
    }
  }

  const allowUsers = config.allowUsers ?? [];
  const allowRoles = config.allowRoles ?? [];
  if (allowUsers.length > 0 || allowRoles.length > 0) {
    const isAllowedUser = allowUsers.includes(context.user.id);
    const memberRoleIds = context.member
      ? new Set(context.member.roles.cache.map((role) => role.id))
      : new Set<string>();
    const isAllowedRole = allowRoles.some((roleId) => memberRoleIds.has(roleId));
    if (!isAllowedUser && !isAllowedRole) {
      return {
        ok: false,
        message: "You are not allowed to use this command."
      };
    }
  }

  return { ok: true, cooldownOverride: config.cooldownSeconds };
}
