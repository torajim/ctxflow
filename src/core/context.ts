import fs from "node:fs";
import { listWorkers, getTask } from "./task.js";
import { detectConflicts } from "./conflict.js";
import { contextFile } from "./paths.js";
import type { Worker, Conflict } from "./schema.js";

function readContextFile(name: string): string | null {
  try {
    return fs.readFileSync(contextFile(name), "utf-8");
  } catch {
    return null;
  }
}

function summaryLines(content: string, maxLines = 3): string {
  return content.split("\n").slice(0, maxLines).join("\n").trim();
}

function formatFileChanges(worker: Worker): string {
  if (worker.files_touched.length === 0) return "";
  const items = worker.files_touched
    .slice(-5)
    .map((f) => `${f.path} (+${f.summary})`)
    .join(", ");
  return `  최근: ${items}`;
}

function isConflicting(workerName: string, conflicts: Conflict[]): boolean {
  return conflicts.some((c) => c.workers.includes(workerName));
}

function formatWorkerSummary(
  worker: Worker,
  taskDesc: string | null,
  contextContent: string | null,
): string {
  const approach = contextContent ? summaryLines(contextContent) : "";
  const desc = taskDesc ?? "(no task)";
  let line = `- ${worker.name}: "${desc}"`;
  if (approach) line += ` | ${approach}`;
  const files = formatFileChanges(worker);
  if (files) line += `\n${files}`;
  return line;
}

function formatWorkerDetailed(
  worker: Worker,
  taskDesc: string | null,
  contextContent: string | null,
  workerConflicts: Conflict[],
): string {
  const desc = taskDesc ?? "(no task)";
  const lines: string[] = [];
  lines.push(`- ${worker.name}: "${desc}"`);
  if (contextContent) {
    lines.push(`  접근 방식:\n${contextContent.split("\n").map((l) => `    ${l}`).join("\n")}`);
  }
  const files = formatFileChanges(worker);
  if (files) lines.push(files);
  for (const c of workerConflicts) {
    lines.push(`  ⚠ 충돌: ${c.file} (${c.workers.join(", ")})`);
  }
  return lines.join("\n");
}

export function generateContext(
  myName: string,
  format: "hook" | "text",
): string {
  const allWorkers = listWorkers();
  const otherWorkers = allWorkers.filter(
    (w) =>
      w.name !== myName && (w.status === "working" || w.status === "idle"),
  );

  if (otherWorkers.length === 0) return "";

  const conflicts = detectConflicts(allWorkers);
  const hasConflicts = conflicts.length > 0;
  const manyWorkers = otherWorkers.length >= 5;

  const sections: string[] = [];
  sections.push("[ctxflow] 협업 상태:");

  if (manyWorkers && hasConflicts) {
    // Show detailed only for conflicting workers, summarize rest
    const conflictingNames = new Set(conflicts.flatMap((c) => c.workers));
    const conflictingWorkers = otherWorkers.filter((w) =>
      conflictingNames.has(w.name),
    );
    const otherCount = otherWorkers.length - conflictingWorkers.length;

    for (const worker of conflictingWorkers) {
      const task = worker.task_id ? getTask(worker.task_id) : null;
      const ctx = readContextFile(worker.name);
      const workerConflicts = conflicts.filter((c) =>
        c.workers.includes(worker.name),
      );
      sections.push(
        formatWorkerDetailed(
          worker,
          task?.description ?? null,
          ctx,
          workerConflicts,
        ),
      );
    }

    if (otherCount > 0) {
      sections.push(`외 ${otherCount}명 작업 중 (충돌 없음)`);
    }
  } else {
    for (const worker of otherWorkers) {
      const task = worker.task_id ? getTask(worker.task_id) : null;
      const ctx = readContextFile(worker.name);

      if (hasConflicts && isConflicting(worker.name, conflicts)) {
        const workerConflicts = conflicts.filter((c) =>
          c.workers.includes(worker.name),
        );
        sections.push(
          formatWorkerDetailed(
            worker,
            task?.description ?? null,
            ctx,
            workerConflicts,
          ),
        );
      } else {
        sections.push(
          formatWorkerSummary(worker, task?.description ?? null, ctx),
        );
      }
    }
  }

  sections.push("");
  sections.push(
    `[ctxflow] 주요 아키텍처 결정이나 접근 방식 변경 시,\n.ctxflow/context/${myName}.md 파일에 현재 접근 방식을 간단히 기록해주세요.`,
  );

  const body = sections.join("\n");

  if (format === "hook") {
    return `<system-reminder>\n${body}\n</system-reminder>`;
  }

  return body;
}
