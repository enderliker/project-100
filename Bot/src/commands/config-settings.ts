import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandStringOption,
  SlashCommandIntegerOption,
  SlashCommandBooleanOption,
  SlashCommandChannelOption,
  type ChatInputCommandInteraction
} from "discord.js";
import type { CommandExecutionContext } from "./types";
import {
  buildEmbed,
  formatChannelLabel,
  hasAdminAccess,
  handleCommandError,
  requireBotPermissions,
  requireChannelPermissions,
  requireGuildContext,
  requirePostgres,
  trimEmbedDescription
} from "./command-utils";
import {
  getGuildConfig,
  setGuildAdminrole,
  setGuildAutorole,
  setGuildGoodbyeTemplate,
  setGuildLogsChannel,
  setGuildModrole,
  setGuildPrefix,
  setGuildWelcomeTemplate
} from "./storage";
import {
  clearGuildSettingsCache,
  getGuildSettings,
  updateGuildSettings
} from "./guild-settings-store";
import { safeDefer, safeEditOrFollowUp, safeRespond } from "../command-handler/interaction-response";

const MAX_RULES = 25;
const MAX_RULE_LENGTH = 500;

type RulesSubcommandParent =
  | SlashCommandBuilder;

type AdminContext = {
  pool: NonNullable<CommandExecutionContext["postgresPool"]>;
  guildId: string;
};

async function requireAdminContext(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext,
  errorMessage: string
): Promise<AdminContext | null> {
  const guildContext = await requireGuildContext(interaction, context);
  if (!guildContext) {
    return null;
  }
  const pool = requirePostgres(context, (options) => safeRespond(interaction, options));
  if (!pool) {
    return null;
  }
  const config = await getGuildConfig(pool, guildContext.guild.id);
  if (!hasAdminAccess(guildContext.member, config)) {
    const embed = buildEmbed(context, {
      title: "Permission Denied",
      description: errorMessage,
      variant: "error"
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    return null;
  }
  return {
    pool,
    guildId: guildContext.guild.id
  };
}

export async function handleSetAdminRole(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const role = interaction.options.getRole("role", true);
  if (!role) {
    const embed = buildEmbed(context, {
      title: "Role Not Found",
      description: "Please specify a valid role to set as the admin role.",
      variant: "warning"
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    return;
  }
  await safeDefer(interaction, { ephemeral: true });
  await setGuildAdminrole(adminContext.pool, adminContext.guildId, role.id);
  const embed = buildEmbed(context, {
    title: "Admin Role Updated",
    description: `Admin role set to <@&${role.id}>.`
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetAutorole(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const role = interaction.options.getRole("role", true);
  if (!role) {
    const embed = buildEmbed(context, {
      title: "Role Not Found",
      description: "Please specify a valid role to set as the autorole.",
      variant: "warning"
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    return;
  }
  await safeDefer(interaction, { ephemeral: true });
  await setGuildAutorole(adminContext.pool, adminContext.guildId, role.id);
  const embed = buildEmbed(context, {
    title: "Autorole Updated",
    description: `Autorole set to <@&${role.id}>.`
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetGoodbye(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const template = interaction.options.getString("template", true);
  await safeDefer(interaction, { ephemeral: true });
  await setGuildGoodbyeTemplate(adminContext.pool, adminContext.guildId, template);
  const embed = buildEmbed(context, {
    title: "Goodbye Template Updated",
    description: "Goodbye template saved."
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetLanguage(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const language = interaction.options.getString("language", true).trim().toLowerCase();
  await safeDefer(interaction, { ephemeral: true });
  await updateGuildSettings(adminContext.pool, adminContext.guildId, {
    language,
    translation: {
      defaultTarget: language
    }
  });
  clearGuildSettingsCache(adminContext.guildId);
  const embed = buildEmbed(context, {
    title: "Language Updated",
    description: `Default language set to **${language}**.`
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetLogs(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const channel = interaction.options.getChannel("channel", true);
  if (!channel) {
    const embed = buildEmbed(context, {
      title: "Channel Not Found",
      description: "Please specify a valid channel for moderation logs.",
      variant: "warning"
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    return;
  }
  await safeDefer(interaction, { ephemeral: true });
  await setGuildLogsChannel(adminContext.pool, adminContext.guildId, channel.id);
  await updateGuildSettings(adminContext.pool, adminContext.guildId, {
    loggingChannelId: channel.id
  });
  clearGuildSettingsCache(adminContext.guildId);
  const embed = buildEmbed(context, {
    title: "Logs Channel Updated",
    description: `Logs channel set to ${formatChannelLabel(channel)}.`
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetModRole(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const role = interaction.options.getRole("role", true);
  if (!role) {
    const embed = buildEmbed(context, {
      title: "Role Not Found",
      description: "Please specify a valid role to set as the moderator role.",
      variant: "warning"
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    return;
  }
  await safeDefer(interaction, { ephemeral: true });
  await setGuildModrole(adminContext.pool, adminContext.guildId, role.id);
  const embed = buildEmbed(context, {
    title: "Moderator Role Updated",
    description: `Moderator role set to <@&${role.id}>.`
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetPrefix(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const prefixValue = interaction.options.getString("prefix", true);
  if (!prefixValue) {
    const embed = buildEmbed(context, {
      title: "Invalid Prefix",
      description: "Please specify a valid prefix.",
      variant: "warning"
    });
    await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    return;
  }
  const prefix = prefixValue.trim();
  await safeDefer(interaction, { ephemeral: true });
  await setGuildPrefix(adminContext.pool, adminContext.guildId, prefix);
  const embed = buildEmbed(context, {
    title: "Prefix Updated",
    description: `Prefix set to \`${prefix}\`.`
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

export async function handleSetWelcome(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<void> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server configuration."
  );
  if (!adminContext) {
    return;
  }
  const template = interaction.options.getString("template", true);
  await safeDefer(interaction, { ephemeral: true });
  await setGuildWelcomeTemplate(adminContext.pool, adminContext.guildId, template);
  const embed = buildEmbed(context, {
    title: "Welcome Template Updated",
    description: "Welcome template saved."
  });
  await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
}

function formatRules(entries: string[]): string {
  if (entries.length === 0) {
    return "No rules configured.";
  }
  return entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
}

async function getRulesSettings(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
) {
  const guildContext = await requireGuildContext(interaction, context);
  if (!guildContext) {
    return null;
  }
  const pool = requirePostgres(context, (options) => safeRespond(interaction, options));
  if (!pool) {
    return null;
  }
  const settings = await getGuildSettings(pool, guildContext.guild.id);
  return { pool, guildId: guildContext.guild.id, settings, guild: guildContext.guild };
}

async function requireRulesAdmin(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext
): Promise<boolean> {
  const adminContext = await requireAdminContext(
    interaction,
    context,
    "You do not have permission to update server rules."
  );
  return Boolean(adminContext);
}

export function addRulesSubcommands<T extends RulesSubcommandParent>(builder: T): T {
  builder
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand.setName("view").setDescription("View current server rules.")
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("add")
        .setDescription("Add a new rule.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("text")
            .setDescription("Rule text")
            .setMaxLength(MAX_RULE_LENGTH)
            .setRequired(true)
        )
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("position")
            .setDescription("Optional position (1-based)")
            .setMinValue(1)
            .setMaxValue(MAX_RULES)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("set")
        .setDescription("Update an existing rule.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("index")
            .setDescription("Rule number to update")
            .setMinValue(1)
            .setMaxValue(MAX_RULES)
            .setRequired(true)
        )
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("text")
            .setDescription("New rule text")
            .setMaxLength(MAX_RULE_LENGTH)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("remove")
        .setDescription("Remove an existing rule.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("index")
            .setDescription("Rule number to remove")
            .setMinValue(1)
            .setMaxValue(MAX_RULES)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("clear")
        .setDescription("Clear all rules.")
        .addBooleanOption((option: SlashCommandBooleanOption) =>
          option
            .setName("confirm")
            .setDescription("Confirm clearing all rules")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("publish")
        .setDescription("Post the rules to a channel.")
        .addChannelOption((option: SlashCommandChannelOption) =>
          option
            .setName("channel")
            .setDescription("Channel to post the rules in")
            .setRequired(false)
        )
        .addBooleanOption((option: SlashCommandBooleanOption) =>
          option.setName("pin").setDescription("Pin the rules message")
        )
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("title")
            .setDescription("Title for the rules embed")
            .setMaxLength(100)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("settitle")
        .setDescription("Set the rules embed title.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("title")
            .setDescription("Title for the rules embed")
            .setMaxLength(100)
            .setRequired(true)
        )
    );
  return builder;
}

export async function handleRulesConfig(
  interaction: ChatInputCommandInteraction,
  context: CommandExecutionContext,
  options?: { subcommandOverride?: string }
): Promise<void> {
  const allowed = await requireRulesAdmin(interaction, context);
  if (!allowed) {
    return;
  }

  const settingsData = await getRulesSettings(interaction, context);
  if (!settingsData) {
    return;
  }

  await safeDefer(interaction, { ephemeral: true });

  const { pool, guildId, settings, guild } = settingsData;
  const subcommand = options?.subcommandOverride ?? interaction.options.getSubcommand(true);

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
        name: "Rules Count",
        value: String(settings.rules.entries.length),
        inline: true
      }
    );
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === "add") {
    const text = interaction.options.getString("text", true);
    const position = interaction.options.getInteger("position");
    if (settings.rules.entries.length >= MAX_RULES) {
      const embed = buildEmbed(context, {
        title: "Rules Limit Reached",
        description: `You can only set up to ${MAX_RULES} rules.`,
        variant: "warning"
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const entries = [...settings.rules.entries];
    if (position !== null && position >= 1 && position <= entries.length + 1) {
      entries.splice(position - 1, 0, text);
    } else {
      entries.push(text);
    }
    await updateGuildSettings(pool, guildId, {
      rules: {
        ...settings.rules,
        entries
      }
    });
    clearGuildSettingsCache(guildId);
    const embed = buildEmbed(context, {
      title: "Rule Added",
      description: "Rule added successfully."
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === "set") {
    const index = interaction.options.getInteger("index", true);
    const text = interaction.options.getString("text", true);
    if (index < 1 || index > settings.rules.entries.length) {
      const embed = buildEmbed(context, {
        title: "Invalid Rule",
        description: "That rule index does not exist.",
        variant: "warning"
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const entries = [...settings.rules.entries];
    entries[index - 1] = text;
    await updateGuildSettings(pool, guildId, {
      rules: {
        ...settings.rules,
        entries
      }
    });
    clearGuildSettingsCache(guildId);
    const embed = buildEmbed(context, {
      title: "Rule Updated",
      description: "Rule updated successfully."
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === "remove") {
    const index = interaction.options.getInteger("index", true);
    if (index < 1 || index > settings.rules.entries.length) {
      const embed = buildEmbed(context, {
        title: "Invalid Rule",
        description: "That rule index does not exist.",
        variant: "warning"
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const entries = [...settings.rules.entries];
    entries.splice(index - 1, 1);
    await updateGuildSettings(pool, guildId, {
      rules: {
        ...settings.rules,
        entries
      }
    });
    clearGuildSettingsCache(guildId);
    const embed = buildEmbed(context, {
      title: "Rule Removed",
      description: "Rule removed successfully."
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === "clear") {
    const confirm = interaction.options.getBoolean("confirm", true);
    if (!confirm) {
      const embed = buildEmbed(context, {
        title: "Confirmation Required",
        description: "Please confirm clearing all rules.",
        variant: "warning"
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    await updateGuildSettings(pool, guildId, {
      rules: {
        ...settings.rules,
        entries: []
      }
    });
    clearGuildSettingsCache(guildId);
    const embed = buildEmbed(context, {
      title: "Rules Cleared",
      description: "All rules have been cleared."
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === "publish") {
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!channel || !channel.isTextBased()) {
      const embed = buildEmbed(context, {
        title: "Unsupported Channel",
        description: "This command can only be used in text channels.",
        variant: "warning"
      });
      await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const botMember = await requireBotPermissions(
      interaction,
      context,
      guild,
      ["SendMessages"],
      "send messages"
    );
    if (!botMember) {
      return;
    }
    const hasChannelPermissions = await requireChannelPermissions(
      interaction,
      context,
      channel,
      botMember,
      ["SendMessages"],
      "send messages"
    );
    if (!hasChannelPermissions) {
      return;
    }
    const title = interaction.options.getString("title") ?? settings.rules.title;
    const pin = interaction.options.getBoolean("pin") ?? false;
    const description = trimEmbedDescription(formatRules(settings.rules.entries));
    const embed = buildEmbed(context, {
      title,
      description
    });
    try {
      const message = await channel.send({ embeds: [embed] });
      if (pin) {
        await message.pin();
      }
    } catch (error) {
      await handleCommandError(interaction, context, error, {
        title: "Publish Failed",
        description: "Unable to publish rules to that channel."
      });
      return;
    }
    await updateGuildSettings(pool, guildId, {
      rules: {
        ...settings.rules,
        channelId: channel.id,
        title
      }
    });
    clearGuildSettingsCache(guildId);
    const success = buildEmbed(context, {
      title: "Rules Published",
      description: `Rules published to <#${channel.id}>.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [success], ephemeral: true });
    return;
  }

  if (subcommand === "settitle") {
    const title = interaction.options.getString("title", true);
    await updateGuildSettings(pool, guildId, {
      rules: {
        ...settings.rules,
        title
      }
    });
    clearGuildSettingsCache(guildId);
    const embed = buildEmbed(context, {
      title: "Rules Title Updated",
      description: `Rules title set to **${title}**.`
    });
    await safeEditOrFollowUp(interaction, { embeds: [embed], ephemeral: true });
  }
}
