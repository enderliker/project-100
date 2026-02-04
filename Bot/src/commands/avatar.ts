import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Shows a user's avatar.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to view").setRequired(false)
    ),
  execute: async (interaction, context) => {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const avatarUrl = user.displayAvatarURL({ size: 1024 });
    const embed = buildEmbed(context, {
      title: "Avatar",
      description: `<@${user.id}>`
    });
    embed.setImage(avatarUrl);
    await interaction.reply({ embeds: [embed] });
  }
};
