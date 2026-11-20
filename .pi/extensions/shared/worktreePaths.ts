/**
 * Worktree path resolution, used by skill-path-guard, plan-issue and
 * implement-tdd. Roots are worktree-relative POSIX paths: a root ending in "/"
 * covers a directory and everything below it, a root ending in "*" covers every
 * path that starts with what precedes the "*" (`specs/issue-*`), and any other
 * root names one file.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

export function isWithin(absolute: string, dir: string): boolean {
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
