/**
 * implement-tdd report tool
 *
 * The implement-tdd skill ends by calling `report_implementation` instead of
 * printing raw JSON. The schema below is the single source of truth for the
 * report, and the orchestrator can use `ImplementationReport` as its type.
 * Activation, validation and reminders live in `reportTool.ts`.
 *
 * Scope is the prompt's job: the skill tells the model to stay within the
 * plan, and to report files it needed but the plan did not list as
 * `scopeGaps`, and work it noticed but did not do as `observations`. Nothing
 * checks those lists against the working tree.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { registerSkillReport } from "./reportTool";

export const TOOL_NAME = "report_implementation";
const SKILL_NAME = "implement-tdd";

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

export const ScopeGap = Type.Object(
	{
		file: Type.String({ description: "A file the plan does not list that this slice cannot be built without." }),
		why: Type.String({ description: "Which behaviour of the slice needs the file." }),
	},
	{ additionalProperties: false },
);

export const Observation = Type.Object(
	{
		file: Type.String({ description: "A file that would benefit from work outside this slice's scope." }),
		detail: Type.String({ description: "What could be improved. Observations never widen the scope." }),
	},
	{ additionalProperties: false },
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
		scopeGaps: Type.Array(ScopeGap, {
			description: "Files outside the plan that this slice needed and did not change. Empty when none.",
		}),
		observations: Type.Array(Observation, {
			description: "Refactoring or cleanup this slice noticed outside its scope. Empty when none.",
		}),
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
		if (hasTask === hasFinding) errors.push(`${at}: set exactly one of planTask and finding; the other must be null.`);
		if (slice.unitTest === "blocked" && isBlank(slice.reason)) errors.push(`${at}: a blocked slice needs a reason.`);
		if (!report.tdd && slice.unitTest !== "skipped") {
			errors.push(`${at}: unit tests are off (tdd: false), so unitTest must be "skipped".`);
		}
		slice.scopeGaps.forEach((gap, gapIndex) => {
			if (isBlank(gap.why)) errors.push(`${at}.scopeGaps[${gapIndex}]: say which behaviour needs the file.`);
		});
	});
	if (report.failed) {
		if (isBlank(report.failed.scenario)) errors.push("failed.scenario must name the scenario.");
		if (isBlank(report.failed.conflict)) errors.push("failed.conflict must describe the conflict.");
	}
	return errors;
}

export default function (pi: ExtensionAPI) {
	registerSkillReport(pi, {
		skillName: SKILL_NAME,
		toolName: TOOL_NAME,
		label: "Report implementation",
		description:
			"Submit the final implement-tdd report. Call it exactly once, as your last action, after the last slice is committed. " +
			"If it returns an error, fix the report and call it again.",
		promptSnippet: "Submit the final implement-tdd report",
		schema: ImplementationReport,
		check: (report) => checkReport(report),
		reminderType: "implement-tdd-report-reminder",
		reminderText: `You have not submitted a report. Call ${TOOL_NAME} now with the report for the slices done so far. Do not do any other work.`,
	});
}
