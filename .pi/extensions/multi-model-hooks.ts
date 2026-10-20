/**
 * Multi-Model Hooks Extension
 *
 * Demonstrates routing tasks to different models, injecting model-specific
 * system prompts, tracking model usage, and cycling between models.
 *
 * Patterns:
 *   1. /route - Auto-route tasks to the best model based on content
 *   2. /switch - Quick switch between preconfigured model profiles
 *   3. model_select hook - React to model changes (status bar, logging)
 *   4. before_agent_start hook - Inject model-specific instructions
 *   5. turn_end hook - Track per-model usage stats
 *
 * Usage:
 *   pi -e .pi/extensions/multi-model-hooks.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ─── Model Profiles ─────────────────────────────────────────────────────────
// Define your model profiles here. Adjust provider/model IDs to match your setup.

interface ModelProfile {
  provider: string;
  model: string;
  label: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  description: string;
  /** Keywords that trigger auto-routing to this model */
  routeKeywords?: string[];
  /** Extra instructions appended to system prompt when this model is active */
  instructions?: string;
}

const MODEL_PROFILES: Record<string, ModelProfile> = {
  // Fast model for quick tasks
  fast: {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    label: "⚡ Fast (Haiku)",
    thinkingLevel: "off",
    description: "Quick responses, code generation, simple edits",
    routeKeywords: ["quick", "simple", "rename", "format", "lint"],
    instructions: "Be concise. Prefer quick, surgical changes.",
  },

  workhorse: {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    label: "🚀 Workhorse (Sonnet)",
    thinkingLevel: "off",
    description: "Quick responses, code generation, simple edits",
    routeKeywords: ["quick", "simple", "rename", "format", "lint"],
    instructions: "Be concise. Prefer quick, surgical changes.",
  },

  // Deep thinking model for complex tasks
  deep: {
    provider: "anthropic",
    model: "claude-opus-5-5",
    label: "🧠 Deep (Opus + Thinking)",
    thinkingLevel: "high",
    description: "Complex reasoning, architecture, debugging",
    routeKeywords: ["architect", "design", "debug", "refactor", "complex", "plan"],
    instructions:
      "Think step by step. Consider edge cases, trade-offs, and alternatives before acting.",
  },

  // Review-only model (read-only tools)
  review: {
    provider: "anthropic",
    model: "claude-opus-5-5",
    label: "🔍 Review (Read-Only)",
    thinkingLevel: "medium",
    description: "Code review, analysis, no file changes",
    routeKeywords: ["review", "analyze", "audit", "check", "inspect"],
    instructions:
      "You are in REVIEW MODE. Analyze code thoroughly but do NOT make changes. Report findings clearly.",
  },

  // OpenAI model for variety/comparison
  openai: {
    provider: "openai",
    model: "o3",
    label: "🤖 OpenAI (o3)",
    thinkingLevel: "medium",
    description: "OpenAI o3 for comparison or alternative perspective",
    routeKeywords: [],
  },
};

// ─── Usage Tracking ──────────────────────────────────────────────────────────

interface ModelUsage {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export default function (pi: ExtensionAPI) {
  let activeProfile: string | undefined;
  const usageByModel: Record<string, ModelUsage> = {};

  // ─── Hook 1: model_select — React to model changes ──────────────────────
  pi.on("model_select", async (event, ctx) => {
    const { model, previousModel, source } = event;
    const next = `${model.provider}/${model.id}`;
    const prev = previousModel ? `${previousModel.provider}/${previousModel.id}` : "none";

    // Update status bar
    const profileLabel = activeProfile
      ? MODEL_PROFILES[activeProfile]?.label ?? activeProfile
      : model.id;
    ctx.ui.setStatus("multi-model", ctx.ui.theme.fg("accent", `🤖 ${profileLabel}`));

    // Log model change (visible in debug)
    if (source !== "restore") {
      console.log(`[multi-model] ${prev} → ${next} (${source})`);
    }
  });

  // ─── Hook 2: before_agent_start — Inject model-specific instructions ────
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!activeProfile) return;

    const profile = MODEL_PROFILES[activeProfile];
    if (!profile?.instructions) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Active Profile: ${profile.label}\n${profile.instructions}`,
    };
  });

  // ─── Hook 3: turn_end — Track per-model usage ───────────────────────────
  pi.on("turn_end", async (event, ctx) => {
    if (!ctx.model) return;
    const modelId = `${ctx.model.provider}/${ctx.model.id}`;

    if (!usageByModel[modelId]) {
      usageByModel[modelId] = { turns: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    }

    const usage = usageByModel[modelId];
    usage.turns++;

    const msg = event.message;
    if (msg.role === "assistant" && msg.usage) {
      usage.inputTokens += msg.usage.input ?? 0;
      usage.outputTokens += msg.usage.output ?? 0;
      usage.cost += msg.usage.cost?.total ?? 0;
    }
  });

  // ─── Hook 4: tool_call — Model-aware tool gating ────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    // In review mode, block write/edit/bash tools
    if (activeProfile === "review") {
      if (["write", "edit", "bash"].includes(event.toolName)) {
        return {
          block: true,
          reason: `Review mode: ${event.toolName} is disabled. Switch to another profile to make changes.`,
        };
      }
    }
  });

  // ─── Helper: Apply a model profile ──────────────────────────────────────
  async function applyProfile(
    name: string,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    const profile = MODEL_PROFILES[name];
    if (!profile) {
      ctx.ui.notify(`Unknown profile: "${name}"`, "error");
      return false;
    }

    // Find and set the model
    const model = ctx.modelRegistry.find(profile.provider, profile.model);
    if (!model) {
      ctx.ui.notify(
        `Model not found: ${profile.provider}/${profile.model}`,
        "error",
      );
      return false;
    }

    const success = await pi.setModel(model);
    if (!success) {
      ctx.ui.notify(
        `No API key for ${profile.provider}/${profile.model}`,
        "error",
      );
      return false;
    }

    // Set thinking level
    pi.setThinkingLevel(profile.thinkingLevel);

    // Set tool restrictions for review mode
    if (name === "review") {
      pi.setActiveTools(["read", "grep", "find", "ls"]);
    } else {
      // Restore full tool set
      pi.setActiveTools(pi.getAllTools().map((t) => t.name));
    }

    activeProfile = name;

    // Update status
    ctx.ui.setStatus(
      "multi-model",
      ctx.ui.theme.fg("accent", `🤖 ${profile.label}`),
    );
    ctx.ui.notify(`Profile: ${profile.label}`, "info");

    return true;
  }

  // ─── Command: /switch — Quick model profile selector ────────────────────
  pi.registerCommand("switch", {
    description: "Switch between model profiles (fast, deep, review, openai)",
    getArgumentCompletions: (prefix) => {
      const items = Object.entries(MODEL_PROFILES).map(([name, p]) => ({
        value: name,
        label: `${name} — ${p.label}`,
        description: p.description,
      }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const name = args?.trim();

      if (name && MODEL_PROFILES[name]) {
        await applyProfile(name, ctx);
        return;
      }

      // Show selector
      const choices = Object.entries(MODEL_PROFILES).map(
        ([key, p]) => `${key} — ${p.label}: ${p.description}`,
      );
      const choice = await ctx.ui.select("Select model profile:", choices);
      if (!choice) return;

      const selectedKey = choice.split(" — ")[0];
      await applyProfile(selectedKey, ctx);
    },
  });

  // ─── Command: /route — Auto-route based on task content ─────────────────
  pi.registerCommand("route", {
    description: "Auto-route task to best model based on keywords",
    handler: async (args, ctx) => {
      const task = args?.trim();
      if (!task) {
        ctx.ui.notify("Usage: /route <your task description>", "error");
        return;
      }

      const taskLower = task.toLowerCase();

      // Score each profile by keyword matches
      let bestProfile = "fast"; // default
      let bestScore = 0;

      for (const [name, profile] of Object.entries(MODEL_PROFILES)) {
        const keywords = profile.routeKeywords ?? [];
        const score = keywords.filter((kw) => taskLower.includes(kw)).length;
        if (score > bestScore) {
          bestScore = score;
          bestProfile = name;
        }
      }

      const profile = MODEL_PROFILES[bestProfile];
      ctx.ui.notify(
        `Auto-routing to ${profile.label} (matched: ${bestScore} keywords)`,
        "info",
      );

      await applyProfile(bestProfile, ctx);

      // Put the task in the editor for the user to send
      ctx.ui.setEditorText(task);
    },
  });

  // ─── Command: /usage — Show per-model usage stats ───────────────────────
  pi.registerCommand("usage", {
    description: "Show token usage breakdown by model",
    handler: async (_args, ctx) => {
      const entries = Object.entries(usageByModel);
      if (entries.length === 0) {
        ctx.ui.notify("No usage recorded yet", "info");
        return;
      }

      let totalCost = 0;
      const lines: string[] = ["Model Usage Breakdown:", ""];

      for (const [modelId, usage] of entries) {
        totalCost += usage.cost;
        lines.push(
          `  ${modelId}: ${usage.turns} turns, ↑${usage.inputTokens} ↓${usage.outputTokens} tokens, $${usage.cost.toFixed(4)}`,
        );
      }

      lines.push("", `  Total cost: $${totalCost.toFixed(4)}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ─── Keyboard Shortcut: Ctrl+Shift+M — Cycle profiles ──────────────────
  pi.registerShortcut("ctrl+shift+m", {
    description: "Cycle model profiles",
    handler: async (ctx) => {
      const profileNames = Object.keys(MODEL_PROFILES);
      const currentIndex = activeProfile
        ? profileNames.indexOf(activeProfile)
        : -1;
      const nextIndex = (currentIndex + 1) % profileNames.length;
      await applyProfile(profileNames[nextIndex], ctx);
    },
  });

  // ─── Session Start — Restore status ─────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.model) {
      const label = activeProfile
        ? MODEL_PROFILES[activeProfile]?.label ?? ctx.model.id
        : ctx.model.id;
      ctx.ui.setStatus(
        "multi-model",
        ctx.ui.theme.fg("accent", `🤖 ${label}`),
      );
    }
  });
}
