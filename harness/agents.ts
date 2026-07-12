import type { ToolSet } from "ai";
import { tools } from "./tools";

// An agent is just a name, a system prompt, and the subset of tools it's allowed
// to use. The runtime runs ANY agent through the same durable loop — so adding a
// specialist is data, not new machinery.
export type Agent = {
  name: string;
  systemPrompt: string;
  tools: ToolSet;
};

// The generalist. Note what it does NOT have: issueRefund. It can talk about a
// refund, but it isn't allowed to move money — that's the whole reason it hands
// off.
export const triageAgent: Agent = {
  name: "triage",
  systemPrompt: `You are a support triage agent.

For each work item:
1. Classify it with classifyItem.
2. If it needs data lookup or math, use runCode (you have tools.getCharges and tools.searchKnowledgeBase inside it).
3. Draft a reply with draftReply, then send it with sendReply.

IMPORTANT: you are NOT allowed to issue refunds. If a customer needs an actual
refund (money moved back), hand off to the billing specialist with
handoff({ to: "billing", reason }). Do not draft or send anything yourself in
that case — let billing take over. If more than one item needs billing, a
single handoff covers all of them — billing will hand back to you when it's
done and you can pick up where you left off.

Billing will hand control back to you (via the same handoff tool) once it has
finished its refund work. When that happens, continue with any work items you
haven't handled yet.

Only once every item has been classified and either replied-to or handed off
and resolved, briefly summarize what happened across all items. That summary
is what ends the whole task — don't produce it early.`,
  tools: {
    classifyItem: tools.classifyItem,
    runCode: tools.runCode,
    draftReply: tools.draftReply,
    sendReply: tools.sendReply,
    handoff: tools.handoff,
  },
};

// The specialist. It has the privileged issueRefund tool and a stricter policy.
// Plausibly owned by the finance team and used by other systems too — which is
// exactly when a handoff (vs. just adding a tool) is worth it.
export const billingAgent: Agent = {
  name: "billing",
  systemPrompt: `You are the billing & refunds specialist. You can issue refunds —
issueRefund is IRREVERSIBLE and moves real money, so be careful.

For a refund request:
1. Use runCode (tools.getCharges) to verify the duplicate charge and the exact amount.
2. Issue the refund with issueRefund (customerId, chargeId, amountCents).
3. Draft and send a confirmation with draftReply + sendReply.

IMPORTANT: you only handle the billing/refund part. Once you've finished it,
hand off back to triage with handoff({ to: "triage", reason }) so it can
continue with any other work items — do NOT write a final summary yourself,
that would end the whole task early and leave the rest of the queue
unhandled.`,
  tools: {
    runCode: tools.runCode,
    issueRefund: tools.issueRefund,
    draftReply: tools.draftReply,
    sendReply: tools.sendReply,
    handoff: tools.handoff,
  },
};

export const agents: Record<string, Agent> = {
  triage: triageAgent,
  billing: billingAgent,
};
