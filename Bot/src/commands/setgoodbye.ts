import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetGoodbye } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setgoodbye")
    .setDescription("Sets the goodbye message template. (Deprecated: use /config goodbye)")
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("Goodbye message template")
        .setMinLength(1)
        .setMaxLength(1900)
        .setRequired(true)
    ),
  execute: handleSetGoodbye
};
