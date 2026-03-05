/**
 * Acquire an exclusive lock using mkdir (atomic on all platforms).
 * Returns a release function.
 */
export declare function acquireLock(name: string): () => void;
/**
 * Execute a function while holding a lock.
 */
export declare function withLock<T>(name: string, fn: () => T): T;
