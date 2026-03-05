/**
 * Validate that a resolved path is inside the expected parent directory.
 * Prevents symlink and traversal attacks.
 */
export declare function assertPathInside(filePath: string, parentDir: string): void;
/**
 * Safe file write: validates the target is inside its expected directory before writing.
 */
export declare function safeWriteFile(filePath: string, parentDir: string, data: string): void;
export declare function setProjectRoot(root: string): void;
export declare function getProjectRoot(): string;
export declare function ctxflowDir(): string;
export declare function tasksDir(): string;
export declare function workersDir(): string;
export declare function contextDir(): string;
export declare function sessionsDir(): string;
export declare function lockDir(): string;
export declare function workerFile(sessionId: string): string;
export declare function taskFile(id: string): string;
export declare function contextFile(sessionId: string): string;
export declare function sessionFile(sessionId: string): string;
export declare function daemonPidFile(): string;
export declare function daemonLockFile(): string;
export declare function ensureDirs(): void;
