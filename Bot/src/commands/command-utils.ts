import type {
  Channel,
  Guild,
  GuildMember,
  InteractionReplyOptions,
  TextBasedChannel,
  User
} from "discord.js";
import type { Pool } from "pg";
import { buildBaseEmbed } from "../embeds";
import type { CommandExecutionContext } from "./types";
import { createModlog, getGuildConfig } from "./storage";

export function buildEmbed(
  context: CommandExecutionContext,
  options: { title: string; description?: string; variant?: "primary" | "warning" | "error" }
) {
  const version = context.getVersion();
  return buildBaseEmbed({ serviceName: "bot", version }, options);
}

export async function requireGuildContext(
  interaction: { guild: Guild | null; member: GuildMember | null; reply: Function },
  context: CommandExecutionContext
): Promise<{ guild: Guild; member: GuildMember } | null> {
  if (!interaction.guild || !interaction.member) {
    const embed = buildEmbed(context, {
      title: "Server Only",
      description: "This command can only be used in a server.",
      variant: "warning"
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return null;
  }
  return { guild: interaction.guild, member: interaction.member };
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

async function getBotMember(
  context: CommandExecutionContext,
  guild: Guild
): Promise<GuildMember | null> {
  if (guild.members.me) {
    return guild.members.me;
  }
  if (!context.client.user) {
    return null;
  }
  try {
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
  const botMember = await getBotMember(context, guild);
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
  const config = await getGuildConfig(context.postgresPool, guild.id);
  if (!config?.logsChannelId) {
    return;
  }
  const channel = await context.client.channels.fetch(config.logsChannelId);
  if (!channel || !channel.isTextBased()) {
    return;
  }
  const embed = buildEmbed(context, {
    title: options.title,
    description: options.description
  });
  await (channel as TextBasedChannel).send({ embeds: [embed] });
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
