/**
 * /btw — answer an aside without polluting conversation context.
 *
 * Usage:
 *   /btw why does TypeScript narrow unions here?
 *   /btw what's the shortcut to reload extensions?
 *
 * The question and the model's answer are shown in an overlay but are NEVER
 * written to the session, so the next turn in your main conversation starts
 * exactly as if /btw had not been invoked. The current branch IS passed to
 * the model as read-only context so answers can reference what you were just
 * working on.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	BorderedLoader,
	DynamicBorder,
	convertToLlm,
	getMarkdownTheme,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

const SYSTEM_PROMPT = `You are answering a quick side question ("by the way...") from a developer in the middle of a coding session.

Guidelines:
- Be direct and concise. This is a tangent, not the main task.
- Use the prior conversation only as background context — do NOT continue or advance that work.
- Do not propose edits, run tools, or suggest next steps for the main task.
- Prefer a short paragraph or a tight bulleted answer. Code snippets only when essential.
- If the aside is ambiguous, give the single most likely answer rather than asking back.`;

// Mirror handoff.ts: if the branch has been compacted, feed the model the
// compaction summary plus the kept tail so it still has useful context.
function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function getContextMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
	}
	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction"
			? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
			: -1;
	const compacted = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return compacted.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
}

async function showAnswerUi(question: string, answer: string, ctx: ExtensionCommandContext) {
	if (ctx.mode !== "tui") return;

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));
		const mdTheme = getMarkdownTheme();

		container.addChild(border);
		container.addChild(new Text(theme.fg("accent", theme.bold("btw")), 1, 0));
		container.addChild(new Text(theme.fg("muted", question), 1, 1));
		container.addChild(new Markdown(answer, 1, 1, mdTheme));
		container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to dismiss (nothing is saved)"), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: "Ask an aside question — answer is shown then discarded (not added to session)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/btw requires interactive mode", "error");
				return;
			}

			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <aside question>", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			// Build the one-shot prompt: prior conversation as background, then the aside.
			const contextMessages = getContextMessages(ctx.sessionManager.getBranch());
			const llmContext = contextMessages.length > 0 ? convertToLlm(contextMessages) : [];
			const conversationText = llmContext.length > 0 ? serializeConversation(llmContext) : "";

			const promptText =
				conversationText.length > 0
					? [
							"The following is the ongoing conversation for background only. Do not continue this work.",
							"",
							"<conversation>",
							conversationText,
							"</conversation>",
							"",
							"Aside question from the user:",
							"",
							question,
						].join("\n")
					: question;

			const userMessage: Message = {
				role: "user",
				content: [{ type: "text", text: promptText }],
				timestamp: Date.now(),
			};

			// Run the completion inside a loader overlay. Using a fresh sessionId
			// and cacheRetention:"none" keeps this call isolated from the live
			// session's cache/accounting.
			const answer = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `Answering aside using ${ctx.model!.id}...`);
				loader.onAbort = () => done(null);

				const run = async () => {
					const response = await ctx.modelRegistry.complete(
						ctx.model!,
						{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
						{
							signal: loader.signal,
							cacheRetention: "none",
							sessionId: uuidv7(),
						},
					);

					if (response.stopReason === "aborted") return null;

					return response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n")
						.trim();
				};

				run()
					.then(done)
					.catch((err) => {
						console.error("/btw failed:", err);
						done(null);
					});

				return loader;
			});

			if (answer === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}
			if (!answer) {
				ctx.ui.notify("No answer returned", "warning");
				return;
			}

			await showAnswerUi(question, answer, ctx);
			// Intentionally nothing persisted — no appendEntry, no sendUserMessage.
		},
	});
}
