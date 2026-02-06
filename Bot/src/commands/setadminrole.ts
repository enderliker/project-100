import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { handleSetAdminRole } from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setadminrole")
    .setDescription("Sets the admin role for this server. (Deprecated: use /config adminrole)")
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to grant admin access").setRequired(true)
    ),
  execute: handleSetAdminRole
};
