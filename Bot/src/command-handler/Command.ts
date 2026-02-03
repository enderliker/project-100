import type {
  ApplicationCommandOptionChoiceData,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  PermissionResolvable,
  SlashCommandBuilder
} from "discord.js";
import type { CommandContext, CommandHandlerInteraction } from "./Context";

export type CommandInteraction = CommandHandlerInteraction;

export interface AutocompleteContext extends CommandContext {
  interaction: AutocompleteInteraction;
}

export interface Command {
  name: string;
  data: SlashCommandBuilder;
  execute: (context: CommandContext) => Promise<void>;
  autocomplete?: (
    context: AutocompleteContext
  ) => Promise<ApplicationCommandOptionChoiceData[]> | Promise<void>;
  permissions?: PermissionResolvable[];
  guildOnly?: boolean;
  dmOnly?: boolean;
  cooldownSeconds?: number;
}
