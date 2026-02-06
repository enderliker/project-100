import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetWelcome } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Sets the welcome message template. (Deprecated: use /config welcome)")
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("Welcome message template")
        .setMinLength(1)
        .setMaxLength(1900)
        .setRequired(true)
    ),
  execute: handleSetWelcome
};
