import type { Worker } from "./schema.js";
import type { Conflict } from "./schema.js";
/**
 * Two live workers touching the same file is a conflict.
 *
 * "idle" counts as live: the Stop hook marks a worker idle after every Claude
 * turn, while its uncommitted edits are still there. Only edits within the
 * window count, so a file touched hours ago no longer warns forever.
 */
export declare function detectConflicts(workers: Worker[], windowMs?: number, now?: number): Conflict[];
