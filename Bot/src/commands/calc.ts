import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "./types";
import { buildEmbed } from "./command-utils";

type Operator = "+" | "-" | "*" | "/" | "%" | "^";

const OPERATORS: Record<Operator, { precedence: number; associativity: "left" | "right" }> = {
  "+": { precedence: 1, associativity: "left" },
  "-": { precedence: 1, associativity: "left" },
  "*": { precedence: 2, associativity: "left" },
  "/": { precedence: 2, associativity: "left" },
  "%": { precedence: 2, associativity: "left" },
  "^": { precedence: 3, associativity: "right" }
};

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of expression) {
    if (/\d|\./.test(char)) {
      current += char;
      continue;
    }
    if (current) {
      tokens.push(current);
      current = "";
    }
    if (/\s/.test(char)) {
      continue;
    }
    if ("+-*/%^()".includes(char)) {
      tokens.push(char);
    } else {
      throw new Error("Invalid character in expression.");
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function toRpn(tokens: string[]): string[] {
  const output: string[] = [];
  const stack: string[] = [];

  for (const token of tokens) {
    if (!Number.isNaN(Number(token))) {
      output.push(token);
      continue;
    }
    if (token in OPERATORS) {
      const operator = token as Operator;
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (!(top in OPERATORS)) {
          break;
        }
        const topOp = top as Operator;
        const current = OPERATORS[operator];
        const previous = OPERATORS[topOp];
        if (
          (current.associativity === "left" && current.precedence <= previous.precedence) ||
          (current.associativity === "right" && current.precedence < previous.precedence)
        ) {
          output.push(stack.pop() as string);
        } else {
          break;
        }
      }
      stack.push(operator);
      continue;
    }
    if (token === "(") {
      stack.push(token);
      continue;
    }
    if (token === ")") {
      while (stack.length > 0 && stack[stack.length - 1] !== "(") {
        output.push(stack.pop() as string);
      }
      if (stack.pop() !== "(") {
        throw new Error("Mismatched parentheses.");
      }
      continue;
    }
    throw new Error("Invalid expression.");
  }

  while (stack.length > 0) {
    const token = stack.pop() as string;
    if (token === "(" || token === ")") {
      throw new Error("Mismatched parentheses.");
    }
    output.push(token);
  }

  return output;
}

function evaluateRpn(tokens: string[]): number {
  const stack: number[] = [];
  for (const token of tokens) {
    if (!Number.isNaN(Number(token))) {
      stack.push(Number(token));
      continue;
    }
    if (!(token in OPERATORS)) {
      throw new Error("Invalid expression.");
    }
    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      throw new Error("Invalid expression.");
    }
    switch (token as Operator) {
      case "+":
        stack.push(left + right);
        break;
      case "-":
        stack.push(left - right);
        break;
      case "*":
        stack.push(left * right);
        break;
      case "/":
        stack.push(left / right);
        break;
      case "%":
        stack.push(left % right);
        break;
      case "^":
        stack.push(left ** right);
        break;
      default:
        throw new Error("Invalid expression.");
    }
  }
  if (stack.length !== 1) {
    throw new Error("Invalid expression.");
  }
  return stack[0];
}

function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  const rpn = toRpn(tokens);
  return evaluateRpn(rpn);
}

export const command: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("calc")
    .setDescription("Evaluates a math expression.")
    .addStringOption((option) =>
      option.setName("expression").setDescription("Expression to evaluate").setRequired(true)
    ),
  execute: async (interaction, context) => {
    const expression = interaction.options.getString("expression", true);
    try {
      const result = evaluateExpression(expression);
      const embed = buildEmbed(context, {
        title: "Calculator",
        description: `${expression} = **${result}**`
      });
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = buildEmbed(context, {
        title: "Calculator",
        description: "Invalid expression.",
        variant: "warning"
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
