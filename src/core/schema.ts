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
  machine: z.string(),
  task_id: z.string().nullable(),
  joined_at: z.string().datetime(),
  last_heartbeat: z.string().datetime(),
  status: z.enum(["working", "idle", "disconnected"]),
  files_touched: z.array(FileChangeSchema),
});
export type Worker = z.infer<typeof WorkerSchema>;

// --- Local Identity ---
export const MeSchema = z.object({
  name: z.string(),
});
export type Me = z.infer<typeof MeSchema>;

// --- Conflict ---
export interface Conflict {
  file: string;
  workers: string[];
}
