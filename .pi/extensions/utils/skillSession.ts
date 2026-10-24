import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** `/skill:<name>` expands to a prompt that starts with this block (pi `agent-session.js`, `_expandSkillCommand`). */
const SKILL_PROMPT = /^<skill name="([^"]+)"(?: location="([^"]+)")?/;

export interface SkillPrompt {
	readonly name: string;
	/** Path of the skill's SKILL.md, when the prompt names it. */
	readonly location?: string;
}

export function parseSkillPrompt(text: string): SkillPrompt | undefined {
	const match = SKILL_PROMPT.exec(text);
	if (!match || match[1] === undefined) return undefined;
	return match[2] === undefined ? { name: match[1] } : { name: match[1], location: match[2] };
}

export function isSkillPrompt(text: string, skillName: string): boolean {
	return parseSkillPrompt(text)?.name === skillName;
}

export function userText(entry: SessionEntry): string | undefined {
	if (entry.type !== "message" || entry.message.role !== "user") return undefined;
	const { content } = entry.message;
	if (typeof content === "string") return content;
	const first = content.find((part) => part.type === "text");
	return first && first.type === "text" ? first.text : undefined;
}

/** The last skill prompt on the branch, if any: the skill a resumed session is running. */
export function lastSkillPrompt(entries: readonly SessionEntry[]): SkillPrompt | undefined {
	return entries.reduce<SkillPrompt | undefined>((current, entry) => {
		const text = userText(entry);
		return (text === undefined ? undefined : parseSkillPrompt(text)) ?? current;
	}, undefined);
}
