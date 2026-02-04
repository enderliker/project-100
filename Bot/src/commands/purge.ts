import { SlashCommandBuilder } from "discord.js";
import type { Message, TextBasedChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  handleCommandError,
  logModerationAction,
  requireBotPermissions,
  requireChannelPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

const MAX_PURGE = 100;

type PurgeChannel = {
  messages: {
    fetch: (options: { limit: number }) => Promise<Map<string, Message>>;
  };
  bulkDelete: (
    messages: Map<string, Message> | Message[],
    filterOld?: boolean
  ) => Promise<Map<string, Message>>;
};

function canPurge(channel: TextBasedChannel): channel is TextBasedChannel & PurgeChannel {
  return "messages" in channel && "bulkDelete" in channel;
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Deletes a specified number of messages from a specific user in the channel.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User whose messages to delete").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages to scan")
        .setMinValue(1)
        .setMaxValue(MAX_PURGE)
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
      "purge messages"
    );
    if (!botMember) {
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !canPurge(channel)) {
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
      "purge messages"
    );
    if (!hasChannelPermissions) {
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "User Not Found",
        description: "Please specify a valid user to purge.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const amount = interaction.options.getInteger("amount", true);
    if (amount === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Amount",
        description: "Please specify a valid number of messages to scan.",
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    await safeDefer(interaction, { ephemeral: true });
    let fetched: Map<string, Message>;
    try {
      fetched = await channel.messages.fetch({ limit: amount });
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Purge Failed",
        description: "Unable to fetch messages for purge."
      });
      return;
    }
    const messages = Array.from(fetched.values()).filter(
      (message) => message.author.id === target.id
    );
    let deleted: Map<string, Message>;
    try {
      deleted = await channel.bulkDelete(messages, true);
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Purge Failed",
        description: "Unable to delete messages. Please check my permissions."
      });
      return;
    }
    const deletedCount = deleted.size;
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Purge",
      formatUserLabel(target),
      `Deleted ${deletedCount} messages`
    );
    const embed = buildEmbed(context, {
      title: "Messages Purged",
      description: `Deleted ${deletedCount} messages from ${formatUserLabel(target)}.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
};
