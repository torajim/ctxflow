import fs from "node:fs";
import path from "node:path";
import { ctxflowDir } from "./paths.js";
export function logDebug(message) {
    try {
        const logPath = path.join(ctxflowDir(), "debug.log");
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    }
    catch {
        // Logging should never break the app
    }
}
//# sourceMappingURL=log.js.map