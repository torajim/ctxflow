const DEFAULT_CONFLICT_WINDOW_MS = 2 * 60 * 60 * 1000;
/**
 * Two live workers touching the same file is a conflict.
 *
 * "idle" counts as live: the Stop hook marks a worker idle after every Claude
 * turn, while its uncommitted edits are still there. Only edits within the
 * window count, so a file touched hours ago no longer warns forever.
 */
export function detectConflicts(workers, windowMs = DEFAULT_CONFLICT_WINDOW_MS, now = Date.now()) {
    const liveWorkers = workers.filter((w) => w.status === "working" || w.status === "idle");
    const fileMap = new Map();
    for (const worker of liveWorkers) {
        for (const file of worker.files_touched) {
            if (now - new Date(file.updated_at).getTime() > windowMs)
                continue;
            const existing = fileMap.get(file.path);
            if (existing) {
                existing.push(worker.session_id);
            }
            else {
                fileMap.set(file.path, [worker.session_id]);
            }
        }
    }
    const conflicts = [];
    for (const [file, workerSessionIds] of fileMap) {
        if (workerSessionIds.length > 1) {
            conflicts.push({ file, workers: workerSessionIds });
        }
    }
    return conflicts;
}
//# sourceMappingURL=conflict.js.map