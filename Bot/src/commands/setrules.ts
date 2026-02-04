import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireBotPermissions,
  requireGuildContext,
  requirePostgres,
  trimEmbedDescription
} from "./command-utils";
import type { CommandExecutionContext } from "./types";
import { getGuildConfig } from "./storage";
import {
  clearGuildSettingsCache,
  getGuildSettings,
  updateGuildSettings
} from "./guild-settings-store";

const MAX_RULES = 25;
const MAX_RULE_LENGTH = 500;

function formatRules(entries: string[]): string {
  if (entries.length === 0) {
    return "No rules configured.";
  }
  return entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
}

async function requireAdmin(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<boolean> {
  const guildContext = await requireGuildContext(interaction, context);
  if (!guildContext) {
    return false;
  }
  const pool = requirePostgres(context, (options) => interaction.reply(options));
  if (!pool) {
    return false;
  }
  const config = await getGuildConfig(pool, guildContext.guild.id);
  if (!hasAdminAccess(guildContext.member, config)) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: "You do not have permission to update server rules.",
      variant: "error"
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return false;
  }
  return true;
}

async function getSettingsForInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
) {
  const guildContext = await requireGuildContext(interaction, context);
  if (!guildContext) {
    return null;
  }
  const pool = requirePostgres(context, (options) => interaction.reply(options));
  if (!pool) {
    return null;
  }
  const settings = await getGuildSettings(pool, guildContext.guild.id);
  return { pool, guildId: guildContext.guild.id, settings, guild: guildContext.guild };
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("setrules")
    .setDescription("Manage the server rules.")
    .addSubcommand((subcommand) =>
      subcommand.setName("view").setDescription("View current server rules.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a new rule.")
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("Rule text")
            .setMaxLength(MAX_RULE_LENGTH)
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("position")
            .setDescription("Optional position (1-based)")
            .setMinValue(1)
            .setMaxValue(MAX_RULES)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Update an existing rule.")
        .addIntegerOption((option) =>
          option
            .setName("index")
            .setDescription("Rule number to update")
            .setMinValue(1)
            .setMaxValue(MAX_RULES)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("New rule text")
            .setMaxLength(MAX_RULE_LENGTH)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove an existing rule.")
        .addIntegerOption((option) =>
          option
            .setName("index")
            .setDescription("Rule number to remove")
            .setMinValue(1)
            .setMaxValue(MAX_RULES)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear")
        .setDescription("Clear all rules.")
        .addBooleanOption((option) =>
          option
            .setName("confirm")
            .setDescription("Confirm clearing all rules")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("publish")
        .setDescription("Post the rules to a channel.")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post the rules in")
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option.setName("pin").setDescription("Pin the rules message")
        )
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Title for the rules embed")
            .setMaxLength(100)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("settitle")
        .setDescription("Set the rules embed title.")
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Title for the rules embed")
            .setMaxLength(100)
            .setRequired(true)
        )
    ),
  execute: async (interaction, context) => {
    const allowed = await requireAdmin(interaction, context);
    if (!allowed) {
      return;
    }

    const settingsData = await getSettingsForInteraction(interaction, context);
    if (!settingsData) {
      return;
    }

    const { pool, guildId, settings, guild } = settingsData;
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "view") {
      const embed = buildEmbed(context, {
        title: settings.rules.title,
        description: trimEmbedDescription(formatRules(settings.rules.entries))
      });
      const channelLabel = settings.rules.channelId
        ? `<#${settings.rules.channelId}>`
        : "Not set";
      embed.addFields(
        {
          name: "Published Channel",
          value: channelLabel,
          inline: true
        },
        {
          name: "Pinned",
          value: settings.rules.pin ? "Yes" : "No",
          inline: true
        }
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "add") {
      const text = interaction.options.getString("text", true).trim();
      const position = interaction.options.getInteger("position");
      const nextEntries = [...settings.rules.entries];
      if (nextEntries.length >= MAX_RULES) {
        const embed = buildEmbed(context, {
          title: "Rule Limit Reached",
          description: `You can only store up to ${MAX_RULES} rules.`,
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      if (position && position >= 1 && position <= nextEntries.length + 1) {
        nextEntries.splice(position - 1, 0, text);
      } else {
        nextEntries.push(text);
      }
      await updateGuildSettings(pool, guildId, {
        rules: {
          entries: nextEntries
        },
        features: {
          rules: true
        }
      });
      clearGuildSettingsCache(guildId);
      const embed = buildEmbed(context, {
        title: "Rule Added",
        description: trimEmbedDescription(formatRules(nextEntries))
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "set") {
      const index = interaction.options.getInteger("index", true);
      const text = interaction.options.getString("text", true).trim();
      const nextEntries = [...settings.rules.entries];
      if (index < 1 || index > nextEntries.length) {
        const embed = buildEmbed(context, {
          title: "Invalid Rule Number",
          description: "Choose a valid rule number to update.",
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      nextEntries[index - 1] = text;
      await updateGuildSettings(pool, guildId, {
        rules: {
          entries: nextEntries
        }
      });
      clearGuildSettingsCache(guildId);
      const embed = buildEmbed(context, {
        title: "Rule Updated",
        description: trimEmbedDescription(formatRules(nextEntries))
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "remove") {
      const index = interaction.options.getInteger("index", true);
      const nextEntries = [...settings.rules.entries];
      if (index < 1 || index > nextEntries.length) {
        const embed = buildEmbed(context, {
          title: "Invalid Rule Number",
          description: "Choose a valid rule number to remove.",
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      nextEntries.splice(index - 1, 1);
      await updateGuildSettings(pool, guildId, {
        rules: {
          entries: nextEntries
        }
      });
      clearGuildSettingsCache(guildId);
      const embed = buildEmbed(context, {
        title: "Rule Removed",
        description: trimEmbedDescription(formatRules(nextEntries))
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "clear") {
      const confirm = interaction.options.getBoolean("confirm", true);
      if (!confirm) {
        const embed = buildEmbed(context, {
          title: "Confirmation Required",
          description: "Please confirm to clear all rules.",
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      await updateGuildSettings(pool, guildId, {
        rules: {
          entries: []
        }
      });
      clearGuildSettingsCache(guildId);
      const embed = buildEmbed(context, {
        title: "Rules Cleared",
        description: "All rules have been removed."
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "settitle") {
      const title = interaction.options.getString("title", true).trim();
      await updateGuildSettings(pool, guildId, {
        rules: {
          title
        }
      });
      clearGuildSettingsCache(guildId);
      const embed = buildEmbed(context, {
        title: "Rules Title Updated",
        description: `Rules title set to **${title}**.`
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "publish") {
      const channelOption = interaction.options.getChannel("channel");
      const channel =
        channelOption ??
        (settings.rules.channelId
          ? await context.client.channels.fetch(settings.rules.channelId)
          : null);
      if (!channel || !channel.isTextBased() || !channel.guild) {
        const embed = buildEmbed(context, {
          title: "Channel Not Found",
          description: "Please provide a valid text channel to publish the rules.",
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      const pin = interaction.options.getBoolean("pin") ?? settings.rules.pin;
      const title = interaction.options.getString("title") ?? settings.rules.title;

      const botMember = await requireBotPermissions(
        interaction,
        context,
        guild,
        ["SendMessages", "EmbedLinks"],
        "publish rules"
      );
      if (!botMember) {
        return;
      }
      if (pin) {
        const pinPermissions = await requireBotPermissions(
          interaction,
          context,
          guild,
          ["ManageMessages"],
          "pin the rules"
        );
        if (!pinPermissions) {
          return;
        }
      }

      if (settings.rules.entries.length === 0) {
        const embed = buildEmbed(context, {
          title: "No Rules",
          description: "Add at least one rule before publishing.",
          variant: "warning"
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      const rulesEmbed = buildEmbed(context, {
        title: title || settings.rules.title,
        description: trimEmbedDescription(formatRules(settings.rules.entries))
      });
      const message = await channel.send({ embeds: [rulesEmbed] });
      if (pin && channel.isTextBased()) {
        await message.pin().catch(() => undefined);
      }

      await updateGuildSettings(pool, guildId, {
        rules: {
          channelId: channel.id,
          messageId: message.id,
          pin,
          title: title || settings.rules.title
        }
      });
      clearGuildSettingsCache(guildId);
      const embed = buildEmbed(context, {
        title: "Rules Published",
        description: `Rules published in <#${channel.id}>.`
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
