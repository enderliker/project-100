import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("support").setDescription("Get support info."),
  execute: async (interaction, context) => {
    const supportUrl = "https://discord.gg/qtzDkhK2XV";
    const embed = buildEmbed(context, {
      title: "Support",
      description: supportUrl
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
  }
};