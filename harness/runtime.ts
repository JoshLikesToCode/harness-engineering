import { DBOS } from "@dbos-inc/dbos-sdk";
import type { ModelMessage, JSONValue } from "ai";
import { emit } from "./bus";
import { streamText } from "ai";
import { randomUUID } from "node:crypto";
import { EventType } from "@shared/events";
import { model } from "./model";
import { tools, runTool } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";

const MAX_STEPS = 10;
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
): Promise<Turn> {
  const result = streamText({ model, messages, tools });

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
export async function agentWorkflow(opts: {
  input: string;
}): Promise<string> {
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

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ];

  let step = 0;
  while (step < MAX_STEPS) {
    const turn = await DBOS.runStep(() => modelTurn(workflowId, messages), {
      name: `model.turn-${step}`,
    });

    // for streaming results, we emit events as they arrive. The model can ask for
    // tools, and we can run them and feed the results back to the model.
    // for await (const part of turn.fullStream) {
    //   switch (part.type) {
    //     case "text-delta":
    //       emit({ type: EventType.ModelDelta, workflowId, text: part.text });
    //       break;
    //     case "tool-call":
    //       emit({
    //         type: EventType.ToolRequested,
    //         workflowId,
    //         toolCallId: part.toolCallId,
    //         name: part.toolName,
    //         args: part.input,
    //       });
    //       break;
    //     case "tool-result":
    //       emit({
    //         type: EventType.ToolCompleted,
    //         workflowId,
    //         toolCallId: part.toolCallId,
    //         result: part.output,
    //       });
    //       break;
    //     case "error":
    //       emit({
    //         type: EventType.WorkflowFailed,
    //         workflowId,
    //         error: String(part.error),
    //       });
    //       return;
    //   }
    // }
    messages.push(...turn.responseMessages);
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

    for (const call of turn.toolCalls) {
      const output = await DBOS.runStep(() => toolStep(workflowId, call), {
        name: `tool-${call.toolCallId}`,
      });
      messages.push({
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
