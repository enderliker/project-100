import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasModAccess,
  requireBotPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message as the bot.")
    .addStringOption((option) =>
      option.setName("message").setDescription("Message to send").setRequired(true)
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
        description: "You do not have permission to use /say.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["SendMessages"],
      "send messages"
    );
    if (!botMember) {
      return;
    }
    const message = interaction.options.getString("message", true);
    if (message === null) {
      const embed = buildEmbed(context, {
        title: "Invalid Message",
        description: "Please provide a valid message to send.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    try {
      await channel.send({ content: message });
    } catch {
      const embed = buildEmbed(context, {
        title: "Message Failed",
        description: "Unable to send that message. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const embed = buildEmbed(context, {
      title: "Message Sent",
      description: "Your message has been sent."
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
