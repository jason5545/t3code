import { describe, expect, it } from "vite-plus/test";

import { canStartEphemeralThread, isLoopbackBaseUrl } from "./ephemeralThread.ts";

const omp = {
  projectIsScratch: true,
  driver: "pi",
  instanceDisplayName: "OMP",
  model: "omlx/local-model",
  models: [
    { slug: "omlx/local-model", local: true },
    { slug: "opencode-go/hosted-model", local: false },
  ],
};

describe("ephemeral threads (fork patch 11)", () => {
  it("offers an ephemeral thread only in No project, on OMP, with a local model", () => {
    expect(canStartEphemeralThread(omp)).toBe(true);
    expect(canStartEphemeralThread({ ...omp, projectIsScratch: false })).toBe(false);
    expect(canStartEphemeralThread({ ...omp, instanceDisplayName: "Pi" })).toBe(false);
    expect(canStartEphemeralThread({ ...omp, driver: "codex" })).toBe(false);
    expect(canStartEphemeralThread({ ...omp, model: "opencode-go/hosted-model" })).toBe(false);
    expect(canStartEphemeralThread({ ...omp, model: "omlx/unlisted" })).toBe(false);
  });

  it("treats only loopback hosts as this machine", () => {
    expect(isLoopbackBaseUrl("http://127.0.0.1:8000/v1")).toBe(true);
    expect(isLoopbackBaseUrl("http://localhost:8000/v1")).toBe(true);
    expect(isLoopbackBaseUrl("http://[::1]:8000/v1")).toBe(true);
    expect(isLoopbackBaseUrl("http://localhost.example.com/v1")).toBe(false);
    expect(isLoopbackBaseUrl("http://127.0.0.1.nip.io/v1")).toBe(false);
    expect(isLoopbackBaseUrl("http://192.168.1.20:8000/v1")).toBe(false);
    expect(isLoopbackBaseUrl("not a url")).toBe(false);
  });
});
