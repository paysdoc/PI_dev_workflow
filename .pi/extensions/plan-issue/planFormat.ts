/**
 * Parser for the plan format the plan-issue templates define. The plan check
 * (`index.ts`) uses it to reject plans whose write scope is not
 * structured.
 *
 * The parts it reads:
 *
 *   ## Relevant Files            files to read; bullets "- `<path>`: <why>"
 *   ### Files to Change          files the tasks change; bullets, or "- none"
 *   ### New Files                files the tasks create; bullets, or "- none"
 *   ## Step by Step Tasks
 *   ### <n>. <task>              each task ends with exactly these two lines:
 *   Files: `<path>`, `<path>`    or "Files: none"
 *   Tests: `<path>`              or "Tests: none: <reason>"
 *   ## Notes
 *   ### Dependencies             bullets "- `<package>`: `<install command>`", or "- none"
 *
 * Headings inside fenced code blocks are ignored. Parsing reports every
 * structural problem it finds; it does not look at the filesystem.
 */

export interface PlanTask {
	readonly title: string;
	readonly files: readonly string[];
	readonly tests: { readonly paths: readonly string[] } | { readonly none: string };
}

export interface Dependency {
	readonly name: string;
	readonly install: string;
}

export interface ParsedPlan {
	readonly relevantFiles: readonly string[];
	readonly filesToChange: readonly string[];
	readonly newFiles: readonly string[];
	readonly tasks: readonly PlanTask[];
	readonly dependencies: readonly Dependency[];
}

export type PlanParseResult = { readonly ok: true; readonly plan: ParsedPlan } | { readonly ok: false; readonly errors: readonly string[] };

export const RELEVANT_FILES = "## Relevant Files";
export const FILES_TO_CHANGE = "### Files to Change";
export const NEW_FILES = "### New Files";
export const TASKS = "## Step by Step Tasks";
export const NOTES = "## Notes";
export const DEPENDENCIES = "### Dependencies";

interface Section {
	readonly heading: string;
	readonly level: number;
	readonly lines: readonly string[];
}

const HEADING = /^(#{2,3}) +(.+?) *$/;
const FENCE = /^ *(```|~~~)/;

/** Splits the plan into its level-2 and level-3 sections, ignoring headings inside code fences. */
function sections(text: string): Section[] {
	const result: { heading: string; level: number; lines: string[] }[] = [];
	let inFence = false;
	for (const line of text.split(/\r?\n/)) {
		if (FENCE.test(line)) inFence = !inFence;
		const match = inFence ? null : HEADING.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined) {
			result.push({ heading: `${match[1]} ${match[2]}`, level: match[1].length, lines: [] });
		} else {
			result.at(-1)?.lines.push(line);
		}
	}
	return result;
}

/** The level-3 sections between a level-2 heading and the next level-2 heading. */
function childrenOf(all: readonly Section[], parent: string): { found: boolean; children: Section[] } {
	const start = all.findIndex((section) => section.heading === parent);
	if (start < 0) return { found: false, children: [] };
	const children: Section[] = [];
	for (const section of all.slice(start + 1)) {
		if (section.level === 2) break;
		children.push(section);
	}
	return { found: true, children };
}

const BACKTICKED = /`([^`]*)`/g;

/** Backticked values in `text`, or undefined when anything but commas and whitespace lies between them. */
function backtickedList(text: string): string[] | undefined {
	const values = [...text.matchAll(BACKTICKED)].map((match) => match[1] ?? "");
	const rest = text.replace(BACKTICKED, "").replace(/[\s,]/g, "");
	return rest === "" && values.length > 0 ? values : undefined;
}

const BULLET = /^ *[-*] +(.*)$/;

/** Reads the path bullets of a file section. "- none" means an empty section. */
function pathBullets(section: Section, errors: string[]): string[] {
	const bullets = section.lines.flatMap((line) => {
		const match = BULLET.exec(line);
		return match?.[1] === undefined ? [] : [match[1].trim()];
	});
	if (bullets.length === 1 && /^none\.?$/i.test(bullets[0] ?? "")) return [];
	if (bullets.length === 0) {
		errors.push(`${section.heading}: list one bullet per file, or "- none".`);
		return [];
	}
	return bullets.flatMap((bullet) => {
		const match = /^`([^`]+)`/.exec(bullet);
		if (match?.[1] === undefined) {
			errors.push(`${section.heading}: "${bullet}" must start with a backticked path, e.g. "- \`src/app.ts\`: why".`);
			return [];
		}
		return [match[1]];
	});
}

function requireChild(children: readonly Section[], heading: string, parent: string, errors: string[]): Section | undefined {
	const found = children.filter((section) => section.heading === heading);
	if (found.length === 0) errors.push(`Missing "${heading}" under "${parent}".`);
	if (found.length > 1) errors.push(`"${heading}" appears more than once.`);
	return found[0];
}

const FILES_LINE = /^(?:[-*] +)?Files: *(.*)$/;
const TESTS_LINE = /^(?:[-*] +)?Tests: *(.*)$/;

function parseTask(section: Section, errors: string[]): PlanTask | undefined {
	const title = section.heading.replace(/^### +/, "");
	const at = `Task "${title}"`;
	const lines = section.lines.map((line) => line.trim()).filter((line) => line !== "");
	const filesMatch = FILES_LINE.exec(lines.at(-2) ?? "");
	const testsMatch = TESTS_LINE.exec(lines.at(-1) ?? "");
	if (filesMatch?.[1] === undefined || testsMatch?.[1] === undefined) {
		errors.push(`${at}: must end with a "Files:" line followed by a "Tests:" line.`);
		return undefined;
	}
	const filesValue = filesMatch[1].trim();
	const files = /^none\.?$/i.test(filesValue) ? [] : backtickedList(filesValue);
	if (files === undefined) errors.push(`${at}: "Files:" must be "none" or backticked paths separated by commas.`);

	const testsValue = testsMatch[1].trim();
	const none = /^none\b *:? *(.*)$/i.exec(testsValue);
	let tests: PlanTask["tests"] | undefined;
	if (none !== null) {
		const reason = (none[1] ?? "").trim();
		if (reason === "") errors.push(`${at}: "Tests: none" needs a reason, e.g. "Tests: none: configuration only".`);
		tests = { none: reason };
	} else {
		const paths = backtickedList(testsValue);
		if (paths === undefined) errors.push(`${at}: "Tests:" must be backticked paths separated by commas, or "none: <reason>".`);
		tests = paths === undefined ? undefined : { paths };
	}
	if (files === undefined || tests === undefined) return undefined;
	return { title, files, tests };
}

function parseDependencies(section: Section, errors: string[]): Dependency[] {
	const bullets = section.lines.flatMap((line) => {
		const match = BULLET.exec(line);
		return match?.[1] === undefined ? [] : [match[1].trim()];
	});
	if (bullets.length === 1 && /^none\.?$/i.test(bullets[0] ?? "")) return [];
	if (bullets.length === 0) {
		errors.push(`${DEPENDENCIES}: list one bullet per dependency, or "- none".`);
		return [];
	}
	return bullets.flatMap((bullet) => {
		const match = /^`([^`]+)` *: *`([^`]+)`$/.exec(bullet);
		if (match?.[1] === undefined || match[2] === undefined) {
			errors.push(`${DEPENDENCIES}: "${bullet}" must look like "- \`<package>\`: \`<install command>\`".`);
			return [];
		}
		return [{ name: match[1], install: match[2] }];
	});
}

export function parsePlan(text: string): PlanParseResult {
	const errors: string[] = [];
	const all = sections(text);

	const relevant = childrenOf(all, RELEVANT_FILES);
	if (!relevant.found) errors.push(`Missing "${RELEVANT_FILES}".`);
	const relevantSection = all.find((section) => section.heading === RELEVANT_FILES);
	const relevantFiles = relevantSection === undefined ? [] : pathBullets(relevantSection, errors);
	const change = relevant.found ? requireChild(relevant.children, FILES_TO_CHANGE, RELEVANT_FILES, errors) : undefined;
	const created = relevant.found ? requireChild(relevant.children, NEW_FILES, RELEVANT_FILES, errors) : undefined;
	const filesToChange = change === undefined ? [] : pathBullets(change, errors);
	const newFiles = created === undefined ? [] : pathBullets(created, errors);

	const taskSections = childrenOf(all, TASKS);
	if (!taskSections.found) errors.push(`Missing "${TASKS}".`);
	else if (taskSections.children.length === 0) errors.push(`"${TASKS}" has no "### <n>. <task>" sections.`);
	const tasks = taskSections.children.flatMap((section) => parseTask(section, errors) ?? []);

	const notes = childrenOf(all, NOTES);
	if (!notes.found) errors.push(`Missing "${NOTES}".`);
	const dependencySection = notes.found ? requireChild(notes.children, DEPENDENCIES, NOTES, errors) : undefined;
	const dependencies = dependencySection === undefined ? [] : parseDependencies(dependencySection, errors);

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, plan: { relevantFiles, filesToChange, newFiles, tasks, dependencies } };
}

/** Every path a task names, in its `Files:` or `Tests:` line. */
export function taskPaths(task: PlanTask): readonly string[] {
	return "paths" in task.tests ? [...task.files, ...task.tests.paths] : task.files;
}
