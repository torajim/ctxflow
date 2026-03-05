import { describe, it, expect } from "vitest";
import { detectConflicts } from "../../src/core/conflict.js";
import type { Worker } from "../../src/core/schema.js";

function makeWorker(
  name: string,
  files: string[],
  status: "working" | "idle" | "disconnected" = "working",
): Worker {
  return {
    name,
    machine: "test",
    task_id: "t1",
    joined_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    status,
    files_touched: files.map((f) => ({
      path: f,
      summary: `+modified ${f}`,
      updated_at: new Date().toISOString(),
    })),
  };
}

describe("detectConflicts", () => {
  it("returns empty when no overlapping files", () => {
    const workers = [
      makeWorker("stefano", ["src/auth.ts", "src/types.ts"]),
      makeWorker("jimin", ["src/users.ts", "src/db.ts"]),
    ];
    expect(detectConflicts(workers)).toEqual([]);
  });

  it("detects single file conflict between 2 workers", () => {
    const workers = [
      makeWorker("stefano", ["src/types.ts", "src/auth.ts"]),
      makeWorker("jimin", ["src/types.ts", "src/users.ts"]),
    ];
    const conflicts = detectConflicts(workers);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].file).toBe("src/types.ts");
    expect(conflicts[0].workers.sort()).toEqual(["jimin", "stefano"]);
  });

  it("detects multiple file conflicts", () => {
    const workers = [
      makeWorker("stefano", ["src/types.ts", "src/index.ts"]),
      makeWorker("jimin", ["src/types.ts", "src/index.ts"]),
    ];
    const conflicts = detectConflicts(workers);
    expect(conflicts).toHaveLength(2);
    const files = conflicts.map((c) => c.file).sort();
    expect(files).toEqual(["src/index.ts", "src/types.ts"]);
  });

  it("detects 3-way conflict", () => {
    const workers = [
      makeWorker("stefano", ["src/shared.ts"]),
      makeWorker("jimin", ["src/shared.ts"]),
      makeWorker("minho", ["src/shared.ts"]),
    ];
    const conflicts = detectConflicts(workers);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].workers.sort()).toEqual(["jimin", "minho", "stefano"]);
  });

  it("ignores disconnected workers", () => {
    const workers = [
      makeWorker("stefano", ["src/types.ts"], "working"),
      makeWorker("jimin", ["src/types.ts"], "disconnected"),
    ];
    expect(detectConflicts(workers)).toEqual([]);
  });

  it("ignores idle workers", () => {
    const workers = [
      makeWorker("stefano", ["src/types.ts"], "working"),
      makeWorker("jimin", ["src/types.ts"], "idle"),
    ];
    expect(detectConflicts(workers)).toEqual([]);
  });

  it("returns empty for empty worker list", () => {
    expect(detectConflicts([])).toEqual([]);
  });

  it("returns empty for single worker", () => {
    const workers = [makeWorker("stefano", ["src/a.ts", "src/b.ts"])];
    expect(detectConflicts(workers)).toEqual([]);
  });
});
