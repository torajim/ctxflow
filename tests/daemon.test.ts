import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, ensureDirs, daemonPidFile } from "../src/core/paths.js";
import { isDaemonRunning, stopDaemon } from "../src/daemon.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-daemon-test-"));
  setProjectRoot(tmpDir);
  ensureDirs();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isDaemonRunning", () => {
  it("returns false when no PID file exists", () => {
    expect(isDaemonRunning()).toBe(false);
  });

  it("returns false when PID file contains invalid data", () => {
    fs.writeFileSync(daemonPidFile(), "notanumber");
    expect(isDaemonRunning()).toBe(false);
  });

  it("returns false when PID file references dead process", () => {
    // Use a very high PID that almost certainly doesn't exist
    fs.writeFileSync(daemonPidFile(), "9999999");
    expect(isDaemonRunning()).toBe(false);
  });

  it("returns true when PID file references current process", () => {
    fs.writeFileSync(daemonPidFile(), String(process.pid));
    expect(isDaemonRunning()).toBe(true);
  });
});

describe("stopDaemon", () => {
  it("removes PID file even if process is dead", () => {
    fs.writeFileSync(daemonPidFile(), "9999999");
    stopDaemon();
    expect(fs.existsSync(daemonPidFile())).toBe(false);
  });

  it("does not throw when no PID file exists", () => {
    expect(() => stopDaemon()).not.toThrow();
  });
});
