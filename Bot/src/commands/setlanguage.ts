import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetLanguage } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setlanguage")
    .setDescription("Sets the default language for this server. (Deprecated: use /config language)")
    .addStringOption((option) =>
      option
        .setName("language")
        .setDescription("Language code (e.g. en, es, fr)")
        .setMinLength(2)
        .setMaxLength(10)
        .setRequired(true)
    ),
  execute: handleSetLanguage
};
