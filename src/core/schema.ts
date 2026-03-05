import { z } from "zod";

// --- Task Schema ---
export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  created_by: z.string(),
  created_at: z.string().datetime(),
  status: z.enum(["active", "done"]),
});
export type Task = z.infer<typeof TaskSchema>;

// --- File Change Schema ---
export const FileChangeSchema = z.object({
  path: z.string(),
  summary: z.string(),
  updated_at: z.string().datetime(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

// --- Worker Schema ---
export const WorkerSchema = z.object({
  name: z.string(),
  session_id: z.string(),
  machine: z.string(),
  task_id: z.string().nullable(),
  joined_at: z.string().datetime(),
  last_heartbeat: z.string().datetime(),
  status: z.enum(["working", "idle", "disconnected"]),
  files_touched: z.array(FileChangeSchema),
});
export type Worker = z.infer<typeof WorkerSchema>;

// --- Session Schema ---
export const SessionSchema = z.object({
  session_id: z.string(),
  name: z.string(),
  task_id: z.string(),
  daemon_pid: z.number().nullable(),
  created_at: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

// --- Conflict ---
export interface Conflict {
  file: string;
  workers: string[];
}
