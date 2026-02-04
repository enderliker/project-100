import { SlashCommandBuilder } from "discord.js";
import type { Message, TextBasedChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireChannelPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

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
    const pool = requirePostgres(context, (options) => safeRespond(interaction, options));
    if (!pool) {
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
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const hasChannelPermissions = await requireChannelPermissions(
      interaction,
      context,
      channel,
      botMember,
      ["ManageMessages"],
      "clear messages"
    );
    if (!hasChannelPermissions) {
      return;
    }
    const amount = interaction.options.getInteger("amount", true);
    if (amount === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Amount",
        description: "Please specify a valid number of messages to delete.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    await safeDefer(interaction, { ephemeral: true });
    let deleted: Map<string, Message>;
    try {
      deleted = await channel.bulkDelete(amount, true);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Clear Failed",
        description: "Unable to delete messages. Please check my permissions."
      });
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
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
};
