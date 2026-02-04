import { SlashCommandBuilder, type TextChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasModAccess,
  logModerationAction,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

const MAX_CLEAR = 100;

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Deletes a specified number of recent messages in the current channel.")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete")
        .setMinValue(1)
        .setMaxValue(MAX_CLEAR)
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
    if (!hasModAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to clear messages.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !("bulkDelete" in channel)) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const amount = interaction.options.getInteger("amount", true);
    if (amount === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Amount",
        description: "Please provide a valid number of messages to delete.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const deleted = await (channel as TextChannel).bulkDelete(amount, true);
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Clear",
      channel.id,
      `Deleted ${deleted} messages`
    );
    const embed = buildEmbed(context, {
      title: "Messages Cleared",
      description: `Deleted ${deleted} messages.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
