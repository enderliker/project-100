import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetPrefix } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setprefix")
    .setDescription("Sets the command prefix for this server. (Deprecated: use /config prefix)")
    .addStringOption((option) =>
      option
        .setName("prefix")
        .setDescription("Prefix to use")
        .setMinLength(1)
        .setMaxLength(5)
        .setRequired(true)
    ),
  execute: handleSetPrefix
};
