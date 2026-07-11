import { tool } from "ai";
import { z } from "zod";

const KNOWLEDGE_BASE: Record<string, string> = {
  billing:
    "Double charges are usually a duplicate authorization that drops off in 3–5 days. If it already settled, refund immediately.",
  refund: "Refunds post in 5–10 business days. Pro accounts can be expedited.",
  export:
    "The Safari export failure is a known bug (TICKET-4412). Workaround: use Chrome or the CSV export.",
  pricing:
    "Team plans are $20/seat/mo with a volume discount at 25+ seats. For 50+ seats, send the pricing PDF.",
};

export const tools = {
  searchKnowledgeBase: tool({
    description: "Search the support knowledge base for relevant articles.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query to look up in the knowledge base."),
    }),
  }),

  classifyItem: tool({
    description: "Classify an item into one of the known categories.",
    inputSchema: z.object({
      itemId: z.string(),
      category: z.enum(["billing", "technicals", "sales", "other"]),
    }),
  }),

  draftReply: tool({
    description: "Write a draft reply for a work item. Does not send anything.",
    inputSchema: z.object({
      itemId: z.string(),
      message: z.string(),
    }),
  }),

  sendReply: tool({
    description:
      "Send the drafted reply to the customer. This actually emails them.",
    inputSchema: z.object({
      itemId: z.string(),
      draftId: z.string(),
    }),
  }),
};

// Extracting out execute steps outside so we can wrap them in
// a workflow that will make things more durable
export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "searchKnowledgeBase": {
      const query = String(args.query ?? "").toLowerCase();
      const hits = Object.entries(KNOWLEDGE_BASE)
        .filter(([key]) => query.includes(key))
        .map(([, article]) => article);
      return {
        articles: hits.length ? hits : ["No exact match found."],
      };
    }
    case "classifyItem":
      return { ok: true, itemId: args.itemId, category: args.category };
    case "draftReply":
      return { ok: true, draftId: `draft-${args.itemId}` };
    case "sendReply":
      return { sent: true, itemId: args.itemId, draftId: args.draftId };
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
