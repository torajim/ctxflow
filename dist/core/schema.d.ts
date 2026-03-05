import { z } from "zod";
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    created_by: z.ZodString;
    created_at: z.ZodString;
    status: z.ZodEnum<["active", "done"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    description: string;
    created_by: string;
    created_at: string;
    status: "active" | "done";
}, {
    id: string;
    description: string;
    created_by: string;
    created_at: string;
    status: "active" | "done";
}>;
export type Task = z.infer<typeof TaskSchema>;
export declare const FileChangeSchema: z.ZodObject<{
    path: z.ZodString;
    summary: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    summary: string;
    updated_at: string;
}, {
    path: string;
    summary: string;
    updated_at: string;
}>;
export type FileChange = z.infer<typeof FileChangeSchema>;
export declare const WorkerSchema: z.ZodObject<{
    name: z.ZodString;
    machine: z.ZodString;
    task_id: z.ZodNullable<z.ZodString>;
    joined_at: z.ZodString;
    last_heartbeat: z.ZodString;
    status: z.ZodEnum<["working", "idle", "disconnected"]>;
    files_touched: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        summary: z.ZodString;
        updated_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        summary: string;
        updated_at: string;
    }, {
        path: string;
        summary: string;
        updated_at: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "working" | "idle" | "disconnected";
    name: string;
    machine: string;
    task_id: string | null;
    joined_at: string;
    last_heartbeat: string;
    files_touched: {
        path: string;
        summary: string;
        updated_at: string;
    }[];
}, {
    status: "working" | "idle" | "disconnected";
    name: string;
    machine: string;
    task_id: string | null;
    joined_at: string;
    last_heartbeat: string;
    files_touched: {
        path: string;
        summary: string;
        updated_at: string;
    }[];
}>;
export type Worker = z.infer<typeof WorkerSchema>;
export declare const MeSchema: z.ZodObject<{
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
}, {
    name: string;
}>;
export type Me = z.infer<typeof MeSchema>;
export interface Conflict {
    file: string;
    workers: string[];
}
