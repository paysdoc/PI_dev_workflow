import { describe, expect, it } from "vitest";
import extension, { checkReport, type FeatureReader, type ScenarioReport, TOOL_NAME } from "../write-scenarios-report";
import { fakeContext, fakePi, makeWorktree, skillPrompt } from "./fakePi";

const FEATURE = [
	"@adw-7",
	"Feature: Export",
	"  Scenario: Export writes a CSV file",
	"    Given a report",
	"  Scenario Outline: Export rejects <format>",
	"    Given a report",
].join("\n");

const readFeature: FeatureReader = (file) => (file === "features/per-issue/feature-7.feature" ? FEATURE : undefined);

const report = (overrides: Partial<ScenarioReport> = {}): ScenarioReport => ({
	scenarios: [{ file: "features/per-issue/feature-7.feature", scenario: "Export writes a CSV file" }],
	changes: [],
	newTerms: [],
	vocabularyAdded: [],
	driverMethods: ["ExportDriver.exportReport"],
	...overrides,
});

describe("checkReport", () => {
	it("accepts a well-formed report, including outline names", () => {
		const outline = { file: "features/per-issue/feature-7.feature", scenario: "Export rejects <format>" };
		expect(checkReport(report({ scenarios: [...report().scenarios, outline] }), readFeature)).toEqual([]);
	});

	it("rejects a missing file and an unknown scenario name", () => {
		const scenarios = [
			{ file: "features/nope.feature", scenario: "x" },
			{ file: "features/per-issue/feature-7.feature", scenario: "Export writes a PDF" },
		];
		expect(checkReport(report({ scenarios }), readFeature)).toHaveLength(2);
	});

	it("requires scenarios unless the run failed", () => {
		expect(checkReport(report({ scenarios: [] }), readFeature)).toHaveLength(1);
	});

	it("requires a failed run to give a reason and write nothing", () => {
		expect(checkReport(report({ scenarios: [], failed: { reason: "No observable behaviour." } }), readFeature)).toEqual([]);
		expect(checkReport(report({ failed: { reason: "" } }), readFeature)).toHaveLength(2);
	});

	it("rejects a change with neither side or no reason", () => {
		const change = { file: "features/regression/a.feature", scenario: "a", before: null, after: null, reason: " " };
		expect(checkReport(report({ changes: [change] }), readFeature)).toHaveLength(2);
	});

	it("rejects driver methods not of the form <Area>Driver.<method>", () => {
		expect(checkReport(report({ driverMethods: ["exportReport", "Export.run"] }), readFeature)).toHaveLength(2);
	});
});

describe("report_scenarios tool", () => {
	it("activates only for the write-scenarios prompt", () => {
		const fake = fakePi();
		extension(fake.pi);
		expect(fake.activeTools()).not.toContain(TOOL_NAME);
		fake.emit("before_agent_start", { messageType: "user", prompt: skillPrompt("write-scenarios") });
		expect(fake.activeTools()).toContain(TOOL_NAME);
	});

	it("checks scenario names against the files in the session's cwd", async () => {
		const cwd = makeWorktree({ "features/per-issue/feature-7.feature": FEATURE });
		const fake = fakePi();
		extension(fake.pi);
		const tool = fake.tools.get(TOOL_NAME);
		await expect(tool?.execute("1", report(), undefined, undefined, fakeContext({ cwd }))).resolves.toMatchObject({
			terminate: true,
		});
		await expect(tool?.execute("2", report(), undefined, undefined, fakeContext())).rejects.toThrow(/does not exist/);
	});
});
