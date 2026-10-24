/**
 * write-scenarios report tool
 *
 * The write-scenarios skill ends by calling `report_scenarios` instead of
 * printing raw JSON. The schema below is the single source of truth for the
 * report, and the orchestrator can use `ScenarioReport` as its type.
 * Activation, validation and reminders live in `utils/skillReport.ts`.
 *
 * The report carries nothing code can derive, so the model cannot get it wrong:
 *   - no "regression touched" flag: the orchestrator derives it from
 *     `changes[].file` and `vocabularyAdded`;
 *   - no list of unregistered step phrases: promotion compares the steps with
 *     the vocabulary registry when it needs them, as ADW's promotion sweep does.
 * It does report `newTerms`, the domain terms the model coined, which no code
 * can detect.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { registerSkillReport } from "./utils/skillReport";

export const TOOL_NAME = "report_scenarios";
const SKILL_NAME = "write-scenarios";

// Keep the schema strict-mode compatible (no oneOf/allOf, no unions of objects,
// no minLength): providers fall back to non-strict sampling otherwise.
const NullableString = (description: string) => Type.Union([Type.String(), Type.Null()], { description });

const FileField = Type.String({ description: "Path of the .feature file, relative to the repository root." });
const ScenarioField = Type.String({
	description: "The scenario's name, exactly as written after `Scenario:` or `Scenario Outline:`.",
});

export const ScenarioRef = Type.Object({ file: FileField, scenario: ScenarioField }, { additionalProperties: false });

export const Change = Type.Object(
	{
		file: FileField,
		scenario: ScenarioField,
		before: NullableString("The scenario before the change, in full Gherkin. Null when it was added to an existing file."),
		after: NullableString("The scenario after the change, in full Gherkin. Null when it was deleted."),
		reason: Type.String({ description: "Why this issue requires the change." }),
	},
	{ additionalProperties: false },
);

export const NewTerm = Type.Object(
	{
		scenario: ScenarioField,
		term: Type.String({ description: "A domain term the scenario uses that UBIQUITOUS_LANGUAGE.md does not define." }),
	},
	{ additionalProperties: false },
);

export const Failure = Type.Object(
	{ reason: Type.String({ description: "Why no scenarios could be written." }) },
	{ additionalProperties: false },
);

export const ScenarioReport = Type.Object(
	{
		scenarios: Type.Array(ScenarioRef, {
			description:
				"Every scenario implement-tdd must satisfy for this issue: the new ones and every edited regression scenario.",
		}),
		changes: Type.Array(Change, {
			description: "Every scenario that existed before this run and was edited, added to an existing file, or deleted.",
		}),
		newTerms: Type.Array(NewTerm, {
			description: "Domain terms you coined because the glossary has none for the concept. Not step phrases.",
		}),
		vocabularyAdded: Type.Array(Type.String(), { description: "Phrases added to the vocabulary registry." }),
		driverMethods: Type.Array(Type.String(), {
			description: "New stub driver methods, as `<Area>Driver.<method>`.",
		}),
		failed: Type.Optional(Failure),
	},
	{ additionalProperties: false },
);

export type ScenarioRef = Static<typeof ScenarioRef>;
export type Change = Static<typeof Change>;
export type NewTerm = Static<typeof NewTerm>;
export type Failure = Static<typeof Failure>;
export type ScenarioReport = Static<typeof ScenarioReport>;

/** Returns a feature file's contents, or undefined when it does not exist. */
export type FeatureReader = (file: string) => string | undefined;

const DRIVER_METHOD = /^\w+Driver\.\w+$/;
const SCENARIO_HEADING = /^\s*(?:Scenario Outline|Scenario Template|Scenario|Example):\s*(.*?)\s*$/;

const isBlank = (value: string | null | undefined) => value == null || value.trim() === "";

function scenarioNames(content: string): Set<string> {
	return new Set(content.split(/\r?\n/).flatMap((line) => SCENARIO_HEADING.exec(line)?.[1] ?? []));
}

function checkScenarioRef(ref: ScenarioRef, index: number, readFeature: FeatureReader): string | undefined {
	const at = `scenarios[${index}]`;
	const content = readFeature(ref.file);
	if (content === undefined) return `${at}: ${ref.file} does not exist.`;
	if (scenarioNames(content).has(ref.scenario.trim())) return undefined;
	return `${at}: ${ref.file} has no scenario named "${ref.scenario}".`;
}

function checkChange(change: Change, index: number): string[] {
	const at = `changes[${index}]`;
	const errors: string[] = [];
	if (change.before === null && change.after === null) errors.push(`${at}: before and after cannot both be null.`);
	if (isBlank(change.reason)) errors.push(`${at}: a change needs a reason.`);
	return errors;
}

function checkFailure(report: ScenarioReport): string[] {
	if (!report.failed) return report.scenarios.length === 0 ? ["scenarios is empty; set failed with a reason instead."] : [];
	const errors = isBlank(report.failed.reason) ? ["failed.reason must say why no scenarios could be written."] : [];
	if (report.scenarios.length > 0 || report.changes.length > 0) {
		errors.push("A failed run writes nothing: scenarios and changes must be empty.");
	}
	return errors;
}

/** Rules the schema cannot express. Returns one message per violation. */
export function checkReport(report: ScenarioReport, readFeature: FeatureReader): string[] {
	const refErrors = report.scenarios.flatMap((ref, index) => checkScenarioRef(ref, index, readFeature) ?? []);
	const changeErrors = report.changes.flatMap((change, index) => checkChange(change, index));
	const methodErrors = report.driverMethods
		.filter((method) => !DRIVER_METHOD.test(method))
		.map((method) => `driverMethods: "${method}" is not of the form <Area>Driver.<method>.`);
	return [...checkFailure(report), ...refErrors, ...changeErrors, ...methodErrors];
}

function readFeatureFile(cwd: string, file: string): string | undefined {
	try {
		return fs.readFileSync(path.resolve(cwd, file), "utf8");
	} catch {
		return undefined;
	}
}

export const featureReader =
	(cwd: string): FeatureReader =>
	(file) =>
		readFeatureFile(cwd, file);

export default function (pi: ExtensionAPI) {
	registerSkillReport(pi, {
		skillName: SKILL_NAME,
		toolName: TOOL_NAME,
		label: "Report scenarios",
		description:
			"Submit the final write-scenarios report. Call it exactly once, as your last action, after the last file is written. " +
			"If it returns an error, fix the report and call it again.",
		promptSnippet: "Submit the final write-scenarios report",
		schema: ScenarioReport,
		check: (report, cwd) => checkReport(report, featureReader(cwd)),
		reminderType: "write-scenarios-report-reminder",
		reminderText: `You have not submitted a report. Call ${TOOL_NAME} now with the report for the work done so far. Do not do any other work.`,
	});
}
