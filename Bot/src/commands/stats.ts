import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("stats").setDescription("Shows bot statistics."),
  execute: async (interaction, context) => {
    const memory = process.memoryUsage();
    const lines = [
      `Uptime: ${Math.round(process.uptime())}s`,
      `RSS: ${(memory.rss / 1024 / 1024).toFixed(1)} MB`,
      `Heap: ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(memory.heapTotal / 1024 / 1024).toFixed(1)} MB`
    ];
    const embed = buildEmbed(context, {
      title: "Stats",
      description: lines.join("\n")
    });
    await safeRespond(interaction, { embeds: [embed] });
  }
};