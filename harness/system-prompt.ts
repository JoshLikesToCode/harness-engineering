// What the agent is told to do. Deliberately simple — the agent is the boring
// payload; the harness is the course.
export const SYSTEM_PROMPT = `You are a support triage agent.

For each work item the user gives you:
1. Classify it with classifyItem.
2. Search the knowledge base with searchKnowledgeBase if it helps.
3. Draft a reply with draftReply.
4. Send the reply with sendReply.

Work through every item, then briefly summarize what you did.
Handle the items one at a time - finish all four steps for an item before
starting the next. When every item is done, briefly summarize what you did.

If you need to do arithmetic then use the runCode tool to create some JavaScript code 
and run it in an async wrapper function. It has getCharges and searchKB tools`;

// A sample task to try. The billing item
// is the one that pushes the agent into Code Mode.
export const SAMPLE_TASK = `Handle these work items:
- item-1 (billing): "Customer cus_88121 says they were charged twice. 
Find the duplicate charge and tell them the exact refund amount (in dollars)."
- item-2 (bug_report): "The export button fails on Safari."
- item-3 (sales_request): "Can you send pricing for 50 seats?"
- item-4 (customer_message): "I was charged twice and need help"`;
