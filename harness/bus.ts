import { randomUUID } from "node:crypto";
import type { AgentEvent, EventInput, Emit } from "@shared/events";
import { db, eventLog } from "./db";

// A tiny in-memory event bus. The harness emits events here; the WebSocket
// layer subscribes and forwards them to every connected inspector.
//
// We keep a short ring buffer so a browser that connects late still sees the
// timeline so far.
type Listener = (event: AgentEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export async function emit(input: EventInput): Promise<void> {
  const event: AgentEvent = {...input, id: randomUUID(), ts: Date.now() };
  db.insert(eventLog).values({ data: event });
  // since this is now in db, it's safe to emit to listeners
  for (const listener of listeners) {
    listener(event);
  }
}

export async function history(): Promise<AgentEvent[]> {
  const rows = await db.select().from(eventLog).orderBy(eventLog.seq);
  return rows.map(row => row.data);
}
