import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  formatUserLabel,
  hasModAccess,
  logModerationAction,
  requireBotPermissions,
  requireGuildContext,
  requirePostgres
} from "./command-utils";
import { getGuildConfig } from "./storage";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("nick")
    .setDescription("Changes a member’s nickname.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to update").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription("New nickname (leave empty to reset)")
        .setRequired(false)
    ),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const pool = requirePostgres(context, (options) => interaction.reply(options));
    if (!pool) {
      return;
    }
    const config = await getGuildConfig(pool, guildContext.guild.id);
    if (!hasModAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to change nicknames.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guildContext.guild,
      ["ManageNicknames"],
      "change nicknames"
    );
    if (!botMember) {
      return;
    }
    const targetMember = interaction.options.getMember("user", true);
    if (!targetMember) {
      const embed = buildEmbed(context, {
        title: "Member Not Found",
        description: "Please specify a valid member to update.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    if (targetMember.manageable === false) {
      const embed = buildEmbed(context, {
        title: "Cannot Update Nickname",
        description: "I cannot change this member's nickname due to role hierarchy.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const nickname = interaction.options.getString("nickname");
    try {
      await targetMember.setNickname(nickname ?? null, "Nickname update");
    } catch {
      const embed = buildEmbed(context, {
        title: "Nickname Update Failed",
        description: "Unable to update that nickname. Please check my permissions.",
        variant: "error"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    await logModerationAction(
      context,
      guildContext.guild,
      guildContext.member.id,
      "Nick",
      formatUserLabel(targetMember.user),
      nickname ?? "Nickname cleared"
    );
    const embed = buildEmbed(context, {
      title: "Nickname Updated",
      description: `Updated nickname for ${formatUserLabel(targetMember.user)}.`
    });
    await interaction.reply({ embeds: [embed] });
  }
};
