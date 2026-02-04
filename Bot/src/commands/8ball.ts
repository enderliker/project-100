import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

const RESPONSES = [
  "It is certain.",
  "It is decidedly so.",
  "Without a doubt.",
  "Yes — definitely.",
  "You may rely on it.",
  "As I see it, yes.",
  "Most likely.",
  "Outlook good.",
  "Yes.",
  "Signs point to yes.",
  "Reply hazy, try again.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict now.",
  "Concentrate and ask again.",
  "Don't count on it.",
  "My reply is no.",
  "My sources say no.",
  "Outlook not so good.",
  "Very doubtful."
];

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("Get a random response.")
    .addStringOption((option) =>
      option.setName("question").setDescription("Your question").setRequired(true)
    ),
  execute: async (interaction, context) => {
    const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];
    const embed = buildEmbed(context, {
      title: "8ball",
      description: response
    });
    await interaction.reply({ embeds: [embed] });
  }
};
