import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  hasModAccess,
  logModerationAction,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Locks a channel by denying SendMessages for @everyone.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to lock (defaults to current channel)")
        .setRequired(false)
    ),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const pool = requirePostgres(context, (options) => interaction.reply(options));
    if (!pool) {
      return;
    }
    const config = await getGuildConfig(pool, guildContext.guild.id);
    if (!hasModAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to lock channels.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased()) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await (targetChannel as any).permissionOverwrites.edit(
      guildContext.guild.roles.everyone,
      { SendMessages: false },
      "Channel locked"
    );
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Lock",
      targetChannel.id,
      "Channel locked"
    );
    const embed = buildEmbed(context, {
      title: "Channel Locked",
      description: `Locked ${formatChannelLabel(targetChannel)}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
