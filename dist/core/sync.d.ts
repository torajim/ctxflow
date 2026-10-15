export declare function isGitRepo(): Promise<boolean>;
export declare function initGitWithRemote(remoteUrl: string): Promise<void>;
export declare function hasGitRemote(): Promise<boolean>;
export declare function getRemoteUrl(): Promise<string | null>;
export declare function ensureCtxflowBranch(): Promise<void>;
export declare function syncPush(sessionIds: string[]): Promise<void>;
export declare function syncPull(sessionIds?: string[]): Promise<void>;
/** Commit local state, integrate teammates' changes, and push. */
export declare function fullSync(sessionIds: string[]): Promise<void>;
