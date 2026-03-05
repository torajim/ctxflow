/**
 * Multi-session simulation test
 *
 * Simulates the scenario where the SAME git user runs ctxflow
 * in two different terminals, working on different tasks simultaneously.
 * This proves that session-based worker identification enables
 * true collaboration even from a single developer's multiple sessions.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, ensureDirs, contextFile } from "../../src/core/paths.js";
import {
  createTask,
  createWorker,
  createSession,
  getWorker,
  getTask,
  saveWorker,
  addFileChange,
  getTaskParticipants,
  updateTaskStatus,
  removeSession,
  listSessions,
  listWorkers,
} from "../../src/core/task.js";
import { generateContext } from "../../src/core/context.js";
import { detectConflicts } from "../../src/core/conflict.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-sim-"));
  setProjectRoot(tmpDir);
  ensureDirs();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Multi-session simulation: same user, two terminals", () => {
  // The same developer "stefano" opens two terminals
  const USER = "stefano";
  const MACHINE = "macbook-pro";

  it("Step 1: Both sessions start independently", () => {
    // Terminal 1: stefano starts working on auth
    const task1 = createTask("Implement JWT authentication", USER);
    const session1 = createSession(USER, task1.id);
    const worker1 = createWorker(USER, MACHINE, task1.id, session1.session_id);

    // Terminal 2: stefano starts working on dashboard
    const task2 = createTask("Build admin dashboard", USER);
    const session2 = createSession(USER, task2.id);
    const worker2 = createWorker(USER, MACHINE, task2.id, session2.session_id);

    // Both sessions and workers coexist
    expect(listSessions()).toHaveLength(2);
    expect(listWorkers()).toHaveLength(2);

    // Both workers have the same display name but different session IDs
    expect(worker1.name).toBe(USER);
    expect(worker2.name).toBe(USER);
    expect(worker1.session_id).not.toBe(worker2.session_id);

    // Both are independently working
    expect(worker1.status).toBe("working");
    expect(worker2.status).toBe("working");
  });

  it("Step 2: File changes are tracked per session", () => {
    const task1 = createTask("Implement JWT authentication", USER);
    const session1 = createSession(USER, task1.id);
    createWorker(USER, MACHINE, task1.id, session1.session_id);

    const task2 = createTask("Build admin dashboard", USER);
    const session2 = createSession(USER, task2.id);
    createWorker(USER, MACHINE, task2.id, session2.session_id);

    // Session 1 edits auth-related files
    addFileChange(session1.session_id, "src/auth/middleware.ts", "+JWT verify middleware");
    addFileChange(session1.session_id, "src/auth/tokens.ts", "+token generation");
    addFileChange(session1.session_id, "src/types/auth.ts", "+AuthPayload type");

    // Session 2 edits dashboard-related files
    addFileChange(session2.session_id, "src/dashboard/layout.tsx", "+dashboard layout");
    addFileChange(session2.session_id, "src/dashboard/widgets.tsx", "+stat widgets");
    addFileChange(session2.session_id, "src/api/dashboard.ts", "+dashboard API routes");

    // Each session tracks only its own files
    const w1 = getWorker(session1.session_id)!;
    const w2 = getWorker(session2.session_id)!;

    expect(w1.files_touched).toHaveLength(3);
    expect(w1.files_touched.map((f) => f.path)).toContain("src/auth/middleware.ts");
    expect(w1.files_touched.map((f) => f.path)).not.toContain("src/dashboard/layout.tsx");

    expect(w2.files_touched).toHaveLength(3);
    expect(w2.files_touched.map((f) => f.path)).toContain("src/dashboard/layout.tsx");
    expect(w2.files_touched.map((f) => f.path)).not.toContain("src/auth/middleware.ts");
  });

  it("Step 3: Each session sees the other's context", () => {
    const task1 = createTask("Implement JWT authentication", USER);
    const session1 = createSession(USER, task1.id);
    const w1 = createWorker(USER, MACHINE, task1.id, session1.session_id);
    w1.status = "working";
    w1.files_touched = [
      { path: "src/auth/middleware.ts", summary: "+JWT verify", updated_at: new Date().toISOString() },
    ];
    saveWorker(w1);

    const task2 = createTask("Build admin dashboard", USER);
    const session2 = createSession(USER, task2.id);
    const w2 = createWorker(USER, MACHINE, task2.id, session2.session_id);
    w2.status = "working";
    w2.files_touched = [
      { path: "src/dashboard/layout.tsx", summary: "+dashboard layout", updated_at: new Date().toISOString() },
    ];
    saveWorker(w2);

    // Write approach notes for each session
    fs.writeFileSync(contextFile(session1.session_id), "Using jose library for JWT, REST middleware pattern");
    fs.writeFileSync(contextFile(session2.session_id), "React with TanStack Query, card-based layout");

    // Session 1's Claude sees Session 2's work
    const ctx1 = generateContext(session1.session_id, "text");
    expect(ctx1).toContain("Build admin dashboard");
    expect(ctx1).toContain("src/dashboard/layout.tsx");
    expect(ctx1).toContain("React with TanStack Query");
    // Should NOT see its own task
    expect(ctx1).not.toContain("Implement JWT authentication");

    // Session 2's Claude sees Session 1's work
    const ctx2 = generateContext(session2.session_id, "text");
    expect(ctx2).toContain("Implement JWT authentication");
    expect(ctx2).toContain("src/auth/middleware.ts");
    expect(ctx2).toContain("jose library for JWT");
    // Should NOT see its own task
    expect(ctx2).not.toContain("Build admin dashboard");
  });

  it("Step 4: Conflict detection works across same-user sessions", () => {
    const task1 = createTask("Auth feature", USER);
    const session1 = createSession(USER, task1.id);
    const w1 = createWorker(USER, MACHINE, task1.id, session1.session_id);
    w1.status = "working";
    w1.files_touched = [
      { path: "src/types/index.ts", summary: "+AuthPayload", updated_at: new Date().toISOString() },
      { path: "src/auth/middleware.ts", summary: "+JWT verify", updated_at: new Date().toISOString() },
    ];
    saveWorker(w1);

    const task2 = createTask("Dashboard feature", USER);
    const session2 = createSession(USER, task2.id);
    const w2 = createWorker(USER, MACHINE, task2.id, session2.session_id);
    w2.status = "working";
    w2.files_touched = [
      { path: "src/types/index.ts", summary: "+DashboardConfig", updated_at: new Date().toISOString() },
      { path: "src/dashboard/layout.tsx", summary: "+layout", updated_at: new Date().toISOString() },
    ];
    saveWorker(w2);

    // Detect conflict on shared file
    const workers = listWorkers();
    const conflicts = detectConflicts(workers);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].file).toBe("src/types/index.ts");
    expect(conflicts[0].workers).toHaveLength(2);

    // Both sessions see conflict warning in context
    const ctx1 = generateContext(session1.session_id, "text");
    expect(ctx1).toContain("conflict");
    expect(ctx1).toContain("src/types/index.ts");

    const ctx2 = generateContext(session2.session_id, "text");
    expect(ctx2).toContain("conflict");
    expect(ctx2).toContain("src/types/index.ts");
  });

  it("Step 5: Hook format wraps context correctly for each session", () => {
    const task1 = createTask("Auth", USER);
    const session1 = createSession(USER, task1.id);
    const w1 = createWorker(USER, MACHINE, task1.id, session1.session_id);
    w1.status = "working";
    saveWorker(w1);

    const task2 = createTask("Dashboard", USER);
    const session2 = createSession(USER, task2.id);
    const w2 = createWorker(USER, MACHINE, task2.id, session2.session_id);
    w2.status = "working";
    saveWorker(w2);

    // Hook format includes system-reminder tags
    const hook1 = generateContext(session1.session_id, "hook");
    expect(hook1).toMatch(/^<system-reminder>/);
    expect(hook1).toMatch(/<\/system-reminder>$/);
    expect(hook1).toContain("Dashboard");

    const hook2 = generateContext(session2.session_id, "hook");
    expect(hook2).toMatch(/^<system-reminder>/);
    expect(hook2).toContain("Auth");
  });

  it("Step 6: Third user joins and sees both sessions", () => {
    // stefano has two sessions
    const task1 = createTask("Auth", USER);
    const session1 = createSession(USER, task1.id);
    const w1 = createWorker(USER, MACHINE, task1.id, session1.session_id);
    w1.status = "working";
    w1.files_touched = [
      { path: "src/auth.ts", summary: "+JWT", updated_at: new Date().toISOString() },
    ];
    saveWorker(w1);

    const task2 = createTask("Dashboard", USER);
    const session2 = createSession(USER, task2.id);
    const w2 = createWorker(USER, MACHINE, task2.id, session2.session_id);
    w2.status = "working";
    w2.files_touched = [
      { path: "src/dashboard.tsx", summary: "+layout", updated_at: new Date().toISOString() },
    ];
    saveWorker(w2);

    // jimin joins with a separate session
    const task3 = createTask("User profiles", "jimin");
    const session3 = createSession("jimin", task3.id);
    const w3 = createWorker("jimin", "linux-desktop", task3.id, session3.session_id);
    w3.status = "working";
    w3.files_touched = [
      { path: "src/users.ts", summary: "+CRUD", updated_at: new Date().toISOString() },
    ];
    saveWorker(w3);

    // jimin sees both of stefano's sessions
    const ctx3 = generateContext(session3.session_id, "text");
    expect(ctx3).toContain("Auth");
    expect(ctx3).toContain("Dashboard");
    expect(ctx3).toContain("src/auth.ts");
    expect(ctx3).toContain("src/dashboard.tsx");

    // stefano session 1 sees jimin AND stefano's other session
    const ctx1 = generateContext(session1.session_id, "text");
    expect(ctx1).toContain("Dashboard");
    expect(ctx1).toContain("User profiles");
    expect(ctx1).toContain("jimin");
  });

  it("Step 7: Stopping one session doesn't affect the other", () => {
    const task1 = createTask("Auth", USER);
    const session1 = createSession(USER, task1.id);
    createWorker(USER, MACHINE, task1.id, session1.session_id);

    const task2 = createTask("Dashboard", USER);
    const session2 = createSession(USER, task2.id);
    createWorker(USER, MACHINE, task2.id, session2.session_id);

    // Stop session 1 (simulates ctxflow stop)
    const w1 = getWorker(session1.session_id)!;
    const participants1 = getTaskParticipants(w1.task_id!);
    const othersActive1 = participants1.some(
      (p) => p.session_id !== session1.session_id &&
        (p.status === "working" || p.status === "idle"),
    );
    if (!othersActive1) {
      updateTaskStatus(w1.task_id!, "done");
    }
    w1.status = "disconnected";
    w1.task_id = null;
    saveWorker(w1);
    removeSession(session1.session_id);

    // Session 1's task is done (no other participants)
    expect(getTask(task1.id)!.status).toBe("done");

    // Session 2 is still working
    const w2 = getWorker(session2.session_id)!;
    expect(w2.status).toBe("working");
    expect(w2.task_id).toBe(task2.id);
    expect(getTask(task2.id)!.status).toBe("active");

    // Only one session remains
    expect(listSessions()).toHaveLength(1);
  });

  it("Step 8: Full lifecycle — start, work, conflict, resolve, stop", () => {
    // === Phase 1: Start ===
    const taskAuth = createTask("JWT authentication", USER);
    const sessAuth = createSession(USER, taskAuth.id);
    const wAuth = createWorker(USER, MACHINE, taskAuth.id, sessAuth.session_id);
    wAuth.status = "working";
    saveWorker(wAuth);

    const taskDash = createTask("Admin dashboard", USER);
    const sessDash = createSession(USER, taskDash.id);
    const wDash = createWorker(USER, MACHINE, taskDash.id, sessDash.session_id);
    wDash.status = "working";
    saveWorker(wDash);

    expect(listWorkers().filter((w) => w.status === "working")).toHaveLength(2);

    // === Phase 2: Independent work ===
    addFileChange(sessAuth.session_id, "src/auth/jwt.ts", "+token verify");
    addFileChange(sessAuth.session_id, "src/auth/refresh.ts", "+refresh tokens");
    addFileChange(sessDash.session_id, "src/dashboard/stats.tsx", "+stat cards");
    addFileChange(sessDash.session_id, "src/dashboard/charts.tsx", "+chart components");

    // No conflicts yet
    let conflicts = detectConflicts(listWorkers());
    expect(conflicts).toHaveLength(0);

    // Context shows each other's work
    let ctxAuth = generateContext(sessAuth.session_id, "text");
    expect(ctxAuth).toContain("Admin dashboard");

    // === Phase 3: Conflict arises ===
    addFileChange(sessAuth.session_id, "src/api/routes.ts", "+auth routes");
    addFileChange(sessDash.session_id, "src/api/routes.ts", "+dashboard routes");

    conflicts = detectConflicts(listWorkers());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].file).toBe("src/api/routes.ts");

    // Both sessions get conflict warning
    ctxAuth = generateContext(sessAuth.session_id, "text");
    expect(ctxAuth).toContain("conflict");
    expect(ctxAuth).toContain("src/api/routes.ts");

    const ctxDash = generateContext(sessDash.session_id, "text");
    expect(ctxDash).toContain("conflict");
    expect(ctxDash).toContain("src/api/routes.ts");

    // === Phase 4: Auth session finishes ===
    const wAuth2 = getWorker(sessAuth.session_id)!;
    wAuth2.status = "disconnected";
    wAuth2.task_id = null;
    saveWorker(wAuth2);
    updateTaskStatus(taskAuth.id, "done");
    removeSession(sessAuth.session_id);

    // Dashboard session continues unaffected
    const ctxDashAfter = generateContext(sessDash.session_id, "text");
    // No more conflict (auth session disconnected)
    expect(ctxDashAfter).toBe("");

    // === Phase 5: Dashboard session finishes ===
    const wDash2 = getWorker(sessDash.session_id)!;
    wDash2.status = "disconnected";
    wDash2.task_id = null;
    saveWorker(wDash2);
    updateTaskStatus(taskDash.id, "done");
    removeSession(sessDash.session_id);

    // All done
    expect(listSessions()).toHaveLength(0);
    expect(listWorkers().filter((w) => w.status === "working")).toHaveLength(0);
  });
});
