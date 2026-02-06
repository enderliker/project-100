import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetModRole } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setmodrole")
    .setDescription("Sets the moderation role for this server. (Deprecated: use /config modrole)")
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to grant moderation access").setRequired(true)
    ),
  execute: handleSetModRole
};
