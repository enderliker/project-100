import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

const CHOICES = ["rock", "paper", "scissors"] as const;

function getResult(player: string, bot: string): string {
  if (player === bot) {
    return "It's a tie.";
  }
  if (
    (player === "rock" && bot === "scissors") ||
    (player === "paper" && bot === "rock") ||
    (player === "scissors" && bot === "paper")
  ) {
    return "You win!";
  }
  return "You lose.";
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Play rock paper scissors.")
    .addStringOption((option) =>
      option
        .setName("choice")
        .setDescription("Your choice")
        .addChoices(
          { name: "Rock", value: "rock" },
          { name: "Paper", value: "paper" },
          { name: "Scissors", value: "scissors" }
        )
        .setRequired(true)
    ),
  execute: async (interaction, context) => {
    const playerChoice = interaction.options.getString("choice", true);
    if (!playerChoice) {
      const embed = buildEmbed(context, {
        title: "Rock Paper Scissors",
        description: "Please choose rock, paper, or scissors.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (!CHOICES.includes(playerChoice as (typeof CHOICES)[number])) {
      const embed = buildEmbed(context, {
        title: "Rock Paper Scissors",
        description: "Invalid choice.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const botChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
    const result = getResult(playerChoice, botChoice);
    const embed = buildEmbed(context, {
      title: "Rock Paper Scissors",
      description: `You chose **${playerChoice}**. I chose **${botChoice}**. ${result}`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
