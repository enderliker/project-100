import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import {
  buildEmbed,
  hasAdminAccess,
  requireGuildContext,
  requirePostgres,
  trimEmbedDescription
} from "./command-utils";
import { isCommandName, type CommandName } from "./command-names";
import { getGuildConfig } from "./storage";
import {
  clearGuildSettingsCache,
  getGuildSettings,
  updateGuildSettings
} from "./guild-settings-store";
import type { CommandOverride } from "./guild-settings";
import { safeDefer, safeRespond } from "../command-handler/interaction-response";
import { commandConfigStore } from "../command-handler/command-config-store";
import { isModerationCommand } from "../command-handler/command-permissions";
import { getCommands } from "../command-handler/registry";

const MAX_AUTOCOMPLETE = 25;

function normalizeCommandName(raw: string): string {
  return raw.trim().toLowerCase();
}

function getRegistryCommandNames(): string[] {
  return getCommands()
    .map((command) => command.name)
    .sort();
}

function resolveCommandName(value: string): CommandName | null {
  const normalized = normalizeCommandName(value);
  const registryNames = new Set(getRegistryCommandNames());
  if (!registryNames.has(normalized)) {
    return null;
  }
  if (!isCommandName(normalized)) {
    return null;
  }
  return normalized;
}

function summarizeOverride(
  commandName: CommandName,
  override: CommandOverride,
  options: { isModeration: boolean }
): string {
  const lines: string[] = [`**Command:** ${commandName}`];
  lines.push(
    `**Access:** ${
      options.isModeration
        ? "Moderation (permissions or explicit allow list)"
        : "Public (default allow)"
    }`
  );
  const enabled = override.enabled;
  if (typeof enabled === "boolean") {
    lines.push(`**Enabled:** ${enabled ? "Yes" : "No"}`);
  }
  const cooldown = override.cooldownSeconds;
  if (typeof cooldown === "number") {
    lines.push(`**Cooldown:** ${cooldown}s`);
  }
  const allowRoles = override.allowRoles as string[] | undefined;
  const denyRoles = override.denyRoles as string[] | undefined;
  if (denyRoles && denyRoles.length > 0) {
    lines.push(`**Deny Roles:** ${denyRoles.map((id) => `<@&${id}>`).join(", ")}`);
  }
  const allowUsers = override.allowUsers as string[] | undefined;
  const denyUsers = override.denyUsers as string[] | undefined;
  if (denyUsers && denyUsers.length > 0) {
    lines.push(`**Deny Users:** ${denyUsers.map((id) => `<@${id}>`).join(", ")}`);
  }
  if (options.isModeration) {
    if (allowRoles && allowRoles.length > 0) {
      lines.push(`**Allow Roles:** ${allowRoles.map((id) => `<@&${id}>`).join(", ")}`);
    }
    if (allowUsers && allowUsers.length > 0) {
      lines.push(`**Allow Users:** ${allowUsers.map((id) => `<@${id}>`).join(", ")}`);
    }
  } else if ((allowRoles && allowRoles.length > 0) || (allowUsers && allowUsers.length > 0)) {
    lines.push("**Allow Lists:** Ignored for public commands.");
  }
  return lines.join("\n");
}

function hasPermissionOverrides(override: CommandOverride): boolean {
  return Boolean(
    (override.allowRoles && override.allowRoles.length > 0) ||
      (override.allowUsers && override.allowUsers.length > 0) ||
      (override.denyRoles && override.denyRoles.length > 0) ||
      (override.denyUsers && override.denyUsers.length > 0)
  );
}

function summarizeOverrides(settings: Record<string, CommandOverride>): string {
  const entries = Object.entries(settings)
    .filter(([, override]) => hasPermissionOverrides(override))
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return "No command overrides configured.";
  }
  return entries
    .map(([name, override]) => {
      const allowRoles = override.allowRoles?.length ?? 0;
      const allowUsers = override.allowUsers?.length ?? 0;
      const denyRoles = override.denyRoles?.length ?? 0;
      const denyUsers = override.denyUsers?.length ?? 0;
      return `**${name}** • allow roles: ${allowRoles}, allow users: ${allowUsers}, deny roles: ${denyRoles}, deny users: ${denyUsers}`;
    })
    .join("\n");
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("configcommands")
    .setDescription("Configure command permissions.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View command overrides.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("Command name")
            .setAutocomplete(true)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("allow-role")
        .setDescription("Allow a role to use a moderation command.")
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
        .setDescription("Allow a user to use a moderation command.")
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
        .setName("reset")
        .setDescription("Reset command overrides.")
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
            .setDescription("Which override to reset")
            .addChoices(
              { name: "allow", value: "allow" },
              { name: "deny", value: "deny" },
              { name: "all", value: "all" }
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
    return getRegistryCommandNames()
      .filter((name) => name.includes(query))
      .slice(0, MAX_AUTOCOMPLETE)
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

    await safeDefer(interaction, { ephemeral: true });

    const settings = await getGuildSettings(pool, guildContext.guild.id);
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "view") {
      const commandNameInput = interaction.options.getString("command");
      if (!commandNameInput) {
        const embed = buildEmbed(context, {
          title: "Command Overrides",
          description: trimEmbedDescription(summarizeOverrides(settings.commands))
        });
        await safeRespond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      const commandName = resolveCommandName(commandNameInput);
      if (!commandName) {
        const embed = buildEmbed(context, {
          title: "Unknown Command",
          description: `No command named \`${normalizeCommandName(
            commandNameInput
          )}\` was found.`,
          variant: "warning"
        });
        await safeRespond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      const currentOverride: CommandOverride = settings.commands[commandName] ?? {};
      const isModeration = isModerationCommand(commandName);
      const embed = buildEmbed(context, {
        title: "Command Overrides",
        description: trimEmbedDescription(
          summarizeOverride(commandName, currentOverride, { isModeration })
        )
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }

    const commandNameInput = interaction.options.getString("command", true);
    const commandName = resolveCommandName(commandNameInput);
    if (!commandName) {
      const embed = buildEmbed(context, {
        title: "Unknown Command",
        description: `No command named \`${normalizeCommandName(
          commandNameInput
        )}\` was found.`,
        variant: "warning"
      });
      await safeRespond(interaction, { embeds: [embed], ephemeral: true });
      return;
    }
    const isModeration = isModerationCommand(commandName);
    const currentOverride: CommandOverride = settings.commands[commandName] ?? {};

    if (subcommand === "allow-role" || subcommand === "deny-role") {
      if (!isModeration && subcommand === "allow-role") {
        const embed = buildEmbed(context, {
          title: "Allow List Not Available",
          description:
            "Public commands are already available to everyone. Use deny-* instead.",
          variant: "warning"
        });
        await safeRespond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      const role = interaction.options.getRole("role", true);
      const listKey = subcommand === "allow-role" ? "allowRoles" : "denyRoles";
      const currentList = new Set(currentOverride[listKey] ?? []);
      const oppositeKey = subcommand === "allow-role" ? "denyRoles" : "allowRoles";
      const oppositeList = new Set(currentOverride[oppositeKey] ?? []);
      currentList.add(role.id);
      oppositeList.delete(role.id);
      const nextOverride = {
        ...currentOverride,
        [listKey]: Array.from(currentList),
        [oppositeKey]: Array.from(oppositeList)
      };
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
      if (!isModeration && subcommand === "allow-user") {
        const embed = buildEmbed(context, {
          title: "Allow List Not Available",
          description:
            "Public commands are already available to everyone. Use deny-* instead.",
          variant: "warning"
        });
        await safeRespond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      const user = interaction.options.getUser("user", true);
      const listKey = subcommand === "allow-user" ? "allowUsers" : "denyUsers";
      const currentList = new Set(currentOverride[listKey] ?? []);
      const oppositeKey = subcommand === "allow-user" ? "denyUsers" : "allowUsers";
      const oppositeList = new Set(currentOverride[oppositeKey] ?? []);
      currentList.add(user.id);
      oppositeList.delete(user.id);
      const nextOverride = {
        ...currentOverride,
        [listKey]: Array.from(currentList),
        [oppositeKey]: Array.from(oppositeList)
      };
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

    if (subcommand === "reset") {
      const scope = interaction.options.getString("scope", true);
      if (
        !isModeration &&
        (scope === "allow-roles" || scope === "allow-users")
      ) {
        const embed = buildEmbed(context, {
          title: "Allow List Not Available",
          description: "Public commands are default-allow and cannot use allow lists.",
          variant: "warning"
        });
        await safeRespond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
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
      if (scope === "allow") {
        delete nextOverride.allowRoles;
        delete nextOverride.allowUsers;
      }
      if (scope === "deny") {
        delete nextOverride.denyRoles;
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
