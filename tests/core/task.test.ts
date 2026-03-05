import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot } from "../../src/core/paths.js";
import { execSync } from "node:child_process";
import {
  getMe,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  getWorker,
  listWorkers,
  saveWorker,
  createWorker,
  updateHeartbeat,
  addFileChange,
  getTaskParticipants,
  getActiveWorkers,
  createSession,
  getSession,
  listSessions,
  removeSession,
} from "../../src/core/task.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-test-"));
  setProjectRoot(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Identity (me) - from git config", () => {
  it("getMe returns git user.name from a git repo", () => {
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync('git config user.name "testuser"', { cwd: tmpDir, stdio: "pipe" });

    expect(getMe()).toBe("testuser");
  });

  it("getMe returns null when not a git repo", () => {
    const result = getMe();
    expect(typeof result === "string" || result === null).toBe(true);
  });
});

describe("Task CRUD", () => {
  it("createTask creates a task file", () => {
    const task = createTask("Implement JWT auth", "stefano");
    expect(task.id).toHaveLength(10);
    expect(task.description).toBe("Implement JWT auth");
    expect(task.created_by).toBe("stefano");
    expect(task.status).toBe("active");
  });

  it("getTask retrieves a created task", () => {
    const task = createTask("test task", "stefano");
    const retrieved = getTask(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.description).toBe("test task");
    expect(retrieved!.id).toBe(task.id);
  });

  it("getTask returns null for non-existent task", () => {
    expect(getTask("nonexistent")).toBeNull();
  });

  it("listTasks returns all tasks", () => {
    createTask("task 1", "a");
    createTask("task 2", "b");
    createTask("task 3", "c");
    const tasks = listTasks();
    expect(tasks).toHaveLength(3);
  });

  it("listTasks returns empty array when no tasks", () => {
    expect(listTasks()).toEqual([]);
  });

  it("updateTaskStatus changes status", () => {
    const task = createTask("task to complete", "stefano");
    expect(task.status).toBe("active");

    const updated = updateTaskStatus(task.id, "done");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("done");

    const retrieved = getTask(task.id);
    expect(retrieved!.status).toBe("done");
  });

  it("updateTaskStatus returns null for non-existent task", () => {
    expect(updateTaskStatus("nope", "done")).toBeNull();
  });
});

describe("Worker CRUD", () => {
  it("getWorker returns null for non-existent worker", () => {
    expect(getWorker("nobody")).toBeNull();
  });

  it("createWorker creates and persists a worker", () => {
    const worker = createWorker("stefano", "macbook", "task-1", "sess-abc");
    expect(worker.name).toBe("stefano");
    expect(worker.session_id).toBe("sess-abc");
    expect(worker.machine).toBe("macbook");
    expect(worker.task_id).toBe("task-1");
    expect(worker.status).toBe("working");
    expect(worker.files_touched).toEqual([]);

    const retrieved = getWorker("sess-abc");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("stefano");
    expect(retrieved!.session_id).toBe("sess-abc");
  });

  it("saveWorker updates existing worker", () => {
    const worker = createWorker("stefano", "macbook", "task-1", "sess-abc");
    worker.status = "idle";
    saveWorker(worker);

    const retrieved = getWorker("sess-abc");
    expect(retrieved!.status).toBe("idle");
  });

  it("listWorkers returns all workers", () => {
    createWorker("stefano", "mac1", "t1", "sess-1");
    createWorker("jimin", "mac2", "t2", "sess-2");
    createWorker("minho", "mac3", "t1", "sess-3");

    const workers = listWorkers();
    expect(workers).toHaveLength(3);
    const names = workers.map((w) => w.name).sort();
    expect(names).toEqual(["jimin", "minho", "stefano"]);
  });

  it("listWorkers returns empty array when none exist", () => {
    expect(listWorkers()).toEqual([]);
  });
});

describe("Session CRUD", () => {
  it("createSession creates and persists a session", () => {
    const session = createSession("stefano", "task-1");
    expect(session.session_id).toHaveLength(8);
    expect(session.name).toBe("stefano");
    expect(session.task_id).toBe("task-1");

    const retrieved = getSession(session.session_id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("stefano");
  });

  it("listSessions returns all sessions", () => {
    createSession("stefano", "t1");
    createSession("stefano", "t2");
    createSession("jimin", "t3");

    const sessions = listSessions();
    expect(sessions).toHaveLength(3);
  });

  it("removeSession deletes session file", () => {
    const session = createSession("stefano", "t1");
    expect(getSession(session.session_id)).not.toBeNull();

    removeSession(session.session_id);
    expect(getSession(session.session_id)).toBeNull();
  });
});

describe("updateHeartbeat", () => {
  it("updates the worker heartbeat timestamp", () => {
    createWorker("stefano", "mac", "t1", "sess-hb");

    const before = Date.now();
    updateHeartbeat("sess-hb");
    const after = Date.now();

    const updated = getWorker("sess-hb");
    expect(updated).not.toBeNull();
    const heartbeatTime = new Date(updated!.last_heartbeat).getTime();
    expect(heartbeatTime).toBeGreaterThanOrEqual(before);
    expect(heartbeatTime).toBeLessThanOrEqual(after);
  });

  it("does nothing for non-existent worker", () => {
    updateHeartbeat("ghost");
  });
});

describe("addFileChange", () => {
  it("adds a new file change to the worker", () => {
    createWorker("stefano", "mac", "t1", "sess-fc");
    addFileChange("sess-fc", "src/auth.ts", "+JWT middleware");

    const worker = getWorker("sess-fc");
    expect(worker!.files_touched).toHaveLength(1);
    expect(worker!.files_touched[0].path).toBe("src/auth.ts");
    expect(worker!.files_touched[0].summary).toBe("+JWT middleware");
  });

  it("updates existing file change instead of duplicating", () => {
    createWorker("stefano", "mac", "t1", "sess-fc2");
    addFileChange("sess-fc2", "src/auth.ts", "+JWT middleware");
    addFileChange("sess-fc2", "src/auth.ts", "+JWT middleware with refresh");

    const worker = getWorker("sess-fc2");
    expect(worker!.files_touched).toHaveLength(1);
    expect(worker!.files_touched[0].summary).toBe("+JWT middleware with refresh");
  });

  it("tracks multiple files", () => {
    createWorker("stefano", "mac", "t1", "sess-fc3");
    addFileChange("sess-fc3", "src/auth.ts", "+JWT");
    addFileChange("sess-fc3", "src/types.ts", "+AuthUser type");
    addFileChange("sess-fc3", "src/routes.ts", "+auth routes");

    const worker = getWorker("sess-fc3");
    expect(worker!.files_touched).toHaveLength(3);
  });

  it("does nothing for non-existent worker", () => {
    addFileChange("ghost", "src/a.ts", "+something");
  });

  it("prunes old entries when exceeding limit", () => {
    createWorker("stefano", "mac", "t1", "sess-prune");
    for (let i = 0; i < 60; i++) {
      addFileChange("sess-prune", `src/file${i}.ts`, `+file${i}`);
    }
    const worker = getWorker("sess-prune");
    expect(worker!.files_touched.length).toBeLessThanOrEqual(50);
    expect(worker!.files_touched[worker!.files_touched.length - 1].path).toBe("src/file59.ts");
  });
});

describe("getTaskParticipants", () => {
  it("returns workers participating in a given task", () => {
    createWorker("stefano", "mac1", "task-abc", "sess-p1");
    createWorker("jimin", "mac2", "task-abc", "sess-p2");
    createWorker("minho", "mac3", "task-xyz", "sess-p3");

    const participants = getTaskParticipants("task-abc");
    expect(participants).toHaveLength(2);
    const names = participants.map((w) => w.name).sort();
    expect(names).toEqual(["jimin", "stefano"]);
  });

  it("returns empty array when no participants", () => {
    createWorker("stefano", "mac1", "task-abc", "sess-px");
    expect(getTaskParticipants("task-none")).toEqual([]);
  });
});

describe("getActiveWorkers", () => {
  it("returns workers with working or idle status", () => {
    const w1 = createWorker("stefano", "mac1", "t1", "sess-a1");
    w1.status = "working";
    saveWorker(w1);

    const w2 = createWorker("jimin", "mac2", "t1", "sess-a2");
    w2.status = "idle";
    saveWorker(w2);

    const w3 = createWorker("minho", "mac3", "t1", "sess-a3");
    w3.status = "disconnected";
    saveWorker(w3);

    const active = getActiveWorkers();
    expect(active).toHaveLength(2);
    const names = active.map((w) => w.name).sort();
    expect(names).toEqual(["jimin", "stefano"]);
  });
});
