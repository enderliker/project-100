import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Creates a simple poll.")
    .addStringOption((option) =>
      option.setName("question").setDescription("Poll question").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("options")
        .setDescription("Comma-separated list of options")
        .setRequired(true)
    ),
  execute: async (interaction, context) => {
    const question = interaction.options.getString("question", true);
    const rawOptions = interaction.options.getString("options", true);
    if (!rawOptions) {
      const embed = buildEmbed(context, {
        title: "Poll",
        description: "Please provide poll options.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const options = rawOptions
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (options.length < 2) {
      const embed = buildEmbed(context, {
        title: "Poll",
        description: "Please provide at least two options.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const lines = options.map((option, index) => `${index + 1}. ${option}`);
    const embed = buildEmbed(context, {
      title: "Poll",
      description: `${question}\n\n${lines.join("\n")}`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
