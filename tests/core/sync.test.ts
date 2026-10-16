/**
 * Integration test against real git: two project clones share a bare remote and
 * exchange ctxflow state through the orphan "ctxflow" branch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setProjectRoot, ensureDirs, contextFile } from "../../src/core/paths.js";
import {
  createTask,
  createSession,
  createWorker,
  listWorkers,
  getWorker,
  addFileChange,
} from "../../src/core/task.js";
import { fullSync, ensureCtxflowBranch } from "../../src/core/sync.js";
import { generateContext } from "../../src/core/context.js";

let root: string;
let remote: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeClone(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", remote);
  return dir;
}

function startWorker(project: string, name: string, taskId?: string): { sessionId: string; taskId: string } {
  setProjectRoot(project);
  ensureDirs();
  const tid = taskId ?? createTask(`${name}'s task`, name).id;
  const session = createSession(name, tid);
  createWorker(name, name + "-host", tid, session.session_id);
  return { sessionId: session.session_id, taskId: tid };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-sync-"));
  remote = path.join(root, "remote.git");
  git(root, "init", "-q", "--bare", remote);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ctxflow branch sync", () => {
  it("creates a non-bare sync repository", async () => {
    const a = makeClone("a");
    startWorker(a, "stefano");
    await ensureCtxflowBranch();

    const out = execFileSync("git", ["config", "core.bare"], {
      encoding: "utf-8",
      env: { ...process.env, GIT_DIR: path.join(a, ".ctxflow", ".sync") },
    }).trim();
    expect(out).toBe("false");
  });

  it("repairs a sync repository left bare by older versions", async () => {
    const a = makeClone("a");
    setProjectRoot(a);
    ensureDirs();
    const syncDir = path.join(a, ".ctxflow", ".sync");
    execFileSync("git", ["init", "-q"], { env: { ...process.env, GIT_DIR: syncDir } });

    const { sessionId } = startWorker(a, "stefano");
    await fullSync([sessionId]);

    expect(git(root, "--git-dir", remote, "branch", "--list", "ctxflow")).toContain("ctxflow");
  });

  it("exchanges workers, files and context notes between two clones", async () => {
    const a = makeClone("a");
    const b = makeClone("b");

    const stefano = startWorker(a, "stefano");
    addFileChange(stefano.sessionId, "src/api/users.ts", "+CRUD endpoints");
    fs.writeFileSync(contextFile(stefano.sessionId), "Using Drizzle ORM, REST endpoints\n");
    await fullSync([stefano.sessionId]);

    const jimin = startWorker(b, "jimin", stefano.taskId);
    addFileChange(jimin.sessionId, "src/api/users.ts", "+validation");
    await fullSync([jimin.sessionId]);

    // b sees a
    const seenByB = generateContext(jimin.sessionId, "hook");
    expect(seenByB).toContain("stefano");
    expect(seenByB).toContain("Drizzle ORM");
    expect(seenByB).toContain("conflict: src/api/users.ts");

    // a sees b after its next sync
    setProjectRoot(a);
    await fullSync([stefano.sessionId]);
    const names = listWorkers().map((w) => w.name).sort();
    expect(names).toEqual(["jimin", "stefano"]);
    expect(generateContext(stefano.sessionId, "hook")).toContain("jimin");
  });

  it("keeps local edits when both sides push concurrently", async () => {
    const a = makeClone("a");
    const b = makeClone("b");
    const stefano = startWorker(a, "stefano");
    await fullSync([stefano.sessionId]);
    const jimin = startWorker(b, "jimin", stefano.taskId);
    await fullSync([jimin.sessionId]);

    // Both change their own state, b pushes first, then a pushes (needs to integrate)
    setProjectRoot(b);
    addFileChange(jimin.sessionId, "b.ts", "+b");
    await fullSync([jimin.sessionId]);

    setProjectRoot(a);
    addFileChange(stefano.sessionId, "a.ts", "+a");
    await fullSync([stefano.sessionId]);

    expect(getWorker(stefano.sessionId)?.files_touched.map((f) => f.path)).toContain("a.ts");
    expect(getWorker(jimin.sessionId)?.files_touched.map((f) => f.path)).toContain("b.ts");

    setProjectRoot(b);
    await fullSync([jimin.sessionId]);
    expect(getWorker(stefano.sessionId)?.files_touched.map((f) => f.path)).toContain("a.ts");
  });

  it("never pushes local-only state", async () => {
    const a = makeClone("a");
    const { sessionId } = startWorker(a, "stefano");
    await fullSync([sessionId]);

    const files = git(root, "--git-dir", remote, "ls-tree", "-r", "--name-only", "ctxflow")
      .split("\n")
      .filter(Boolean);
    expect(files.some((f) => f.startsWith("sessions/"))).toBe(false);
    expect(files).toContain(`workers/${sessionId}.json`);
  });
});
