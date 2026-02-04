import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("ship")
    .setDescription("Generates a compatibility score between two users.")
    .addUserOption((option) =>
      option.setName("user1").setDescription("First user").setRequired(true)
    )
    .addUserOption((option) =>
      option.setName("user2").setDescription("Second user").setRequired(true)
    ),
  execute: async (interaction, context) => {
    const user1 = interaction.options.getUser("user1", true);
    const user2 = interaction.options.getUser("user2", true);
    if (!user1 || !user2) {
      const embed = buildEmbed(context, {
        title: "Ship",
        description: "Please select two valid users.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const score = Math.floor(Math.random() * 101);
    const embed = buildEmbed(context, {
      title: "Ship",
      description: `${user1.username} ❤️ ${user2.username}\nCompatibility: ${score}%`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
