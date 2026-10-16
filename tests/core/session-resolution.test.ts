/**
 * Two terminals in the same project directory: each Claude Code session must keep
 * its own ctxflow identity even though .ctxflow/current-session is shared.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, ensureDirs } from "../../src/core/paths.js";
import {
  createTask,
  createSession,
  createWorker,
  writeCurrentSession,
  getCurrentSessionId,
  bindClaudeSession,
  removeSession,
  listWorkers,
  getWorker,
  saveWorker,
} from "../../src/core/task.js";

let tmpDir: string;
const savedEnv = { ...process.env };

function startSession(name: string): string {
  const task = createTask(`${name}'s task`, name);
  const session = createSession(name, task.id);
  createWorker(name, "host", task.id, session.session_id);
  writeCurrentSession(session.session_id);
  return session.session_id;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-resolve-"));
  setProjectRoot(tmpDir);
  ensureDirs();
  delete process.env.CTXFLOW_SESSION;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getCurrentSessionId", () => {
  it("keeps each Claude session bound to the ctxflow session it started with", () => {
    const stefano = startSession("stefano");
    expect(getCurrentSessionId("claude-1")).toBe(stefano); // SessionStart in terminal 1

    const jimin = startSession("jimin"); // current-session now points at jimin
    expect(getCurrentSessionId("claude-2")).toBe(jimin); // SessionStart in terminal 2

    expect(getCurrentSessionId("claude-1")).toBe(stefano);
    expect(getCurrentSessionId("claude-2")).toBe(jimin);
  });

  it("does not let a second Claude session claim an already-claimed session", () => {
    const stefano = startSession("stefano");
    expect(getCurrentSessionId("claude-1")).toBe(stefano);
    expect(getCurrentSessionId("claude-2")).toBeNull();
  });

  it("drops a binding whose session was stopped", () => {
    const stefano = startSession("stefano");
    expect(getCurrentSessionId("claude-1")).toBe(stefano);
    removeSession(stefano);
    expect(getCurrentSessionId("claude-1")).toBeNull();
    expect(fs.readdirSync(path.join(tmpDir, ".ctxflow", "bindings"))).toHaveLength(0);
  });

  it("CTXFLOW_SESSION overrides everything", () => {
    startSession("stefano");
    process.env.CTXFLOW_SESSION = "explicit";
    expect(getCurrentSessionId("claude-1")).toBe("explicit");
  });

  it("CLI inside Claude's Bash tool uses that Claude session's binding without claiming", () => {
    const stefano = startSession("stefano");
    bindClaudeSession("claude-1", stefano);
    const jimin = startSession("jimin");

    process.env.CLAUDE_CODE_SESSION_ID = "claude-1";
    expect(getCurrentSessionId()).toBe(stefano);

    process.env.CLAUDE_CODE_SESSION_ID = "claude-unbound";
    expect(getCurrentSessionId()).toBe(jimin);
    expect(fs.existsSync(path.join(tmpDir, ".ctxflow", "bindings", "claude-unbound"))).toBe(false);
  });

  it("falls back to current-session outside Claude Code", () => {
    startSession("stefano");
    const jimin = startSession("jimin");
    expect(getCurrentSessionId()).toBe(jimin);
  });
});

describe("listWorkers effective status", () => {
  it("reports stale workers as disconnected without rewriting their file", () => {
    const id = startSession("stefano");
    const worker = getWorker(id)!;
    saveWorker({ ...worker, last_heartbeat: new Date(Date.now() - 10 * 60_000).toISOString() });

    expect(listWorkers().find((w) => w.session_id === id)?.status).toBe("disconnected");
    expect(getWorker(id)?.status).toBe("working");
  });
});
