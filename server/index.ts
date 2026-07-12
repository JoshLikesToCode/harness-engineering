import "./env";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { ensureSchema, clearEventLog } from "../harness/db";
import { subscribe, history } from "../harness/bus";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { runAgentWorkflow } from "../harness/runtime";
import { type ClientMessage } from "@shared/events";

const PORT = Number(process.env.PORT ?? 8787);

async function main() {
  await ensureSchema();
  DBOS.setConfig({
    name: "harness",
    systemDatabaseUrl: process.env.DATABASE_URL ?? "",
  });
  await DBOS.launch();
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Set up CORS
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  // make route to call for clear
  app.post("/api/clear", async (_req, res) => {
    await clearEventLog();
    res.json({ ok: true });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  subscribe((event) => {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  });

  wss.on("connection", async (socket: WebSocket) => {
    socket.on("message", async (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return; // ignore anything that isn't valid JSON
      }

      if (message.type === "submit_task") {
        await DBOS.startWorkflow(runAgentWorkflow)({
          input: message.input,
        });
      }
    });
    // everything the client missed since being disconnected
    for (const event of await history()) {
      socket.send(JSON.stringify(event));
    }
  });

  server.listen(PORT, () => {
    console.log(
      `harness server listening on http://localhost:${PORT}  (ws: /ws)`,
    );
  });
}

main().catch((err) => {
  console.error("Error starting server:", err);
  process.exit(1);
});
