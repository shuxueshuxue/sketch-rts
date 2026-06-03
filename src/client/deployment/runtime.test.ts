import { describe, expect, it } from "vitest";
import { createDeploymentRuntime } from "./runtime";

describe("deployment runtime factory", () => {
  it("does not create server sockets in static mode", () => {
    let sessionSockets = 0;
    let roomTransports = 0;

    const runtime = createDeploymentRuntime("static", {
      createSessionSocket() {
        sessionSockets += 1;
        throw new Error("static mode must not create a session socket");
      },
      createRoomTransport() {
        roomTransports += 1;
        throw new Error("static mode must not create a room transport");
      },
    });

    expect(runtime.kind).toBe("static");
    expect(sessionSockets).toBe(0);
    expect(roomTransports).toBe(0);
  });

  it("reports static runtime readiness through the same boot callback", () => {
    let ready = 0;
    const runtime = createDeploymentRuntime("static", {
      onSessionOpen() {
        ready += 1;
      },
    });

    runtime.initialAdapter();

    expect(ready).toBe(1);
  });
});
