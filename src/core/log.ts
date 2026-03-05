import fs from "node:fs";
import path from "node:path";
import { ctxflowDir } from "./paths.js";

export function logDebug(message: string): void {
  try {
    const logPath = path.join(ctxflowDir(), "debug.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch {
    // Logging should never break the app
  }
}
