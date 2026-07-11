import { streamText } from "ai";
import type { ModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import { EventType, type Emit } from "@shared/events";
import { model } from "./model";
import { tools } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";

const MAX_STEPS = 10;

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
export async function runAgent(opts: {
  input: string;
  emit: Emit;
}): Promise<void> {
  const { input, emit } = opts;
  const workflowId = randomUUID();

  emit({ type: EventType.WorkflowStarted, workflowId, input });

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ];

  let step = 0;
  while (step < MAX_STEPS) {
    const result = streamText({ model, messages, tools });

    // for streaming results, we emit events as they arrive. The model can ask for
    // tools, and we can run them and feed the results back to the model.
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          emit({ type: EventType.ModelDelta, workflowId, text: part.text });
          break;
        case "tool-call":
          emit({
            type: EventType.ToolRequested,
            workflowId,
            toolCallId: part.toolCallId,
            name: part.toolName,
            args: part.input,
          });
          break;
        case "tool-result":
          emit({
            type: EventType.ToolCompleted,
            workflowId,
            toolCallId: part.toolCallId,
            result: part.output,
          });
          break;
        case "error":
          emit({
            type: EventType.WorkflowFailed,
            workflowId,
            error: String(part.error),
          });
          return;
      }
    }
    messages.push(...(await result.response).messages);

    const toolCalls = await result.toolCalls;

    // are there are no tool calls, we are done. The model has finished its work.
    if(toolCalls.length === 0) {
      const text = await result.text;
      emit({ type: EventType.ModelCompleted, workflowId, text });
      emit({ type: EventType.WorkflowCompleted, workflowId, output: text });
      return;
    }

    step++;
  }
  emit({
    type: EventType.WorkflowFailed,
    workflowId,
    error: "You hit Max Steps",
  });
}
