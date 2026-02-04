import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flips a coin."),
  execute: async (interaction, context) => {
    const result = Math.random() < 0.5 ? "Heads" : "Tails";
    const embed = buildEmbed(context, {
      title: "Coin Flip",
      description: result
    });
    await interaction.reply({ embeds: [embed] });
  }
};
