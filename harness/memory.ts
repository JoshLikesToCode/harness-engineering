import { generateText } from "ai";
import type { ModelMessage } from "ai";
import { model } from "./model";
import { SYSTEM_PROMPT } from "./system-prompt";

// These are set relatively low for testing purposes
export const MAX_CONTEXT_TOKENS = 500;
export const KEEP_CONTEXT_TOKENS = 200;

// Tiktoken is better drop inXreplacement for this if going python route
// this "tokenizer" assumes 1 token = 4 characters, this varies by model though
export function estimateTokens(messages: ModelMessage[]): number {
  const chars = messages.reduce(
    (n, m) =>
      n +
      (typeof m.content === "string"
        ? m.content.length
        : JSON.stringify(m.content).length),
    0,
  );
  return Math.ceil(chars / 4);
}

export function buildContext(
  task: string,
  summary: string,
  turns: ModelMessage[][],
): ModelMessage[] {
  const context: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  if (summary) {
    context[0].content += `Summary of earlier work so far:\n${summary}`;
  }
  for (const turn of turns) {
    context.push(...turn);
  }
  return context;
}

export async function summarize(
  oldTurns: ModelMessage[][],
  priorSummary: string,
) {
  const transcript = oldTurns
    .flat()
    .map(
      (m) =>
        `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
    )
    .join("\n")
    .slice(0, 6000);

  const { text } = await generateText({
    model,
    messages: [
      {
        role: "system",
        content:
          "You compress an agent's work log into a short running summary. Preserve concrete facts: item ids, categories, draft ids, amounts, and what was already sent. Be terse.",
      },
      {
        role: "user",
        content: `Prior summary:\n${priorSummary || "(none)"}\n\nFold in this newer work:\n${transcript}\n\nReturn the updated summary.`,
      },
    ],
  });
  return text;
}
