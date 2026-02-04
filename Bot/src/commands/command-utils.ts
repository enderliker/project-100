import type {
  Channel,
  Guild,
  GuildMember,
  InteractionReplyOptions,
  TextBasedChannel,
  User
} from "discord.js";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type { Pool } from "pg";
import { buildBaseEmbed } from "../embeds";
import { getErrorInfo } from "../discord-error-utils";
import type { CommandExecutionContext } from "./types";
import { createModlog, getGuildConfig } from "./storage";
import { getGuildSettings } from "./guild-settings-store";

export function buildEmbed(
  context: CommandExecutionContext,
  options: { title: string; description?: string; variant?: "primary" | "warning" | "error" }
) {
  const version = context.getVersion();
  return buildBaseEmbed({ serviceName: "bot", version }, options);
}

export async function requireGuildContext(
  interaction: {
    guild: Guild | null;
    member: GuildMember | object | null;
    user: User;
    reply: Function;
  },
  context: CommandExecutionContext
): Promise<{ guild: Guild; member: GuildMember } | null> {
  const inGuild =
    "inGuild" in interaction && typeof interaction.inGuild === "function"
      ? interaction.inGuild()
      : Boolean(interaction.guild);
  if (!interaction.guild || !inGuild) {
    const embed = buildEmbed(context, {
      title: "Server Only",
      description: "This command can only be used in a server.",
      variant: "warning"
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return null;
  }
  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  if (!member) {
    const embed = buildEmbed(context, {
      title: "Member Unavailable",
      description: "Unable to resolve your member record for this server.",
      variant: "warning"
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return null;
  }
  return { guild: interaction.guild, member };
}

async function replyEphemeral(
  interaction: {
    reply: (options: InteractionReplyOptions) => Promise<void>;
    followUp?: (options: InteractionReplyOptions) => Promise<void>;
    replied?: boolean;
    deferred?: boolean;
  },
  options: InteractionReplyOptions
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    if (interaction.followUp) {
      await interaction.followUp({ ...options, ephemeral: true });
      return;
    }
  }
  await interaction.reply({ ...options, ephemeral: true });
}

export async function getMeMemberSafe(
  context: CommandExecutionContext,
  guild: Guild
): Promise<GuildMember | null> {
  if (!context.client.user) {
    return null;
  }
  try {
    // fetchMe is unavailable in this discord.js build; fetch by user id instead.
    return await guild.members.fetch(context.client.user.id);
  } catch {
    return null;
  }
}

export async function requireBotPermissions(
  interaction: {
    reply: (options: InteractionReplyOptions) => Promise<void>;
    followUp?: (options: InteractionReplyOptions) => Promise<void>;
    replied?: boolean;
    deferred?: boolean;
  },
  context: CommandExecutionContext,
  guild: Guild,
  permissions: string[],
  action: string
): Promise<GuildMember | null> {
  const botMember = await getMeMemberSafe(context, guild);
  if (!botMember) {
    const embed = buildEmbed(context, {
      title: "Bot Unavailable",
      description: "The bot member could not be resolved for this server.",
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return null;
  }
  const missing = permissions.filter((permission) => !botMember.permissions.has(permission));
  if (missing.length > 0) {
    const embed = buildEmbed(context, {
      title: "Bot Missing Permissions",
      description: `I need ${missing.join(", ")} to ${action}.`,
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return null;
  }
  return botMember;
}

export async function requireInvokerPermissions(
  interaction: {
    reply: (options: InteractionReplyOptions) => Promise<void>;
    followUp?: (options: InteractionReplyOptions) => Promise<void>;
    replied?: boolean;
    deferred?: boolean;
  },
  context: CommandExecutionContext,
  member: GuildMember,
  permissions: string[],
  action: string
): Promise<boolean> {
  const missing = permissions.filter((permission) => !member.permissions.has(permission));
  if (missing.length > 0) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: `You need ${missing.join(", ")} to ${action}.`,
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  return true;
}

// PermissionCheckChannel is intentionally unknown to accommodate discord.js type unions.
type PermissionCheckChannel = unknown;

export async function requireChannelPermissions(
  interaction: {
    reply: (options: InteractionReplyOptions) => Promise<void>;
    followUp?: (options: InteractionReplyOptions) => Promise<void>;
    replied?: boolean;
    deferred?: boolean;
  },
  context: CommandExecutionContext,
  channel: PermissionCheckChannel,
  member: GuildMember,
  permissions: string[],
  action: string
): Promise<boolean> {
  if (typeof channel !== "object" || channel === null) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: `Unable to verify permissions to ${action} in this channel.`,
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  if (
    !("permissionsFor" in channel) ||
    typeof (channel as { permissionsFor?: unknown }).permissionsFor !== "function"
  ) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: `Unable to verify permissions to ${action} in this channel.`,
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  const channelPermissions = (
    channel as {
      permissionsFor: (member: GuildMember) => { has: (permission: string) => boolean } | null;
    }
  ).permissionsFor(member);
  if (!channelPermissions) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: `Unable to verify permissions to ${action} in this channel.`,
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  const missing = permissions.filter((permission) => !channelPermissions.has(permission));
  if (missing.length > 0) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: `Missing ${missing.join(", ")} to ${action} in this channel.`,
      variant: "error"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  return true;
}

function getHighestRolePosition(member: GuildMember): number | null {
  const cache = member.roles?.cache;
  if (!cache || cache.size === 0) {
    return null;
  }
  let highest: number | null = null;
  for (const role of cache.values()) {
    const position = (role as { position?: unknown }).position;
    if (typeof position !== "number") {
      continue;
    }
    if (highest === null || position > highest) {
      highest = position;
    }
  }
  return highest;
}

function compareRolePositions(left: GuildMember, right: GuildMember): number | null {
  const leftRoles = left.roles as {
    highest?: { comparePositionTo?: (other: unknown) => number };
  };
  const rightRoles = right.roles as { highest?: unknown };
  if (leftRoles.highest && typeof leftRoles.highest.comparePositionTo === "function") {
    return leftRoles.highest.comparePositionTo(rightRoles.highest);
  }
  const leftPosition = getHighestRolePosition(left);
  const rightPosition = getHighestRolePosition(right);
  if (leftPosition === null || rightPosition === null) {
    return null;
  }
  if (leftPosition === rightPosition) {
    return 0;
  }
  return leftPosition > rightPosition ? 1 : -1;
}

export function requirePostgres(
  context: CommandExecutionContext,
  reply: (options: InteractionReplyOptions | string) => Promise<void>
): Pool | null {
  if (!context.postgresPool) {
    const embed = buildEmbed(context, {
      title: "Database Unavailable",
      description: "Database access is not configured for this bot.",
      variant: "error"
    });
    void reply({ embeds: [embed], ephemeral: true });
    return null;
  }
  return context.postgresPool;
}

export function hasRole(member: GuildMember, roleId: string | null | undefined): boolean {
  if (!roleId) {
    return false;
  }
  return member.roles.cache.has(roleId);
}

export function hasAdministratorPermission(member: GuildMember): boolean {
  return member.permissions.has("Administrator");
}

export function hasModAccess(
  member: GuildMember,
  config: { modroleId: string | null; adminroleId: string | null } | null
): boolean {
  if (config && (hasRole(member, config.modroleId) || hasRole(member, config.adminroleId))) {
    return true;
  }
  return (
    member.permissions.has("BanMembers") ||
    member.permissions.has("KickMembers") ||
    member.permissions.has("ModerateMembers") ||
    member.permissions.has("ManageMessages") ||
    hasAdministratorPermission(member)
  );
}

export function hasAdminAccess(
  member: GuildMember,
  config: { adminroleId: string | null } | null
): boolean {
  if (config && hasRole(member, config.adminroleId)) {
    return true;
  }
  return hasAdministratorPermission(member);
}

export function formatUserLabel(user: User): string {
  if (user.tag) {
    return `${user.tag} (${user.id})`;
  }
  return `${user.username} (${user.id})`;
}

export function formatChannelLabel(channel: Channel): string {
  return `<#${channel.id}>`;
}

export function trimEmbedDescription(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export async function sendLogEmbed(
  context: CommandExecutionContext,
  guild: Guild,
  options: { title: string; description: string }
): Promise<void> {
  if (!context.postgresPool) {
    return;
  }
  const [config, settings] = await Promise.all([
    getGuildConfig(context.postgresPool, guild.id),
    getGuildSettings(context.postgresPool, guild.id)
  ]);
  const logsChannelId = settings.loggingChannelId ?? config?.logsChannelId ?? null;
  if (!logsChannelId) {
    return;
  }
  let channel: Channel | null;
  try {
    channel = await context.client.channels.fetch(logsChannelId);
  } catch {
    return;
  }
  if (!channel || !channel.isTextBased()) {
    return;
  }
  const embed = buildEmbed(context, {
    title: options.title,
    description: options.description
  });
  try {
    await (channel as TextBasedChannel).send({ embeds: [embed] });
  } catch {
    return;
  }
}

export async function fetchMemberSafe(
  guild: Guild,
  userId: string
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

export async function validateModerationTarget(options: {
  interaction: {
    reply: (options: InteractionReplyOptions) => Promise<void>;
    followUp?: (options: InteractionReplyOptions) => Promise<void>;
    replied?: boolean;
    deferred?: boolean;
  };
  context: CommandExecutionContext;
  guild: Guild;
  invoker: GuildMember;
  botMember: GuildMember | null;
  targetMember: GuildMember;
  action: string;
  allowBotTargetWithAdmin?: boolean;
}): Promise<boolean> {
  const { interaction, context, guild, invoker, botMember, targetMember, action } = options;
  if (targetMember.id === invoker.id) {
    const embed = buildEmbed(context, {
      title: "Invalid Target",
      description: `You cannot ${action} yourself.`,
      variant: "warning"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  if (botMember && targetMember.id === botMember.id) {
    const embed = buildEmbed(context, {
      title: "Invalid Target",
      description: `You cannot ${action} the bot.`,
      variant: "warning"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  if (targetMember.id === guild.ownerId) {
    const embed = buildEmbed(context, {
      title: "Invalid Target",
      description: `You cannot ${action} the server owner.`,
      variant: "warning"
    });
    await replyEphemeral(interaction, { embeds: [embed] });
    return false;
  }
  if (targetMember.user.bot && options.allowBotTargetWithAdmin) {
    if (!hasAdministratorPermission(invoker)) {
      const embed = buildEmbed(context, {
        title: "Invalid Target",
        description: `You need Administrator to ${action} bot accounts.`,
        variant: "warning"
      });
      await replyEphemeral(interaction, { embeds: [embed] });
      return false;
    }
  }
  if (invoker.id !== guild.ownerId) {
    const invokerPosition = compareRolePositions(invoker, targetMember);
    if (invokerPosition === null) {
      const embed = buildEmbed(context, {
        title: "Role Hierarchy",
        description: "Unable to verify role hierarchy for this member.",
        variant: "warning"
      });
      await replyEphemeral(interaction, { embeds: [embed] });
      return false;
    }
    if (invokerPosition <= 0) {
      const embed = buildEmbed(context, {
        title: "Role Hierarchy",
        description: `You cannot ${action} a member with an equal or higher role.`,
        variant: "warning"
      });
      await replyEphemeral(interaction, { embeds: [embed] });
      return false;
    }
  }
  if (botMember) {
    const botPosition = compareRolePositions(botMember, targetMember);
    if (botPosition === null) {
      const embed = buildEmbed(context, {
        title: "Role Hierarchy",
        description: "Unable to verify role hierarchy for this member.",
        variant: "warning"
      });
      await replyEphemeral(interaction, { embeds: [embed] });
      return false;
    }
    if (botPosition <= 0) {
      const embed = buildEmbed(context, {
        title: "Role Hierarchy",
        description: `I cannot ${action} a member with an equal or higher role.`,
        variant: "warning"
      });
      await replyEphemeral(interaction, { embeds: [embed] });
      return false;
    }
  }
  return true;
}

export function mapDiscordError(error: unknown): {
  title: string;
  description: string;
  variant: "warning" | "error";
} | null {
  const { code, status } = getErrorInfo(error);
  if (typeof code !== "string" && typeof code !== "number") {
    return null;
  }
  switch (code) {
    case RESTJSONErrorCodes.MissingPermissions:
      return {
        title: "Missing Permissions",
        description: "I lack the permissions required to perform that action.",
        variant: "error"
      };
    case RESTJSONErrorCodes.MissingAccess:
      return {
        title: "Missing Access",
        description: "I no longer have access to that resource.",
        variant: "error"
      };
    case RESTJSONErrorCodes.UnknownMember:
      return {
        title: "Member Not Found",
        description: "That member could not be found in this server.",
        variant: "warning"
      };
    case RESTJSONErrorCodes.UnknownUser:
      return {
        title: "User Not Found",
        description: "That user could not be resolved.",
        variant: "warning"
      };
    case RESTJSONErrorCodes.UnknownChannel:
      return {
        title: "Channel Not Found",
        description: "That channel could not be resolved.",
        variant: "warning"
      };
    case RESTJSONErrorCodes.UnknownMessage:
      return {
        title: "Message Not Found",
        description: "That message could not be found.",
        variant: "warning"
      };
    default:
      if (status === 429) {
        return {
          title: "Rate Limited",
          description: "Discord rate limited the request. Please try again shortly.",
          variant: "warning"
        };
      }
      return null;
  }
}

export async function handleCommandError(
  interaction: {
    reply: (options: InteractionReplyOptions) => Promise<void>;
    followUp?: (options: InteractionReplyOptions) => Promise<void>;
    replied?: boolean;
    deferred?: boolean;
  },
  context: CommandExecutionContext,
  error: unknown,
  fallback: { title: string; description: string }
): Promise<void> {
  const mapped = mapDiscordError(error);
  const embed = buildEmbed(context, {
    title: mapped?.title ?? fallback.title,
    description: mapped?.description ?? fallback.description,
    variant: mapped?.variant ?? "error"
  });
  await replyEphemeral(interaction, { embeds: [embed] });
}

export async function logModerationAction(
  context: CommandExecutionContext,
  guild: Guild,
  moderatorId: string,
  action: string,
  target: string,
  reason: string
): Promise<void> {
  if (!context.postgresPool) {
    return;
  }
  await createModlog(context.postgresPool, guild.id, action, target, reason, moderatorId);
  await sendLogEmbed(context, guild, {
    title: "Moderation Log",
    description: `${action} • ${target} • ${reason}`
  });
}
