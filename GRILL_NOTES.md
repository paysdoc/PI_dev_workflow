# Grill Notes

Decisions deferred or parked during grills. Read this before starting a new grill.

## plan-issue skill (replaces commands/bug.md, chore.md, feature.md)

### Deferred: moves once the orchestrator / WorkflowNode exist
- **Metadata and plan path → orchestrator.** The orchestrator computes `planPath` and writes `# <Type>: <name>` + `## Metadata` (checks the header with `^# (Bug|Chore|Feature): .+$`). The agent stops copying `issueJson`. Then `correctPlanFileNaming` in the old ADW can go.
- **Prose rules → WorkflowNode verifiers / `tool_call` hooks.** "Read-only research", "write only the plan file" and "stop once written, ignore `features/`" become enforced:
  - block `write`/`edit` outside `planPath`;
  - bash allowlist `git (log|show|diff|blame)` only, rejecting shell metacharacters, `--output`, `--ext-diff`, `--textconv` and `-c`;
  - block reads of the per-issue scenario directory (`features/per-issue/`).
- **Deterministic work → verifiers.** Running unit tests, `## Validation Commands`, and plan structure checks (header, required sections per type, Relevant Files paths exist). Planning test-*writing* tasks stays in the skill.
- **`unitTests` resolved by code.** Pass in a boolean instead of having the LLM parse `.github/adw.yml`.
- **Retry on verifier failure.** Proposed: one retry with the verifier's reason fed back, then fail the phase. Not decided.

### AGENTS.md (deferred)
- Use a managed block between `<!-- adw:begin -->` and `<!-- adw:end -->`, keeping human content outside it. Agreed as the right direction.
- Pi loads only ONE context file per directory, first match of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` (verified: `pi-coding-agent/dist/core/resource-loader.js:115-133`). Adding AGENTS.md silently hides an existing CLAUDE.md. Proposed: move CLAUDE.md content into AGENTS.md and make CLAUDE.md a pointer. Not decided.
- AGENTS.md is loaded by every agent in the cwd (implementer, reviewer, humans), so it holds only universal facts, never planner rules.
- Open: generated from `.adw/` (with a staleness hash) vs hand-written index of `.adw/` files. It must live in the target repo, because the planner's cwd is the target worktree.

### Parked
- `.pi/presets.json` is inert (no extension reads it). Its `plan` preset contradicts the planner needing `write`.
- `.pi/extensions/multi-model-hooks.ts` injects model-specific instructions (`before_agent_start`) that also reach the planner.
- Other agents (`implement`, `review`, `test`, `scenario_writer`, ...) read `.adw/*.md` themselves. Trim once AGENTS.md exists.
- `pr_review.md` and `patch.md` are also plan-shaped and could be folded into `plan-issue` later.
- How to check the new skill: proposed A/B on 3 past issues (one per type), old vs new plan, judged by a human.
