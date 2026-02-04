import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed, requireGuildContext } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("boosters")
    .setDescription("Shows the current server boost count."),
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const boosts = guildContext.guild.premiumSubscriptionCount ?? 0;
    const embed = buildEmbed(context, {
      title: "Boosters",
      description: `Current boosts: ${boosts}`
    });
    await safeRespond(interaction, { embeds: [embed] });
  }
};