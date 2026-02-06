import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandStringOption,
  SlashCommandIntegerOption,
  SlashCommandBooleanOption,
  SlashCommandChannelOption,
  SlashCommandRoleOption
} from "discord.js";
import type { CommandDefinition } from "./types";
import {
  handleRulesConfig,
  handleSetAdminRole,
  handleSetAutorole,
  handleSetGoodbye,
  handleSetLanguage,
  handleSetLogs,
  handleSetModRole,
  handleSetPrefix,
  handleSetWelcome
} from "./config-settings";

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure server settings.")
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("adminrole")
        .setDescription("Set the admin role.")
        .addRoleOption((option: SlashCommandRoleOption) =>
          option
            .setName("role")
            .setDescription("Role to grant admin access")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("autorole")
        .setDescription("Set the autorole for new members.")
        .addRoleOption((option: SlashCommandRoleOption) =>
          option
            .setName("role")
            .setDescription("Role to assign")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("goodbye")
        .setDescription("Set the goodbye message template.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("template")
            .setDescription("Goodbye message template")
            .setMinLength(1)
            .setMaxLength(1900)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("language")
        .setDescription("Set the default language.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("language")
            .setDescription("Language code (e.g. en, es, fr)")
            .setMinLength(2)
            .setMaxLength(10)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("logs")
        .setDescription("Set the logs channel.")
        .addChannelOption((option: SlashCommandChannelOption) =>
          option
            .setName("channel")
            .setDescription("Channel to receive moderation logs")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("modrole")
        .setDescription("Set the moderation role.")
        .addRoleOption((option: SlashCommandRoleOption) =>
          option
            .setName("role")
            .setDescription("Role to grant moderation access")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("prefix")
        .setDescription("Set the command prefix.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("prefix")
            .setDescription("Prefix to use")
            .setMinLength(1)
            .setMaxLength(5)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("welcome")
        .setDescription("Set the welcome message template.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("template")
            .setDescription("Welcome message template")
            .setMinLength(1)
            .setMaxLength(1900)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand.setName("rules-view").setDescription("View current server rules.")
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("rules-add")
        .setDescription("Add a new rule.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("text")
            .setDescription("Rule text")
            .setMaxLength(500)
            .setRequired(true)
        )
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("position")
            .setDescription("Optional position (1-based)")
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("rules-set")
        .setDescription("Update an existing rule.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("index")
            .setDescription("Rule number to update")
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(true)
        )
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("text")
            .setDescription("New rule text")
            .setMaxLength(500)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("rules-remove")
        .setDescription("Remove an existing rule.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("index")
            .setDescription("Rule number to remove")
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("rules-clear")
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
        .setName("rules-publish")
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
        .setName("rules-settitle")
        .setDescription("Set the rules embed title.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("title")
            .setDescription("Title for the rules embed")
            .setMaxLength(100)
            .setRequired(true)
        )
    ),
  execute: async (interaction, context) => {
    const subcommand = interaction.options.getSubcommand(true);
    switch (subcommand) {
      case "adminrole":
        await handleSetAdminRole(interaction, context);
        return;
      case "autorole":
        await handleSetAutorole(interaction, context);
        return;
      case "goodbye":
        await handleSetGoodbye(interaction, context);
        return;
      case "language":
        await handleSetLanguage(interaction, context);
        return;
      case "logs":
        await handleSetLogs(interaction, context);
        return;
      case "modrole":
        await handleSetModRole(interaction, context);
        return;
      case "prefix":
        await handleSetPrefix(interaction, context);
        return;
      case "welcome":
        await handleSetWelcome(interaction, context);
        return;
      case "rules-view":
        await handleRulesConfig(interaction, context, { subcommandOverride: "view" });
        return;
      case "rules-add":
        await handleRulesConfig(interaction, context, { subcommandOverride: "add" });
        return;
      case "rules-set":
        await handleRulesConfig(interaction, context, { subcommandOverride: "set" });
        return;
      case "rules-remove":
        await handleRulesConfig(interaction, context, { subcommandOverride: "remove" });
        return;
      case "rules-clear":
        await handleRulesConfig(interaction, context, { subcommandOverride: "clear" });
        return;
      case "rules-publish":
        await handleRulesConfig(interaction, context, { subcommandOverride: "publish" });
        return;
      case "rules-settitle":
        await handleRulesConfig(interaction, context, { subcommandOverride: "settitle" });
        return;
      default:
        return;
    }
  }
};
