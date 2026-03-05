export declare function hasGitRemote(): Promise<boolean>;
export declare function getRemoteUrl(): Promise<string | null>;
export declare function ensureCtxflowBranch(): Promise<void>;
export declare function syncPush(workerName: string, maxRetries?: number): Promise<void>;
export declare function syncPull(): Promise<void>;
export declare function fullSync(workerName: string): Promise<void>;
