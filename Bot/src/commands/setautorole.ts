import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetAutorole } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setautorole")
    .setDescription("Sets the autorole for new members. (Deprecated: use /config autorole)")
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to assign").setRequired(true)
    ),
  execute: handleSetAutorole
};
