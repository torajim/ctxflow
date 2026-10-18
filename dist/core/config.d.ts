export interface CtxflowConfig {
    syncIntervalMs: number;
    inactiveThresholdMs: number;
    maxFilesTouched: number;
    maxLogSize: number;
    pushMaxRetries: number;
    pushRetryBaseMs: number;
    /** Only edits newer than this count toward file conflicts. */
    conflictWindowMs: number;
    /** How often a worker's heartbeat is refreshed (and therefore committed). */
    heartbeatIntervalMs: number;
    /** Squash the shared ctxflow branch to one commit once it grows past this. */
    maxSyncCommits: number;
}
export declare function loadConfig(): CtxflowConfig;
export declare function resetConfigCache(): void;
