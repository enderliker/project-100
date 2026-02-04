import { SlashCommandBuilder, type Message, type TextChannel } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  hasModAccess,
  logModerationAction,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

const MAX_PURGE = 100;

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
    const pool = requirePostgres(context, (options) => interaction.reply(options));
    if (!pool) {
      return;
    }
    const config = await getGuildConfig(pool, guildContext.guild.id);
    if (!hasModAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to purge messages.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (!target) {
      const embed = buildEmbed(context, {
        title: "Invalid User",
        description: "Please select a valid user to purge.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const amount = interaction.options.getInteger("amount", true);
    if (amount === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Amount",
        description: "Please provide a valid number of messages to scan.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const textChannel = channel as TextChannel;
    const fetched = await textChannel.messages.fetch({ limit: amount });
    const messages = Array.from(fetched.values()).filter(
      (message: Message) => message.author.id === target.id
    );
    const deleted = await textChannel.bulkDelete(messages, true);
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Purge",
      formatUserLabel(target),
      `Deleted ${deleted} messages`
    );
    const embed = buildEmbed(context, {
      title: "Messages Purged",
      description: `Deleted ${deleted} messages from ${formatUserLabel(target)}.`
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
