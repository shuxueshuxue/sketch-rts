import { describe, expect, it } from "vitest";
import { createDeploymentRuntime } from "./runtime";

describe("deployment runtime factory", () => {
  it("does not create server room transports in static mode", () => {
    let roomTransports = 0;

    const runtime = createDeploymentRuntime("static", {
      createRoomTransport() {
        roomTransports += 1;
        throw new Error("static mode must not create a room transport");
      },
    });

    expect(runtime.kind).toBe("static");
    expect(roomTransports).toBe(0);
  });

  it("reports static runtime readiness through the same boot callback", () => {
    let ready = 0;
    const runtime = createDeploymentRuntime("static", {
      onRuntimeReady() {
        ready += 1;
      },
    });

    runtime.initialAdapter();

    expect(ready).toBe(1);
  });
});
