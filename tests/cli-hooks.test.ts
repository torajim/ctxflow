/**
 * Runs the real hook commands the way Claude Code does: a separate process,
 * hook JSON on stdin, and whatever directory Claude's shell is currently in.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, ensureDirs } from "../src/core/paths.js";
import { createTask, createSession, createWorker, getWorker } from "../src/core/task.js";

const repoRoot = path.resolve(__dirname, "..");
const viteNode = path.join(repoRoot, "node_modules", ".bin", "vite-node");
const entry = path.join(repoRoot, "src", "index.ts");

let tmpDir: string;
let mySession: string;

function runHook(args: string[], cwd: string, input: object, env: Record<string, string> = {}): string {
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_PROJECT_DIR;
  delete cleanEnv.CLAUDE_CODE_SESSION_ID;
  return execFileSync(viteNode, ["--root", repoRoot, entry, "--", ...args], {
    timeout: 30_000,
    cwd,
    input: JSON.stringify(input),
    env: { ...cleanEnv, CTXFLOW_SESSION: mySession, ...env },
    encoding: "utf-8",
  });
}

beforeAll(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-cli-hooks-")));
  setProjectRoot(tmpDir);
  ensureDirs();
  const task = createTask("Todo app", "stefano");
  const mine = createSession("stefano", task.id);
  createWorker("stefano", "host", task.id, mine.session_id);
  mySession = mine.session_id;
  const theirs = createSession("jimin", task.id);
  createWorker("jimin", "host", task.id, theirs.session_id);
  fs.mkdirSync(path.join(tmpDir, "src", "deep"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("hooks run from a subdirectory", () => {
  it("records an edit made while Claude's shell is in a subdirectory", () => {
    const file = path.join(tmpDir, "src", "formatter.ts");
    runHook(["on-edit"], path.join(tmpDir, "src", "deep"), { tool_input: { file_path: file } });

    expect(getWorker(mySession)?.files_touched.map((f) => f.path)).toContain("src/formatter.ts");
    expect(fs.existsSync(path.join(tmpDir, "src", "deep", ".ctxflow"))).toBe(false);
  });

  it("injects context while Claude's shell is inside .ctxflow", () => {
    const out = runHook(["context", "--format", "hook"], path.join(tmpDir, ".ctxflow", "context"), {});
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("jimin");
  });

  it("prefers CLAUDE_PROJECT_DIR over the current directory", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-outside-"));
    try {
      const out = runHook(["context", "--format", "hook"], outside, {}, { CLAUDE_PROJECT_DIR: tmpDir });
      expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain("jimin");
      expect(fs.existsSync(path.join(outside, ".ctxflow"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does nothing outside a ctxflow project", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-outside-"));
    try {
      const out = runHook(["context", "--format", "hook"], outside, {});
      expect(out).toBe("");
      expect(fs.existsSync(path.join(outside, ".ctxflow"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("UserPromptSubmit", () => {
  it("answers with the UserPromptSubmit event name", () => {
    const out = runHook(["context", "--format", "hook"], tmpDir, { hook_event_name: "UserPromptSubmit" });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("jimin");
  });

  it("keeps PreToolUse as the default event name", () => {
    const out = runHook(["context", "--format", "hook"], tmpDir, { hook_event_name: "PreToolUse" });
    expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });
});
