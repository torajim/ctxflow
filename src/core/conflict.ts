import type { Worker } from "./schema.js";
import type { Conflict } from "./schema.js";

export function detectConflicts(workers: Worker[]): Conflict[] {
  const activeWorkers = workers.filter((w) => w.status === "working");
  const fileMap = new Map<string, string[]>();

  for (const worker of activeWorkers) {
    for (const file of worker.files_touched) {
      const existing = fileMap.get(file.path);
      if (existing) {
        existing.push(worker.session_id);
      } else {
        fileMap.set(file.path, [worker.session_id]);
      }
    }
  }

  const conflicts: Conflict[] = [];
  for (const [file, workerSessionIds] of fileMap) {
    if (workerSessionIds.length > 1) {
      conflicts.push({ file, workers: workerSessionIds });
    }
  }

  return conflicts;
}
