import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

const HELP_TEXT = [
  "**Moderation / Administration**",
  "/ban, /unban, /kick, /timeout, /untimeout, /warn, /warnings, /clear, /purge, /slowmode, /lock, /unlock, /nick, /report, /logs",
  "",
  "**Server Configuration**",
  "/setprefix, /setlogs, /setwelcome, /setgoodbye, /setautorole, /setmodrole, /setadminrole, /setrules, /setlanguage, /commandconfig, /toggle",
  "",
  "**Community / Info**",
  "/rules, /serverinfo, /userinfo, /avatar, /banner, /roles, /members, /boosters",
  "",
  "**Fun**",
  "/8ball, /coinflip, /dice, /rps, /meme, /ship, /say, /poll",
  "",
  "**Utility**",
  "/help, /botinfo, /invite, /support, /stats, /calc, /translate"
].join("\n");

export const command: CommandDefinition = {
  data: new SlashCommandBuilder().setName("help").setDescription("Shows the help menu."),
  execute: async (interaction, context) => {
    const embed = buildEmbed(context, {
      title: "Help",
      description: HELP_TEXT
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
  }
};