import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

interface RedditListing {
  data: {
    children: Array<{
      data: {
        title: string;
        url: string;
        permalink: string;
        over_18: boolean;
        post_hint?: string;
      };
    }>;
  };
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("meme")
    .setDescription("Sends a random meme from r/memes."),
  execute: async (interaction, context) => {
    const response = await fetch("https://www.reddit.com/r/memes.json?limit=50", {
      headers: { "User-Agent": "project-100-bot" }
    });
    if (!response.ok) {
      const embed = buildEmbed(context, {
        title: "Meme",
        description: "Unable to fetch memes right now.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const payload = (await response.json()) as RedditListing;
    const candidates = payload.data.children
      .map((child) => child.data)
      .filter(
        (post) =>
          !post.over_18 &&
          (post.post_hint === "image" ||
            post.url.endsWith(".jpg") ||
            post.url.endsWith(".jpeg") ||
            post.url.endsWith(".png") ||
            post.url.endsWith(".gif"))
      );
    if (candidates.length === 0) {
      const embed = buildEmbed(context, {
        title: "Meme",
        description: "No safe image memes were found.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const embed = buildEmbed(context, {
      title: pick.title,
      description: `https://www.reddit.com${pick.permalink}`
    });
    embed.setImage(pick.url);
    await interaction.reply({ embeds: [embed] });
  }
};
