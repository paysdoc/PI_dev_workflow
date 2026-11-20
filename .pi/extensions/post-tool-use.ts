/**
 * Post-Tool-Use Extension
 *
 * Runs after every tool executes and appends the result event to
 * `.pi/logs/<session_id>/post_tool_use.json`. Replaces the earlier
 * Claude-Code-style stdin hook; pi dispatches these in-process via
 * `pi.on("tool_result", ...)`.
 *
 * This handler is observational only — it never modifies the result.
 */

import * as fs from "fs";
import * as path from "path";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";

const LOG_ROOT = path.resolve(process.env.PI_PROJECT_LOG_DIR ?? path.join(process.cwd(), ".pi", "logs"));

/** The log directory for the session id, created if missing; "unknown" when there is no id. */
function ensureSessionLogDir(sessionId: string | undefined | null): string {
	const safeId = (sessionId && String(sessionId).trim()) || "unknown";
	const dir = path.join(LOG_ROOT, safeId.replace(/[^A-Za-z0-9._-]/g, "_"));
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** Appends an entry to a JSON-array log file, starting fresh if the file is missing or corrupt. */
function appendJsonLog(logPath: string, entry: unknown): void {
	let logData: unknown[] = [];
	try {
		const parsed = JSON.parse(fs.readFileSync(logPath, "utf-8"));
		if (Array.isArray(parsed)) logData = parsed;
	} catch {
		logData = [];
	}
	logData.push(entry);
	fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event: ToolResultEvent, ctx): Promise<undefined> => {
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			const logDir = ensureSessionLogDir(sessionId);
			appendJsonLog(path.join(logDir, "post_tool_use.json"), {
				timestamp: new Date().toISOString(),
				session_id: sessionId,
				tool_call_id: event.toolCallId,
				parent_tool_call_id: event.parentToolCallId,
				tool_name: event.toolName,
				tool_input: event.input,
				is_error: event.isError,
				content: event.content,
				structured_content: event.structuredContent,
				usage: event.usage,
			});
		} catch {
			// Logging must never affect agent behavior.
		}
		return undefined;
	});
}
