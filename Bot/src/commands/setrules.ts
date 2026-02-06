import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { addRulesSubcommands, handleRulesConfig } from "./config-settings";

export const command: CommandDefinition = {
  data: addRulesSubcommands(
    new SlashCommandBuilder()
      .setName("setrules")
      .setDescription("Manage the server rules. (Deprecated: use /config rules)")
  ),
  execute: handleRulesConfig
};
