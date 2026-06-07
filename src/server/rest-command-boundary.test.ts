import { once } from "node:events";
import { createServer } from "node:net";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

describe("server REST and WebSocket command ingress", () => {
  it("rejects malformed commands at both real network boundaries", async () => {
    const port = await freePort();
    const server = await startServer(port);
    try {
      const room = await postJson(`http://127.0.0.1:${port}/api/rooms`, {
        id: `malformed-command-${Date.now()}`,
        host: { id: "host", name: "Host" },
        mapId: "bareDuel",
        humanCount: 1,
        aiCount: 1,
      });
      await postJson(`http://127.0.0.1:${port}/api/rooms/${room.id}/start`, {});

      const rest = await fetch(`http://127.0.0.1:${port}/api/rooms/${room.id}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "player", command: { type: "move" } }),
      });

      expect(rest.status).toBe(400);
      expect(await rest.json()).toEqual({ error: "Malformed room command" });
      await expect(webSocketMalformedCommand(`ws://127.0.0.1:${port}/ws/rooms/${room.id}`, room.id)).resolves.toEqual({
        type: "error",
        roomId: room.id,
        message: "Malformed client command message",
      });
    } finally {
      await stopServer(server);
    }
  }, 45_000);

  it("rejects malformed room reset setup payloads through the shared room schema", async () => {
    const port = await freePort();
    const server = await startServer(port);
    try {
      const room = await postJson(`http://127.0.0.1:${port}/api/rooms`, {
        id: `malformed-reset-${Date.now()}`,
        host: { id: "host", name: "Host" },
        mapId: "bareDuel",
        humanCount: 1,
        aiCount: 1,
      });
      await postJson(`http://127.0.0.1:${port}/api/rooms/${room.id}/start`, {});

      await expect(
        postRawJson(`http://127.0.0.1:${port}/api/rooms/${room.id}/reset`, {
          mapId: "bareDuel",
          options: { scenario: { addUnits: [{ id: "bad", owner: "neutral", kind: "wildling", x: 1, y: 2, hp: 9999 }] } },
        }),
      ).resolves.toEqual({
        status: 400,
        body: { error: "Malformed room reset input" },
      });
    } finally {
      await stopServer(server);
    }
  }, 45_000);

  it("rejects malformed save and debug replay payloads at real REST boundaries", async () => {
    const port = await freePort();
    const server = await startServer(port);
    try {
      const roomId = `malformed-save-${Date.now()}`;

      await expect(postRawJson(`http://127.0.0.1:${port}/api/rooms/${roomId}/save`, {})).resolves.toEqual({
        status: 400,
        body: { error: "Malformed savegame input" },
      });
      await expect(postRawJson(`http://127.0.0.1:${port}/api/rooms/${roomId}/debug-replay`, { id: "trace", label: 12 })).resolves.toEqual({
        status: 400,
        body: { error: "Malformed debug replay input" },
      });
      await expect(postRawJson(`http://127.0.0.1:${port}/api/rooms/${roomId}/debug-replay/ticks/65/save`, { label: "missing id" })).resolves.toEqual({
        status: 400,
        body: { error: "Malformed replay frame save input" },
      });
    } finally {
      await stopServer(server);
    }
  }, 45_000);
});

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ id: string }>;
}

async function postRawJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function webSocketMalformedCommand(url: string, roomId: string): Promise<unknown> {
  const socket = new WebSocket(url);
  try {
    await waitForSocketOpen(socket);
    socket.send(JSON.stringify({ type: "command", roomId, playerId: "player", command: { type: "move" } }));
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for malformed command error")), 2_000);
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { type?: string };
        if (message.type !== "error") return;
        clearTimeout(timeout);
        resolve(message);
      });
    });
  } finally {
    socket.close();
  }
}

async function waitForSocketOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket open")), 2_000);
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function startServer(port: number): Promise<ChildProcessWithoutNullStreams> {
  const server = spawn("./node_modules/.bin/tsx", ["src/server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), ROOM_AUTOTICK: "0" },
  });
  const chunks: string[] = [];
  const collect = (chunk: Buffer) => chunks.push(chunk.toString());
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const fail = async (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      await stopServer(server);
      reject(error);
    };
    const pass = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    timeout = setTimeout(
      () => void fail(new Error(`server did not start on ${port}; output=${chunks.join("")}`)),
      30_000,
    );
    server.once("exit", (code) => {
      void fail(new Error(`server exited before listening with code ${code}; output=${chunks.join("")}`));
    });
    server.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(`127.0.0.1:${port}`)) {
        pass();
      }
    });
  });
  return server;
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) =>
      setTimeout(() => {
        if (server.exitCode === null) server.kill("SIGKILL");
        resolve(undefined);
      }, 2_000),
    ),
  ]);
}

async function freePort(): Promise<number> {
  for (let port = 31000; port < 33000; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error("No free test port in 31000-32999");
}

async function canListen(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}
