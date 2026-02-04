import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig, setGuildLogsChannel } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Sets the logs channel for moderation actions.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to receive moderation logs")
        .setRequired(true)
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
    if (!hasAdminAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to update server configuration.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    if (!channel) {
      const embed = buildEmbed(context, {
        title: "Invalid Channel",
        description: "Please select a valid channel.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await setGuildLogsChannel(pool, guildContext.guild.id, channel.id);
    const embed = buildEmbed(context, {
      title: "Logs Channel Updated",
      description: `Logs channel set to ${formatChannelLabel(channel)}.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
