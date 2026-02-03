import { EmbedBuilder } from "@discordjs/builders";

const COLOR_PRIMARY = 0x2f3136;
const COLOR_WARNING = 0xf2c94c;
const COLOR_ERROR = 0xeb5757;

export type EmbedVariant = "primary" | "warning" | "error";

export interface EmbedContext {
  serviceName: string;
  version: string;
}

export function buildBaseEmbed(
  context: EmbedContext,
  options: { title: string; description?: string; variant?: EmbedVariant }
): EmbedBuilder {
  const color =
    options.variant === "error"
      ? COLOR_ERROR
      : options.variant === "warning"
        ? COLOR_WARNING
        : COLOR_PRIMARY;

  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setColor(color)
    .setTimestamp(new Date())
    .setFooter({
      text: `${context.serviceName} • v${context.version}`
    });

  if (options.description) {
    embed.setDescription(options.description);
  }

  return embed;
}
