/**
 * implement-tdd report tool
 *
 * The implement-tdd skill ends by calling `report_implementation` instead of
 * printing raw JSON. The schema below is the single source of truth for the
 * report:
 *   - pi validates the arguments against it before `execute()` runs, and sends
 *     validation errors back to the model as a failed tool call, so the model
 *     retries in the same session;
 *   - providers that support strict tools also use it for constrained sampling;
 *   - `execute()` checks the rules a schema cannot express;
 *   - the orchestrator reads the accepted report from the tool result's
 *     `details` / `structuredContent` and can use `ImplementationReport` as its type.
 *
 * Scope: the tool is registered inactive. It becomes active only in a session
 * whose prompt is the expanded `/skill:implement-tdd` block, so no other skill
 * or interactive session sees it. If an implement-tdd run ends without an
 * accepted report, the extension asks for one, at most MAX_REMINDERS times.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const TOOL_NAME = "report_implementation";
const SKILL_NAME = "implement-tdd";
const SKILL_PROMPT_PREFIX = `<skill name="${SKILL_NAME}"`;
const MAX_REMINDERS = 2;

// Keep the schema strict-mode compatible (no oneOf/allOf, no unions of objects,
// no minLength): providers fall back to non-strict sampling otherwise.
const NullableString = (description: string) => Type.Union([Type.String(), Type.Null()], { description });

export const UnitTestStatus = Type.Union(
	[
		Type.Literal("red-green"),
		Type.Literal("passed-before-implementation"),
		Type.Literal("blocked"),
		Type.Literal("skipped"),
	],
	{ description: "Outcome of the slice's unit test." },
);

export const Slice = Type.Object(
	{
		planTask: NullableString("The plan task this slice implements, verbatim. Null for a finding slice."),
		finding: NullableString("The finding's `detail` this slice handles. Null for a plan-task slice."),
		scenario: NullableString("The scenario attached to this slice. Null if no scenario covers it."),
		unitTest: UnitTestStatus,
		reason: NullableString(
			'Why the slice is blocked (required when unitTest is "blocked"), or "no upstream DSL". Otherwise null.',
		),
	},
	{ additionalProperties: false },
);

export const Failure = Type.Object(
	{
		scenario: Type.String({ description: "The scenario that is misaligned with the plan." }),
		planTask: NullableString("The conflicting plan task, or null if no plan task implements the scenario."),
		conflict: Type.String({ description: "What contradicts, or what is missing." }),
	},
	{ additionalProperties: false },
);

export const ImplementationReport = Type.Object(
	{
		tdd: Type.Boolean({ description: "False only when unit tests are off for this repository." }),
		slices: Type.Array(Slice, {
			description: "Plan-task slices in plan order, then finding slices in the order given.",
		}),
		failed: Type.Optional(Failure),
	},
	{ additionalProperties: false },
);

export type UnitTestStatus = Static<typeof UnitTestStatus>;
export type Slice = Static<typeof Slice>;
export type Failure = Static<typeof Failure>;
export type ImplementationReport = Static<typeof ImplementationReport>;

const isBlank = (value: string | null | undefined) => value == null || value.trim() === "";

/** Rules the schema cannot express. Returns one message per violation. */
export function checkReport(report: ImplementationReport): string[] {
	const errors: string[] = [];
	report.slices.forEach((slice, index) => {
		const at = `slices[${index}]`;
		const hasTask = !isBlank(slice.planTask);
		const hasFinding = !isBlank(slice.finding);
		if (hasTask === hasFinding) {
			errors.push(`${at}: set exactly one of planTask and finding; the other must be null.`);
		}
		if (slice.unitTest === "blocked" && isBlank(slice.reason)) {
			errors.push(`${at}: a blocked slice needs a reason.`);
		}
		if (!report.tdd && slice.unitTest !== "skipped") {
			errors.push(`${at}: unit tests are off (tdd: false), so unitTest must be "skipped".`);
		}
		if (report.tdd && hasTask && slice.unitTest === "skipped") {
			errors.push(`${at}: a plan-task slice cannot be "skipped" when tdd is true; only non-behaviour findings can.`);
		}
	});
	if (report.failed) {
		if (isBlank(report.failed.scenario)) errors.push("failed.scenario must name the scenario.");
		if (isBlank(report.failed.conflict)) errors.push("failed.conflict must describe the conflict.");
	}
	return errors;
}

function isSkillPrompt(text: string): boolean {
	return text.startsWith(SKILL_PROMPT_PREFIX);
}

function userText(entry: SessionEntry): string | undefined {
	if (entry.type !== "message" || entry.message.role !== "user") return undefined;
	const { content } = entry.message;
	if (typeof content === "string") return content;
	const first = content.find((part) => part.type === "text");
	return first && first.type === "text" ? first.text : undefined;
}

function isAcceptedReport(entry: SessionEntry): boolean {
	return (
		entry.type === "message" &&
		entry.message.role === "toolResult" &&
		entry.message.toolName === TOOL_NAME &&
		!entry.message.isError
	);
}

export default function (pi: ExtensionAPI) {
	// Per-session state. Rebuilt from the branch on session_start (resume, reload).
	let skillActive = false;
	let reported = false;
	let reminders = 0;

	const activate = () => {
		const active = pi.getActiveTools();
		if (!active.includes(TOOL_NAME)) pi.setActiveTools([...active, TOOL_NAME]);
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Report implementation",
		description:
			"Submit the final implement-tdd report. Call it exactly once, as your last action, after the last slice is committed. " +
			"If it returns an error, fix the report and call it again.",
		promptSnippet: "Submit the final implement-tdd report",
		parameters: ImplementationReport,
		outputSchema: ImplementationReport,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		defaultActive: false,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const errors = checkReport(params);
			if (errors.length > 0) {
				throw new Error(`Report rejected. Fix these and call ${TOOL_NAME} again:\n- ${errors.join("\n- ")}`);
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
			if (text !== undefined && isSkillPrompt(text)) {
				skillActive = true;
				reported = false;
			} else if (skillActive && isAcceptedReport(entry)) {
				reported = true;
			}
		}
		if (skillActive) activate();
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType !== "user" || !isSkillPrompt(event.prompt)) return;
		skillActive = true;
		reported = false;
		reminders = 0;
		activate();
	});

	pi.on("agent_before_settle", (event) => {
		if (!skillActive || reported || event.outcome !== "completed") return;
		// Do not check event.context.canContinue here: it previews the context
		// without the reminder below, so it is false after a plain text reply.
		if (reminders >= MAX_REMINDERS) return;
		reminders++;
		return {
			entries: [
				{
					type: "custom_message",
					customType: "implement-tdd-report-reminder",
					content: `You have not submitted a report. Call ${TOOL_NAME} now with the report for the slices done so far. Do not do any other work.`,
					display: true,
				},
			],
			continue: true,
		};
	});
}
