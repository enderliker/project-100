# Command Handler

This folder contains the centralized Discord command handler used by the Bot service. It wraps the existing command definitions and adds middleware, logging, and error handling.

## Usage

The entry point is `handleInteraction` from `execute.ts`. It builds a `CommandContext` per interaction, runs middleware (maintenance, guild/DM checks, permissions, cooldowns), and safely executes commands.

Command definitions are loaded from `Bot/src/commands` using the existing loader and then registered via the registry:

```ts
import { reloadDiscordCommands, registerCommandDefinitions } from "./command-handler/registry";

const definitions = await reloadDiscordCommands({ commandsDir, rest, discordAppId });
registerCommandDefinitions(definitions);
```

## Adding a command

1. Create a new command file in `Bot/src/commands` that exports a `command` with `data` and `execute` (current pattern).
2. The loader will pick up the command and register it automatically on startup.

If you want to use new handler features (permissions, cooldowns, etc.), add a new `Command` object and register it directly via `registerCommand` in the registry.

## Extensibility

- Autocomplete: add an `autocomplete` function to a `Command` definition; the handler will call it for `interaction.isAutocomplete()`.
- Subcommands: use `context.getSubcommand()` / `context.getSubcommandGroup()` helpers to read subcommands safely.
