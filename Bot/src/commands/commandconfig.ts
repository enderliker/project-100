import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres,
  trimEmbedDescription
} from "./command-utils";
import {
  COMMAND_NAMES,
  isCommandName,
  type CommandName
} from "./command-names";
import { getGuildConfig } from "./storage";
import {
  clearGuildSettingsCache,
  getGuildSettings,
  updateGuildSettings
} from "./guild-settings-store";
import type { CommandOverride } from "./guild-settings";
import { safeDefer, safeRespond } from "../command-handler/interaction-response";
import { commandConfigStore } from "../command-handler/command-config-store";

const MAX_COOLDOWN_SECONDS = 3600;

function normalizeCommandName(raw: string): string {
  return raw.trim().toLowerCase();
}

function summarizeOverride(commandName: string, override: CommandOverride): string {
  const lines: string[] = [`**Command:** ${commandName}`];
  const enabled = override.enabled;
  if (typeof enabled === "boolean") {
    lines.push(`**Enabled:** ${enabled ? "Yes" : "No"}`);
  }
  const cooldown = override.cooldownSeconds;
  if (typeof cooldown === "number") {
    lines.push(`**Cooldown:** ${cooldown}s`);
  }
  const allowRoles = override.allowRoles as string[] | undefined;
  if (allowRoles && allowRoles.length > 0) {
    lines.push(`**Allow Roles:** ${allowRoles.map((id) => `<@&${id}>`).join(", ")}`);
  }
  const denyRoles = override.denyRoles as string[] | undefined;
  if (denyRoles && denyRoles.length > 0) {
    lines.push(`**Deny Roles:** ${denyRoles.map((id) => `<@&${id}>`).join(", ")}`);
  }
  const allowUsers = override.allowUsers as string[] | undefined;
  if (allowUsers && allowUsers.length > 0) {
    lines.push(`**Allow Users:** ${allowUsers.map((id) => `<@${id}>`).join(", ")}`);
  }
  const denyUsers = override.denyUsers as string[] | undefined;
  if (denyUsers && denyUsers.length > 0) {
    lines.push(`**Deny Users:** ${denyUsers.map((id) => `<@${id}>`).join(", ")}`);
  }
  return lines.join("\n");
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("commandconfig")
    .setDescription("Configure command permissions and cooldowns.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View command overrides.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable a command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable a command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cooldown")
        .setDescription("Set a command cooldown.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("seconds")
            .setDescription("Cooldown in seconds (0 to clear)")
            .setMinValue(0)
            .setMaxValue(MAX_COOLDOWN_SECONDS)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("allow-role")
        .setDescription("Allow a role to use a command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to allow").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("deny-role")
        .setDescription("Deny a role from using a command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to deny").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("allow-user")
        .setDescription("Allow a user to use a command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addUserOption((option) =>
          option.setName("user").setDescription("User to allow").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("deny-user")
        .setDescription("Deny a user from using a command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addUserOption((option) =>
          option.setName("user").setDescription("User to deny").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear")
        .setDescription("Clear command overrides.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Which override to clear")
            .addChoices(
              { name: "all", value: "all" },
              { name: "cooldown", value: "cooldown" },
              { name: "allow-roles", value: "allow-roles" },
              { name: "deny-roles", value: "deny-roles" },
              { name: "allow-users", value: "allow-users" },
              { name: "deny-users", value: "deny-users" }
            )
            .setRequired(true)
        )
    ),
  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "command") {
      return [];
    }
    const query = focused.value.trim().toLowerCase();
    return COMMAND_NAMES.filter((name) => name.includes(query))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));
  },
  execute: async (interaction, context) => {
    const guildContext = await requireGuildContext(interaction, context);
    if (!guildContext) {
      return;
    }
    const pool = requirePostgres(context, (options) => safeRespond(interaction, options));
    if (!pool) {
      return;
    }
    const config = await getGuildConfig(pool, guildContext.guild.id);
    if (!hasAdminAccess(guildContext.member, config)) {
      const embed = buildEmbed(context, {
        title: "Permission Denied",
        description: "You do not have permission to update command settings.",
        variant: "error"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    const commandNameInput = interaction.options.getString("command", true);
    const normalizedCommand = normalizeCommandName(commandNameInput);
    if (!isCommandName(normalizedCommand)) {
      const embed = buildEmbed(context, {
        title: "Unknown Command",
        description: `No command named \`${normalizedCommand}\` was found.`,
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const commandName: CommandName = normalizedCommand;

    await safeDefer(interaction, { ephemeral: true });

    const settings = await getGuildSettings(pool, guildContext.guild.id);
    const currentOverride: CommandOverride = settings.commands[commandName] ?? {};
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "view") {
      const embed = buildEmbed(context, {
        title: "Command Overrides",
        description: trimEmbedDescription(summarizeOverride(commandName, currentOverride))
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "enable" || subcommand === "disable") {
      const enabled = subcommand === "enable";
      const nextOverride = { ...currentOverride, enabled };
      await updateGuildSettings(pool, guildContext.guild.id, {
        commands: {
          [commandName]: nextOverride
        }
      });
      clearGuildSettingsCache(guildContext.guild.id);
      commandConfigStore.invalidate(guildContext.guild.id);
      const embed = buildEmbed(context, {
        title: "Command Updated",
        description: `Command \`${commandName}\` is now ${enabled ? "enabled" : "disabled"}.`
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "cooldown") {
      const seconds = interaction.options.getInteger("seconds", true);
      const nextOverride = {
        ...currentOverride,
        cooldownSeconds: seconds === 0 ? undefined : seconds
      };
      await updateGuildSettings(pool, guildContext.guild.id, {
        commands: {
          [commandName]: nextOverride
        }
      });
      clearGuildSettingsCache(guildContext.guild.id);
      commandConfigStore.invalidate(guildContext.guild.id);
      const embed = buildEmbed(context, {
        title: "Command Cooldown Updated",
        description:
          seconds === 0
            ? `Cooldown cleared for \`${commandName}\`.`
            : `Cooldown set to ${seconds}s for \`${commandName}\`.`
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "allow-role" || subcommand === "deny-role") {
      const role = interaction.options.getRole("role", true);
      const listKey = subcommand === "allow-role" ? "allowRoles" : "denyRoles";
      const currentList = new Set(currentOverride[listKey] ?? []);
      currentList.add(role.id);
      const nextOverride = { ...currentOverride, [listKey]: Array.from(currentList) };
      await updateGuildSettings(pool, guildContext.guild.id, {
        commands: {
          [commandName]: nextOverride
        }
      });
      clearGuildSettingsCache(guildContext.guild.id);
      commandConfigStore.invalidate(guildContext.guild.id);
      const embed = buildEmbed(context, {
        title: "Command Role Updated",
        description: `${role} ${subcommand === "allow-role" ? "allowed" : "denied"} for \`${commandName}\`.`
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "allow-user" || subcommand === "deny-user") {
      const user = interaction.options.getUser("user", true);
      const listKey = subcommand === "allow-user" ? "allowUsers" : "denyUsers";
      const currentList = new Set(currentOverride[listKey] ?? []);
      currentList.add(user.id);
      const nextOverride = { ...currentOverride, [listKey]: Array.from(currentList) };
      await updateGuildSettings(pool, guildContext.guild.id, {
        commands: {
          [commandName]: nextOverride
        }
      });
      clearGuildSettingsCache(guildContext.guild.id);
      commandConfigStore.invalidate(guildContext.guild.id);
      const embed = buildEmbed(context, {
        title: "Command User Updated",
        description: `${user} ${subcommand === "allow-user" ? "allowed" : "denied"} for \`${commandName}\`.`
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "clear") {
      const scope = interaction.options.getString("scope", true);
      const nextOverride: CommandOverride = { ...currentOverride };
      if (scope === "all") {
        await updateGuildSettings(pool, guildContext.guild.id, {
          commands: {
            [commandName]: {}
          }
        });
        clearGuildSettingsCache(guildContext.guild.id);
        commandConfigStore.invalidate(guildContext.guild.id);
        const embed = buildEmbed(context, {
          title: "Command Overrides Cleared",
          description: `All overrides removed for \`${commandName}\`.`
        });
        await safeRespond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      if (scope === "cooldown") {
        delete nextOverride.cooldownSeconds;
      }
      if (scope === "allow-roles") {
        delete nextOverride.allowRoles;
      }
      if (scope === "deny-roles") {
        delete nextOverride.denyRoles;
      }
      if (scope === "allow-users") {
        delete nextOverride.allowUsers;
      }
      if (scope === "deny-users") {
        delete nextOverride.denyUsers;
      }
      await updateGuildSettings(pool, guildContext.guild.id, {
        commands: {
          [commandName]: nextOverride
        }
      });
      clearGuildSettingsCache(guildContext.guild.id);
      commandConfigStore.invalidate(guildContext.guild.id);
      const embed = buildEmbed(context, {
        title: "Command Overrides Updated",
        description: `Overrides updated for \`${commandName}\`.`
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
    }
  }
};
