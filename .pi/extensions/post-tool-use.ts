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

import * as path from "path";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { appendJsonLog, ensureSessionLogDir } from "./utils/constants";

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
