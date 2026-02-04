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
