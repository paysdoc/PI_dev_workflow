import * as fs from "node:fs";
import * as path from "node:path";
import { type ParsedPlan, parsePlan, taskPaths } from "./planFormat";
import { resolvePath, withinRoot, worktreeRelative } from "../shared/worktreePaths";

/** Roots no plan may schedule writes under: the scenario writer owns one, the plans live in the other. */
export const PLAN_FORBIDDEN_ROOTS = ["features/", "specs/"] as const;

export interface PlanCheckOptions {
	/** The worktree root. */
	readonly cwd: string;
	/** False when the orchestrator has turned unit tests off: every task must then say "Tests: none". */
	readonly unitTests: boolean;
}

export type PlanCheckResult = { readonly ok: true; readonly plan: ParsedPlan } | { readonly ok: false; readonly errors: readonly string[] };

const GLOB = /[*?[\]{}]/;

/** Why `file` is not an exact, worktree-relative POSIX path, or undefined when it is one. */
function shapeError(file: string): string | undefined {
	if (file.trim() !== file || file === "") return "has leading or trailing whitespace or is empty";
	if (path.isAbsolute(file) || file.startsWith("~")) return "must be relative to the worktree root";
	if (file.includes("\\")) return "must use forward slashes";
	if (GLOB.test(file)) return "must be an exact path, not a glob";
	if (file.endsWith("/")) return "must name a file, not a directory";
	if (file.split("/").some((part) => part === "." || part === ".." || part === "")) return 'must not contain ".", ".." or empty segments';
	return undefined;
}

type Location = { readonly relative: string; readonly absolute: string } | { readonly error: string };

function locate(file: string, cwd: string): Location {
	const shape = shapeError(file);
	if (shape !== undefined) return { error: shape };
	const absolute = resolvePath(file, cwd);
	const relative = absolute === undefined ? undefined : worktreeRelative(absolute, cwd);
	if (absolute === undefined || relative === undefined) return { error: "is outside the worktree" };
	if (relative !== file) return { error: `resolves to "${relative}"; use that path` };
	return { relative, absolute };
}

function checkWritePaths(plan: ParsedPlan, cwd: string, errors: string[]): void {
	const check = (file: string, section: string, mustExist: boolean) => {
		const at = `${section}: \`${file}\``;
		const located = locate(file, cwd);
		if ("error" in located) return errors.push(`${at} ${located.error}.`);
		const forbidden = PLAN_FORBIDDEN_ROOTS.find((root) => withinRoot(located.relative, root));
		if (forbidden !== undefined) return errors.push(`${at} lies under ${forbidden}, which no plan task may write.`);
		const stat = fs.statSync(located.absolute, { throwIfNoEntry: false });
		if (mustExist && stat === undefined) errors.push(`${at} does not exist. Move it to "### New Files" if the plan creates it.`);
		if (mustExist && stat !== undefined && !stat.isFile()) errors.push(`${at} is not a file.`);
		if (!mustExist && stat !== undefined) errors.push(`${at} already exists. Move it to "### Files to Change".`);
		return undefined;
	};
	plan.filesToChange.forEach((file) => check(file, "### Files to Change", true));
	plan.newFiles.forEach((file) => check(file, "### New Files", false));
}

const duplicates = (values: readonly string[]) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

function checkTaskCoverage(plan: ParsedPlan, errors: string[]): void {
	const listed = [...plan.filesToChange, ...plan.newFiles];
	duplicates(listed).forEach((file) => errors.push(`\`${file}\` is listed more than once in "### Files to Change" and "### New Files".`));
	const named = new Set(plan.tasks.flatMap(taskPaths));
	const listedSet = new Set(listed);
	[...named]
		.filter((file) => !listedSet.has(file))
		.forEach((file) => errors.push(`\`${file}\` is named in a task's "Files:" or "Tests:" line but not listed in "### Files to Change" or "### New Files".`));
	[...listedSet]
		.filter((file) => !named.has(file))
		.forEach((file) => errors.push(`\`${file}\` is listed in "### Files to Change" or "### New Files" but no task's "Files:" or "Tests:" line names it.`));
}

function checkTests(plan: ParsedPlan, unitTests: boolean, errors: string[]): void {
	if (unitTests) return;
	plan.tasks
		.filter((task) => !("none" in task.tests))
		.forEach((task) => errors.push(`Task "${task.title}": unit tests are off for this repository, so it must say "Tests: none: <reason>".`));
}

/** Checks a plan's write scope: its structure, its paths against the worktree, and that the tasks and lists agree. */
export function checkPlan(text: string, options: PlanCheckOptions): PlanCheckResult {
	const parsed = parsePlan(text);
	if (!parsed.ok) return parsed;
	const errors: string[] = [];
	checkWritePaths(parsed.plan, options.cwd, errors);
	checkTaskCoverage(parsed.plan, errors);
	checkTests(parsed.plan, options.unitTests, errors);
	return errors.length > 0 ? { ok: false, errors } : parsed;
}
