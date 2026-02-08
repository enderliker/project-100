import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is missing in environment variables.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  if (!client.user) {
    console.log("Logged in, but client user is not available.");
    return;
  }

  console.log(`Logged in as ${client.user.tag}`);
});

client.login(token);
