import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Worktree-relative roots, in POSIX form. A root ending in "/" covers a
 * directory and everything below it; a root ending in "*" covers every path
 * that starts with what precedes the "*" (`specs/issue-*`); any other root
 * names one file.
 */
export type Roots = readonly string[];

export interface PathRules {
	/** When set, a path must lie within one of these roots. */
	readonly allow?: Roots;
	/** A path must not lie within any of these roots. */
	readonly deny?: Roots;
}

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const OK: Verdict = { ok: true };
export const blocked = (reason: string): Verdict => ({ ok: false, reason });

export interface PathContext {
	/** The worktree root (the session's cwd). */
	readonly cwd: string;
	/** Extra directories that may always be read, such as the active skill's own directory. */
	readonly readableDirs?: readonly string[];
}

/** Mirrors how pi's file tools read a path argument: strip a leading "@", expand "~", resolve against cwd. */
function expand(input: string, cwd: string): string {
	const stripped = input.startsWith("@") ? input.slice(1) : input;
	if (stripped === "~") return os.homedir();
	if (stripped.startsWith("~/")) return path.join(os.homedir(), stripped.slice(2));
	return path.resolve(cwd, stripped);
}

/**
 * Resolves symlinks in the part of the path that exists, so a link cannot
 * smuggle a path out of the worktree. Throws when nothing along the path exists.
 */
function realpathLenient(absolute: string): string {
	const missing: string[] = [];
	let current = absolute;
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current);
		if (parent === current) throw new Error(`cannot resolve ${absolute}`);
		missing.unshift(path.basename(current));
		current = parent;
	}
	return path.join(fs.realpathSync(current), ...missing);
}

export function resolvePath(input: string, cwd: string): string | undefined {
	try {
		return realpathLenient(expand(input, cwd));
	} catch {
		return undefined;
	}
}

function isWithin(absolute: string, dir: string): boolean {
	const relative = path.relative(dir, absolute);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The worktree-relative POSIX path ("" for the root itself), or undefined when outside the worktree. */
export function worktreeRelative(absolute: string, cwd: string): string | undefined {
	const root = resolvePath(cwd, cwd);
	if (root === undefined || !isWithin(absolute, root)) return undefined;
	return path.relative(root, absolute).split(path.sep).join("/");
}

export function withinRoot(relative: string, root: string): boolean {
	if (root.endsWith("*")) return relative.startsWith(root.slice(0, -1));
	if (!root.endsWith("/")) return relative === root;
	return relative === root.slice(0, -1) || relative.startsWith(root);
}

/** True when `relative` is a directory that contains `root`, such as the worktree root containing `features/`. */
export function containsRoot(relative: string, root: string): boolean {
	if (relative === "") return true;
	return root.startsWith(`${relative}/`) && root !== `${relative}/`;
}

const describe = (roots: Roots) => roots.join(", ");

function inReadableDir(absolute: string, context: PathContext): boolean {
	return (context.readableDirs ?? []).some((dir) => {
		const real = resolvePath(dir, context.cwd);
		return real !== undefined && isWithin(absolute, real);
	});
}

type Located = { readonly relative: string } | { readonly verdict: Verdict };

function locate(input: string, context: PathContext): Located {
	const absolute = resolvePath(input, context.cwd);
	if (absolute === undefined) return { verdict: blocked(`"${input}" cannot be resolved.`) };
	const relative = worktreeRelative(absolute, context.cwd);
	if (relative === undefined) return { verdict: blocked(`"${input}" is outside the worktree.`) };
	return { relative };
}

function checkRules(input: string, relative: string, rules: PathRules, action: string): Verdict {
	const denied = rules.deny?.find((root) => withinRoot(relative, root));
	if (denied !== undefined) return blocked(`${action} "${input}" is not allowed: ${denied} is off limits.`);
	if (rules.allow === undefined || rules.allow.some((root) => withinRoot(relative, root))) return OK;
	return blocked(`${action} "${input}" is not allowed. Allowed: ${describe(rules.allow)}.`);
}

/** Checks one path against the worktree boundary and the rules. `action` starts the reason, e.g. "Reading". */
export function checkPath(input: string, rules: PathRules, context: PathContext, action: string): Verdict {
	const located = locate(input, context);
	if ("verdict" in located) return located.verdict;
	return checkRules(input, located.relative, rules, action);
}

/** A file whose contents the tool returns (`read`). */
export function checkRead(input: string, rules: PathRules, context: PathContext): Verdict {
	const absolute = resolvePath(input, context.cwd);
	if (absolute !== undefined && inReadableDir(absolute, context)) return OK;
	return checkPath(input, rules, context, "Reading");
}

/**
 * A directory whose files' contents the tool returns (`grep`). A search of a
 * parent of a denied root is allowed: `hideDeniedMatches` removes the matches
 * inside the denied root from the result.
 */
export function checkSearch(input: string, rules: PathRules, context: PathContext): Verdict {
	return checkPath(input, rules, context, "Searching");
}

/**
 * A directory whose entry names the tool returns (`ls`, `find`). Names are not
 * contents, so only the worktree boundary and the deny roots apply.
 */
export function checkList(input: string, rules: PathRules, context: PathContext): Verdict {
	const located = locate(input, context);
	if ("verdict" in located) return located.verdict;
	return checkRules(input, located.relative, { deny: rules.deny }, "Listing");
}

// pi's `ls`, `find` and `grep` end their output with notices such as "[100 results limit reached]".
const NOTICE_SEPARATOR = "\n\n[";

/** Drops the result lines `isHidden` selects, keeping pi's notices last and saying how many it hid. */
function hideLines(output: string, isHidden: (line: string) => boolean, deny: Roots, what: string): string {
	const noticeAt = output.indexOf(NOTICE_SEPARATOR);
	const body = noticeAt < 0 ? output : output.slice(0, noticeAt);
	const notices = noticeAt < 0 ? "" : output.slice(noticeAt);
	const lines = body.split("\n");
	const kept = lines.filter((line) => line === "" || !isHidden(line));
	const hidden = lines.length - kept.length;
	if (hidden === 0) return output;
	const shown = kept.length > 0 ? kept.join("\n") : `(no ${what} outside the off-limits roots)`;
	return `${shown}\n\n[${hidden} ${what} hidden: ${describe(deny)} is off limits]${notices}`;
}

function isDeniedEntry(line: string, base: string, deny: Roots, cwd: string): boolean {
	const relative = worktreeRelative(path.join(base, line.replace(/\/$/, "")), cwd);
	return relative !== undefined && deny.some((root) => withinRoot(relative, root));
}

/**
 * Removes the entries inside denied roots from an `ls` or `find` result, whose
 * lines are paths relative to the listed directory. A listing of a parent of a
 * denied root is allowed, so this keeps it from naming what lies inside.
 */
export function hideDeniedEntries(output: string, listed: string, rules: PathRules, context: PathContext): string {
	const deny = rules.deny ?? [];
	const base = resolvePath(listed, context.cwd);
	if (deny.length === 0 || base === undefined) return output;
	return hideLines(output, (line) => isDeniedEntry(line, base, deny, context.cwd), deny, "entries");
}

/** How a result line relative to `base` starts when it is inside `root`, or undefined when `root` is not below `base`. */
function linePrefixes(base: string, root: string): readonly string[] | undefined {
	if (base !== "" && !root.startsWith(`${base}/`)) return undefined;
	const below = base === "" ? root : root.slice(base.length + 1);
	if (below.endsWith("*")) return [below.slice(0, -1)];
	if (below.endsWith("/")) return [below];
	return [`${below}:`, `${below}-`];
}

/**
 * Removes the lines from files inside denied roots from a `grep` result. pi
 * prints every match and context line as `<path>:<n>: ` or `<path>-<n>- `, with
 * the path relative to the search root, so a path prefix identifies them.
 */
export function hideDeniedMatches(output: string, searched: string, rules: PathRules, context: PathContext): string {
	const deny = rules.deny ?? [];
	const base = resolvePath(searched, context.cwd);
	const relative = base === undefined ? undefined : worktreeRelative(base, context.cwd);
	if (deny.length === 0 || relative === undefined) return output;
	const prefixes = deny.flatMap((root) => linePrefixes(relative, root) ?? []);
	if (prefixes.length === 0) return output;
	return hideLines(output, (line) => prefixes.some((prefix) => line.startsWith(prefix)), deny, "matching lines");
}

/** A file the tool creates or changes (`write`, `edit`). */
export function checkWrite(input: string, rules: PathRules, context: PathContext): Verdict {
	return checkPath(input, rules, context, "Writing");
}
