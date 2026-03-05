export interface CtxflowConfig {
    syncIntervalMs: number;
    inactiveThresholdMs: number;
    maxFilesTouched: number;
    maxLogSize: number;
    pushMaxRetries: number;
    pushRetryBaseMs: number;
}
export declare function loadConfig(): CtxflowConfig;
export declare function resetConfigCache(): void;
