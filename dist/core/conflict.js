export function detectConflicts(workers) {
    const activeWorkers = workers.filter((w) => w.status === "working");
    const fileMap = new Map();
    for (const worker of activeWorkers) {
        for (const file of worker.files_touched) {
            const existing = fileMap.get(file.path);
            if (existing) {
                existing.push(worker.name);
            }
            else {
                fileMap.set(file.path, [worker.name]);
            }
        }
    }
    const conflicts = [];
    for (const [file, workerNames] of fileMap) {
        if (workerNames.length > 1) {
            conflicts.push({ file, workers: workerNames });
        }
    }
    return conflicts;
}
//# sourceMappingURL=conflict.js.map