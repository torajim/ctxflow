import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setProjectRoot, ensureDirs, contextFile } from "../../src/core/paths.js";
import { createWorker, saveWorker, createTask } from "../../src/core/task.js";
import { generateContext } from "../../src/core/context.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxflow-ctx-test-"));
  setProjectRoot(tmpDir);
  ensureDirs();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateContext", () => {
  it("returns empty string when no other workers", () => {
    createWorker("stefano", "mac", "t1");
    expect(generateContext("stefano", "text")).toBe("");
  });

  it("returns empty string when only disconnected workers exist", () => {
    const w1 = createWorker("stefano", "mac1", "t1");
    w1.status = "working";
    saveWorker(w1);

    const w2 = createWorker("jimin", "mac2", "t1");
    w2.status = "disconnected";
    saveWorker(w2);

    expect(generateContext("stefano", "text")).toBe("");
  });

  it("shows other active workers in text format", () => {
    const task = createTask("JWT 인증 구현", "stefano");

    const w1 = createWorker("stefano", "mac1", task.id);
    w1.status = "working";
    saveWorker(w1);

    const w2 = createWorker("jimin", "mac2", task.id);
    w2.status = "working";
    w2.files_touched = [
      { path: "src/users.ts", summary: "+CRUD endpoints", updated_at: new Date().toISOString() },
    ];
    saveWorker(w2);

    const result = generateContext("stefano", "text");
    expect(result).toContain("[ctxflow] 협업 상태:");
    expect(result).toContain("jimin");
    expect(result).toContain("JWT 인증 구현");
    expect(result).toContain("src/users.ts");
    expect(result).toContain(".ctxflow/context/stefano.md");
    expect(result).not.toContain("stefano:");
  });

  it("wraps in system-reminder for hook format", () => {
    const task = createTask("작업", "a");

    const w1 = createWorker("stefano", "mac1", task.id);
    w1.status = "working";
    saveWorker(w1);

    const w2 = createWorker("jimin", "mac2", task.id);
    w2.status = "working";
    saveWorker(w2);

    const result = generateContext("stefano", "hook");
    expect(result).toMatch(/^<system-reminder>/);
    expect(result).toMatch(/<\/system-reminder>$/);
    expect(result).toContain("[ctxflow]");
  });

  it("includes context file content in summary", () => {
    const task = createTask("API 구현", "jimin");

    const w1 = createWorker("stefano", "mac1", task.id);
    w1.status = "working";
    saveWorker(w1);

    const w2 = createWorker("jimin", "mac2", task.id);
    w2.status = "working";
    saveWorker(w2);

    // Write jimin's context file
    fs.writeFileSync(
      contextFile("jimin"),
      "Drizzle ORM 사용, REST 패턴으로 구현 중\n상세한 두 번째 줄\n세 번째 줄",
    );

    const result = generateContext("stefano", "text");
    expect(result).toContain("Drizzle ORM");
  });

  it("shows conflict warning when files overlap", () => {
    const task = createTask("공유 작업", "stefano");

    const w1 = createWorker("stefano", "mac1", task.id);
    w1.status = "working";
    w1.files_touched = [
      { path: "src/types.ts", summary: "+AuthUser type", updated_at: new Date().toISOString() },
    ];
    saveWorker(w1);

    const w2 = createWorker("jimin", "mac2", task.id);
    w2.status = "working";
    w2.files_touched = [
      { path: "src/types.ts", summary: "+UserProfile type", updated_at: new Date().toISOString() },
    ];
    saveWorker(w2);

    const result = generateContext("stefano", "text");
    expect(result).toContain("충돌");
    expect(result).toContain("src/types.ts");
  });

  it("handles 5+ workers with conflict filtering", () => {
    const task = createTask("대규모 작업", "lead");

    // Create "me"
    const me = createWorker("me", "mac0", task.id);
    me.status = "working";
    me.files_touched = [
      { path: "src/shared.ts", summary: "+shared", updated_at: new Date().toISOString() },
    ];
    saveWorker(me);

    // Create 6 other workers (to trigger 5+ mode)
    for (let i = 1; i <= 6; i++) {
      const w = createWorker(`worker${i}`, `mac${i}`, task.id);
      w.status = "working";
      if (i === 1) {
        // worker1 conflicts with "me" on src/shared.ts
        w.files_touched = [
          { path: "src/shared.ts", summary: "+conflict", updated_at: new Date().toISOString() },
        ];
      } else {
        w.files_touched = [
          { path: `src/module${i}.ts`, summary: `+module${i}`, updated_at: new Date().toISOString() },
        ];
      }
      saveWorker(w);
    }

    const result = generateContext("me", "text");
    expect(result).toContain("[ctxflow] 협업 상태:");
    // worker1 should be shown in detail (conflict)
    expect(result).toContain("worker1");
    // Others should be summarized
    expect(result).toContain("외");
    expect(result).toContain("작업 중");
  });

  it("includes LLM instruction for context file update", () => {
    const task = createTask("작업", "a");
    const w1 = createWorker("stefano", "mac1", task.id);
    w1.status = "working";
    saveWorker(w1);
    const w2 = createWorker("jimin", "mac2", task.id);
    w2.status = "working";
    saveWorker(w2);

    const result = generateContext("stefano", "text");
    expect(result).toContain("접근 방식 변경 시");
    expect(result).toContain(".ctxflow/context/stefano.md");
  });
});
