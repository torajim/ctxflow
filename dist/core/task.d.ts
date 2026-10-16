import { type Task, type Worker, type Session } from "./schema.js";
export declare function getMe(): string | null;
export declare function createSession(name: string, taskId: string, daemonPid?: number | null): Session;
export declare function getSession(sessionId: string): Session | null;
export declare function updateSessionDaemonPid(sessionId: string, pid: number): void;
export declare function listSessions(): Session[];
export declare function removeSession(sessionId: string): void;
/** Bind a Claude Code session to a ctxflow session (overwrites any previous binding). */
export declare function bindClaudeSession(claudeSessionId: string, sessionId: string): void;
export declare function removeBindingsFor(sessionId: string): void;
/**
 * Resolve which ctxflow session the caller belongs to.
 *
 * Several terminals can share one project directory, so the project-wide
 * current-session file alone is ambiguous. Order:
 * 1. CTXFLOW_SESSION env var (explicit)
 * 2. Hooks pass the Claude Code session ID: use its binding, or claim the
 *    current-session file if no other Claude session has claimed it yet.
 * 3. CLI commands run inside Claude's Bash tool: the binding of
 *    CLAUDE_CODE_SESSION_ID, read-only.
 * 4. Otherwise: the current-session file.
 */
export declare function getCurrentSessionId(claudeSessionId?: string | null): string | null;
export declare function writeCurrentSession(sessionId: string): void;
export declare function clearCurrentSession(sessionId: string): void;
export declare function getCurrentSession(): Session | null;
export declare function createTask(description: string, createdBy: string): Task;
export declare function getTask(id: string): Task | null;
export declare function listTasks(): Task[];
export declare function updateTaskStatus(id: string, status: "active" | "done"): Task | null;
export declare function getWorker(sessionId: string): Worker | null;
export declare function listWorkers(): Worker[];
export declare function saveWorker(worker: Worker): void;
export declare function createWorker(name: string, machine: string, taskId: string, sessionId: string): Worker;
/**
 * Refresh the worker's heartbeat. With minIntervalMs, a heartbeat that is still that
 * fresh is left alone, so an otherwise unchanged worker does not create a sync commit
 * on every daemon tick.
 */
export declare function updateHeartbeat(sessionId: string, minIntervalMs?: number): void;
export declare function addFileChange(sessionId: string, filePath: string, summary: string): void;
export declare function getTaskParticipants(taskId: string): Worker[];
export declare function getActiveWorkers(): Worker[];
