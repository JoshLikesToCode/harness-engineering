import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {pgTable, bigserial, jsonb} from 'drizzle-orm/pg-core'
import type { AgentEvent } from '@shared/events'

const connectionString = process.env.DATABASE_URL;

if(!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const client = postgres(connectionString, {
  max: 5,
});
export const db = drizzle(client);

export const eventLog = pgTable('event_log', {
    seq: bigserial('seq', {mode: 'number'}).primaryKey(),
    data: jsonb('data').$type<AgentEvent>().notNull()
})

export async function ensureSchema() : Promise<void> {
    await client`
        CREATE TABLE IF NOT EXISTS event_log (
            seq BIGSERIAL PRIMARY KEY,
            data JSONB NOT NULL
        )
    `
}