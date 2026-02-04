import { SlashCommandBuilder } from "discord.js";
import type { Message, TextBasedChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasModAccess,
  logModerationAction,
  requireBotPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

const MAX_CLEAR = 100;

type BulkDeleteChannel = {
  bulkDelete: (
    messages: number | Map<string, Message> | Message[],
    filterOld?: boolean
  ) => Promise<Map<string, Message>>;
};

function canBulkDelete(
  channel: TextBasedChannel
): channel is TextBasedChannel & BulkDeleteChannel {
  return "bulkDelete" in channel;
}

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
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ManageMessages"],
      "clear messages"
    );
    if (!botMember) {
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !canBulkDelete(channel)) {
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
        description: "Please specify a valid number of messages to delete.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    let deleted: Map<string, Message>;
    try {
      deleted = await channel.bulkDelete(amount, true);
    } catch {
      const embed = buildEmbed(context, {
        title: "Clear Failed",
        description: "Unable to delete messages. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const deletedCount = deleted.size;
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Clear",
      channel.id,
      `Deleted ${deletedCount} messages`
    );
    const embed = buildEmbed(context, {
      title: "Messages Cleared",
      description: `Deleted ${deletedCount} messages.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
