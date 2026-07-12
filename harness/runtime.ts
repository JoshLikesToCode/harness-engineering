import { DBOS } from "@dbos-inc/dbos-sdk";
import type { ModelMessage, JSONValue, ToolSet } from "ai";
import { emit } from "./bus";
import { streamText } from "ai";
import { EventType } from "@shared/events";
import { model } from "./model";
import { runTool } from "./tools";
import { triageAgent, agents } from "./agents";
import {
  buildContext,
  summarize,
  estimateTokens,
  MAX_CONTEXT_TOKENS,
  KEEP_CONTEXT_TOKENS,
} from "./memory";

const MAX_STEPS = 30;

type ToolCall = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};
type Turn = {
  text: string;
  toolCalls: ToolCall[];
  responseMessages: ModelMessage[];
};

async function modelTurn(
  workflowId: string,
  messages: ModelMessage[],
  agentTools: ToolSet,
): Promise<Turn> {
  const result = streamText({ model, messages, tools: agentTools });

  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      await emit({ type: EventType.ModelDelta, workflowId, text: part.text });
    }
  }
  const rawCalls = await result.toolCalls;
  return {
    text: await result.text,
    toolCalls: rawCalls.map((c) => ({
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input as Record<string, unknown>,
    })),
    responseMessages: (await result.response).messages,
  };
}

async function toolStep(
  workflowId: string,
  call: ToolCall,
): Promise<Record<string, unknown>> {
  await emit({
    type: EventType.ToolRequested,
    workflowId,
    toolCallId: call.toolCallId,
    name: call.toolName,
    args: call.input,
  });

  const output = await runTool(call.toolName, call.input);
  await emit({
    type: EventType.ToolCompleted,
    workflowId,
    toolCallId: call.toolCallId,
    result: output,
  });
  return output;
}

// helper function that takes any value and any tool call and creates a message
// summarizing the result
function toolResultMessage(call: ToolCall, value: JSONValue): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "json", value: "" },
      },
    ],
  };
}

// This is the seam the whole course lives in.
//
// Right now it is a STUB: it announces a workflow, logs that nothing is wired
// up yet, and finishes. The starter app runs end-to-end (browser → socket →
// server → bus → browser) with this hole in the middle.
//
// In LESSON 1 you replace the body with the brittle agent loop:
//   - call the model (streamText) with the task as the prompt
//   - stream tokens out as `model.delta` events
//   - when the model asks for a tool, run it and emit `tool.requested` /
//     `tool.completed`, then feed the result back to the model
//   - repeat until the model stops asking for tools
//
// Then you spend the rest of the day discovering everything this naive loop
// gets wrong in production, and building the harness that fixes it.
export async function agentWorkflow(opts: { input: string }): Promise<string> {
  const { input } = opts;
  const workflowId = DBOS.workflowID ?? "unknown";

  // How we use DBOS to make the workflow more durable is that we wrap each step in a
  // `DBOS.runStep` call. This will checkpoint the workflow state to the DBOS
  // service, so if the server crashes or restarts, we can resume from the last
  // completed step.
  await DBOS.runStep(
    async () => {
      emit({ type: EventType.WorkflowStarted, workflowId, input });
    },
    {
      name: "workflow.started",
    },
  );

  let currentAgent = triageAgent;
  let turns: ModelMessage[][] = [];
  let summary = "";

  let step = 0;
  while (step < MAX_STEPS) {
    // summarize (if needed) before handing back to model
    if (estimateTokens(turns.flat()) > MAX_CONTEXT_TOKENS) {
      const old: ModelMessage[][] = [];
      while (
        turns.length > 1 &&
        estimateTokens(turns.flat()) > KEEP_CONTEXT_TOKENS
      ) {
        const oldest = turns.shift();
        if (oldest) {
          old.push(oldest);
        }
        // do summary
        if (old.length > 0) {
          summary = await DBOS.runStep(() => summarize(old, summary), {
            name: `summarize-${step}`,
          });
          const contextTokens = estimateTokens(
            buildContext(currentAgent.systemPrompt, input, summary, turns),
          );
          await DBOS.runStep(
            () =>
              emit({
                type: EventType.MemoryCompacted,
                workflowId,
                summarizedTurns: old.length,
                contextTokens,
                summary,
              }),
            { name: `compacted-${step}` },
          );
        }
      }
    }

    const context = buildContext(
      currentAgent.systemPrompt,
      input,
      summary,
      turns,
    );
    const turn = await DBOS.runStep(
      () => modelTurn(workflowId, context, currentAgent.tools),
      {
        name: `model.turn-${step}`,
      },
    );
    const turnMessages: ModelMessage[] = [...turn.responseMessages];

    // are there are no tool calls, we are done. The model has finished its work.
    if (turn.toolCalls.length === 0) {
      await DBOS.runStep(
        async () =>
          emit({ type: EventType.ModelCompleted, workflowId, text: turn.text }),
        { name: `model.completed-${step}` },
      );
      await DBOS.runStep(
        async () =>
          emit({
            type: EventType.WorkflowCompleted,
            workflowId,
            output: turn.text,
          }),
        { name: `workflow.completed-${step}` },
      );
      return turn.text;
    }

    // Captured once, before the loop below can mutate currentAgent — every
    // tool call in this turn was made by the SAME agent (whoever ran
    // modelTurn above), even if the loop processes multiple handoffs.
    const turnAgent = currentAgent.name;

    for (const call of turn.toolCalls) {
      if (call.toolName == "handoff") {
        const to = String(call.input.to ?? "");
        const reason = String(call.input.reason ?? "");
        const from = turnAgent;

        await DBOS.runStep(
          () =>
            emit({
              type: EventType.AgentHandoff,
              workflowId,
              from,
              to,
              reason,
            }),
          { name: `handoff-${step}` },
        );
        currentAgent = agents[to] ?? currentAgent;
        turnMessages.push(
          toolResultMessage(call, { ok: true, handedOffTo: to }),
        );
      } else {
        const output = await DBOS.runStep(() => toolStep(workflowId, call), {
          name: `tool-${call.toolCallId}`,
        });
        turnMessages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { type: "json", value: output as JSONValue },
            },
          ],
        });
      }
    }
    turns.push(turnMessages);
    step++;
  }
  await DBOS.runStep(
    async () =>
      emit({
        type: EventType.WorkflowFailed,
        workflowId,
        error: "You hit Max Steps",
      }),
    { name: `workflow.failed-${step}` },
  );
  return "You hit Max Steps";
}

export const runAgentWorkflow = DBOS.registerWorkflow(agentWorkflow, {
  name: "agent-workflow",
});
