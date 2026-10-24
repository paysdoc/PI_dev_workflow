/**
 * Shared machinery for a skill that ends by calling a report tool instead of
 * printing raw JSON. The schema is the single source of truth for the report:
 *   - pi validates the arguments against it before `execute()` runs, and sends
 *     validation errors back to the model as a failed tool call, so the model
 *     retries in the same session;
 *   - providers that support strict tools also use it for constrained sampling;
 *   - `check` covers the rules a schema cannot express;
 *   - the orchestrator reads the accepted report from the tool result's
 *     `details` / `structuredContent`.
 *
 * Scope: the tool is registered inactive. It becomes active only in a session
 * whose prompt is the expanded `/skill:<skillName>` block, so no other skill or
 * interactive session sees it. If such a run ends without an accepted report,
 * the extension asks for one, at most `maxReminders` times.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { isSkillPrompt, userText } from "./skillSession";

export const DEFAULT_MAX_REMINDERS = 2;

export interface SkillReportOptions<TReport extends TSchema> {
	readonly skillName: string;
	readonly toolName: string;
	readonly label: string;
	readonly description: string;
	readonly promptSnippet: string;
	readonly schema: TReport;
	/** Rules the schema cannot express. Returns one message per violation. */
	readonly check: (report: Static<TReport>, cwd: string) => string[];
	/** `customType` of the reminder message. */
	readonly reminderType: string;
	readonly reminderText: string;
	readonly maxReminders?: number;
}

function isAcceptedReport(entry: SessionEntry, toolName: string): boolean {
	return (
		entry.type === "message" &&
		entry.message.role === "toolResult" &&
		entry.message.toolName === toolName &&
		!entry.message.isError
	);
}

export function registerSkillReport<TReport extends TSchema>(pi: ExtensionAPI, options: SkillReportOptions<TReport>): void {
	const { skillName, toolName } = options;
	const maxReminders = options.maxReminders ?? DEFAULT_MAX_REMINDERS;

	// Per-session state. Rebuilt from the branch on session_start (resume, reload).
	let skillActive = false;
	let reported = false;
	let reminders = 0;

	const activate = () => {
		const active = pi.getActiveTools();
		if (!active.includes(toolName)) pi.setActiveTools([...active, toolName]);
	};

	pi.registerTool({
		name: toolName,
		label: options.label,
		description: options.description,
		promptSnippet: options.promptSnippet,
		parameters: options.schema,
		outputSchema: options.schema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		defaultActive: false,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const errors = options.check(params, ctx.cwd);
			if (errors.length > 0) {
				throw new Error(`Report rejected. Fix these and call ${toolName} again:\n- ${errors.join("\n- ")}`);
			}
			reported = true;
			return {
				content: [{ type: "text", text: "Report accepted." }],
				details: params,
				structuredContent: params,
				terminate: true,
			};
		},
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		skillActive = false;
		reported = false;
		reminders = 0;
		for (const entry of ctx.sessionManager.getBranch()) {
			const text = userText(entry);
			if (text !== undefined && isSkillPrompt(text, skillName)) {
				skillActive = true;
				reported = false;
			} else if (skillActive && isAcceptedReport(entry, toolName)) {
				reported = true;
			}
		}
		if (skillActive) activate();
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType !== "user" || !isSkillPrompt(event.prompt, skillName)) return;
		skillActive = true;
		reported = false;
		reminders = 0;
		activate();
	});

	pi.on("agent_before_settle", (event) => {
		if (!skillActive || reported || event.outcome !== "completed") return;
		// Do not check event.context.canContinue here: it previews the context
		// without the reminder below, so it is false after a plain text reply.
		if (reminders >= maxReminders) return;
		reminders++;
		return {
			entries: [{ type: "custom_message", customType: options.reminderType, content: options.reminderText, display: true }],
			continue: true,
		};
	});
}
