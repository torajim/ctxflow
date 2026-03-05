import fs from "node:fs";
import { listWorkers, getTask } from "./task.js";
import { detectConflicts } from "./conflict.js";
import { contextFile } from "./paths.js";
function readContextFile(sessionId) {
    try {
        return fs.readFileSync(contextFile(sessionId), "utf-8");
    }
    catch {
        return null;
    }
}
function summaryLines(content, maxLines = 3) {
    return content.split("\n").slice(0, maxLines).join("\n").trim();
}
function formatFileChanges(worker) {
    if (worker.files_touched.length === 0)
        return "";
    const items = worker.files_touched
        .slice(-5)
        .map((f) => `${f.path} (${f.summary})`)
        .join(", ");
    return `  recent: ${items}`;
}
function isConflicting(sessionId, conflicts) {
    return conflicts.some((c) => c.workers.includes(sessionId));
}
function displayLabel(worker) {
    return worker.name;
}
function formatWorkerSummary(worker, taskDesc, contextContent) {
    const approach = contextContent ? summaryLines(contextContent) : "";
    const desc = taskDesc ?? "(no task)";
    let line = `- ${displayLabel(worker)}: "${desc}"`;
    if (approach)
        line += ` | ${approach}`;
    const files = formatFileChanges(worker);
    if (files)
        line += `\n${files}`;
    return line;
}
function formatWorkerDetailed(worker, taskDesc, contextContent, workerConflicts, workerMap) {
    const desc = taskDesc ?? "(no task)";
    const lines = [];
    lines.push(`- ${displayLabel(worker)}: "${desc}"`);
    if (contextContent) {
        lines.push(`  approach:\n${contextContent.split("\n").map((l) => `    ${l}`).join("\n")}`);
    }
    const files = formatFileChanges(worker);
    if (files)
        lines.push(files);
    for (const c of workerConflicts) {
        const workerNames = c.workers.map((sid) => {
            const w = workerMap.get(sid);
            return w ? displayLabel(w) : sid;
        });
        lines.push(`  ⚠ conflict: ${c.file} (${workerNames.join(", ")})`);
    }
    return lines.join("\n");
}
export function generateContext(mySessionId, format) {
    const allWorkers = listWorkers();
    // Build lookup map for display name resolution
    const workerMap = new Map(allWorkers.map((w) => [w.session_id, w]));
    const otherWorkers = allWorkers.filter((w) => w.session_id !== mySessionId &&
        (w.status === "working" || w.status === "idle"));
    if (otherWorkers.length === 0)
        return "";
    // Use session_id for conflict detection keys
    const conflicts = detectConflicts(allWorkers);
    const hasConflicts = conflicts.length > 0;
    const manyWorkers = otherWorkers.length >= 5;
    const sections = [];
    sections.push("[ctxflow] collaboration status:");
    if (manyWorkers && hasConflicts) {
        const conflictingSessions = new Set(conflicts.flatMap((c) => c.workers));
        const conflictingWorkers = otherWorkers.filter((w) => conflictingSessions.has(w.session_id));
        const otherCount = otherWorkers.length - conflictingWorkers.length;
        for (const worker of conflictingWorkers) {
            const task = worker.task_id ? getTask(worker.task_id) : null;
            const ctx = readContextFile(worker.session_id);
            const workerConflicts = conflicts.filter((c) => c.workers.includes(worker.session_id));
            sections.push(formatWorkerDetailed(worker, task?.description ?? null, ctx, workerConflicts, workerMap));
        }
        if (otherCount > 0) {
            sections.push(`and ${otherCount} more working (no conflicts)`);
        }
    }
    else {
        for (const worker of otherWorkers) {
            const task = worker.task_id ? getTask(worker.task_id) : null;
            const ctx = readContextFile(worker.session_id);
            if (hasConflicts && isConflicting(worker.session_id, conflicts)) {
                const workerConflicts = conflicts.filter((c) => c.workers.includes(worker.session_id));
                sections.push(formatWorkerDetailed(worker, task?.description ?? null, ctx, workerConflicts, workerMap));
            }
            else {
                sections.push(formatWorkerSummary(worker, task?.description ?? null, ctx));
            }
        }
    }
    // Determine display name for the instruction
    const myName = mySessionId
        ? (workerMap.get(mySessionId)?.name ?? "unknown")
        : "unknown";
    sections.push("");
    sections.push(`[ctxflow] When making key architectural decisions or changing your approach,\nplease update .ctxflow/context/${mySessionId ?? myName}.md with a brief summary.`);
    const body = sections.join("\n");
    if (format === "hook") {
        return `<system-reminder>\n${body}\n</system-reminder>`;
    }
    return body;
}
//# sourceMappingURL=context.js.map