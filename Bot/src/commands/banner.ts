import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("banner")
    .setDescription("Shows a user's banner if available.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to view").setRequired(false)
    ),
  execute: async (interaction, context) => {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const bannerUrl = user.bannerURL({ size: 1024 });
    if (!bannerUrl) {
      const embed = buildEmbed(context, {
        title: "Banner",
        description: "This user does not have a banner."
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const embed = buildEmbed(context, {
      title: "Banner",
      description: `<@${user.id}>`
    });
    embed.setImage(bannerUrl);
    await safeRespond(interaction, { embeds: [embed] });
  }
};