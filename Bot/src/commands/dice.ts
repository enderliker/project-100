import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Rolls a dice.")
    .addIntegerOption((option) =>
      option
        .setName("sides")
        .setDescription("Number of sides (default 6)")
        .setMinValue(2)
        .setMaxValue(1000)
        .setRequired(false)
    ),
  execute: async (interaction, context) => {
    const sides = interaction.options.getInteger("sides") ?? 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    const embed = buildEmbed(context, {
      title: "Dice Roll",
      description: `Rolled a ${roll} (1-${sides}).`
    });
    await safeRespond(interaction, { embeds: [embed] });
  }
};