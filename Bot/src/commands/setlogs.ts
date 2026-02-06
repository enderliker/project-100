import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetLogs } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Sets the logs channel for moderation actions. (Deprecated: use /config logs)")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to receive moderation logs")
        .setRequired(true)
    ),
  execute: handleSetLogs
};
