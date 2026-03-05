export declare function isGitRepo(): Promise<boolean>;
export declare function initGitWithRemote(remoteUrl: string): Promise<void>;
export declare function hasGitRemote(): Promise<boolean>;
export declare function getRemoteUrl(): Promise<string | null>;
export declare function ensureCtxflowBranch(): Promise<void>;
export declare function syncPush(sessionId: string): Promise<void>;
export declare function syncPull(): Promise<void>;
export declare function fullSync(sessionId: string): Promise<void>;
