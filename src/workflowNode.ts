/**
 * WorkflowNode — an event-driven worker cell.
 *
 * Shape of a run:
 *   invoke skill → verifier → pass ? return : (retry | handoff)
 *
 * The node is agnostic of the Pi runtime types; it only names Pi's
 * lifecycle events. Concrete implementations narrow `PiEvent`/`PiContext`
 * to the exact types from the Pi extension API.
 */

/**
 * Lifecycle event names exposed by `pi.on(...)` in the Pi extension API.
 * Kept as a string union (not an enum) so handler maps stay structural
 * and extra events a future Pi release adds can be added here without a
 * runtime migration.
 */
export type PiLifecycleEvent =
  | "session_start"
  | "session_shutdown"
  | "session_before_compact"
  | "session_before_fork"
  | "session_before_switch"
  | "session_tree"
  | "before_agent_start"
  | "agent_start"
  | "agent_end"
  | "agent_before_settle"
  | "agent_settled"
  | "turn_start"
  | "turn_end"
  | "message_end"
  | "tool_call"
  | "tool_result"
  | "input"
  | "user_bash"
  | "before_provider_request"
  | "after_provider_response"
  | "provider_stream_event"
  | "model_select"
  | "project_trust";

// Opaque on purpose: this module does not depend on Pi runtime types.
// Concrete nodes cast or narrow at the use site.
export type PiEvent = unknown;
export type PiContext = unknown;

/**
 * Returning a value forwards it to Pi as the event result (some Pi events
 * transform data or cancel operations); returning void is notification-only.
 * See `docs/extensions.md` for which events are actionable.
 */
export type LifecycleHandler = (
  event: PiEvent,
  ctx: PiContext,
) => void | unknown | Promise<void | unknown>;

/** Mirrors the `/skill:<name> <args>` command shape. */
export interface SkillInvocation {
  readonly name: string;
  readonly args?: string;
}

/**
 * Discriminated so the `pass` flag always travels with the branch. A
 * verifier may supply `reason` on either branch (pass-with-rationale is
 * useful for Jev-style verifiers that explain *why* they passed).
 */
export type VerificationResult =
  | { readonly pass: true; readonly reason?: string }
  | { readonly pass: false; readonly reason?: string };

export interface VerifierInput {
  readonly skill: SkillInvocation;
  readonly attempt: number;
  readonly output: unknown;
}

/**
 * May be a deterministic check (schema validation, exit code, file diff)
 * or an intelligent agent (e.g. Jev invoked as its own skill). The node
 * does not care which — only that the result conforms.
 */
export type Verifier = (
  input: VerifierInput,
) => VerificationResult | Promise<VerificationResult>;

export interface StateHandoff {
  readonly target: string;
  readonly payload?: unknown;
}

/**
 * Chosen at construction, not per-attempt: each WorkflowNode commits to
 * one failure flow so the composing runtime can reason about termination.
 *
 * `retry` exhausts without an implicit handoff — a cell that wants both
 * composes two nodes.
 */
export type FailureStrategy =
  | { readonly kind: "retry"; readonly maxAttempts: number }
  | { readonly kind: "handoff"; readonly handoff: StateHandoff };

/**
 * Return shape of `run()`:
 *  - pass                            → `{ verification: { pass: true, ... } }`
 *  - fail + handoff strategy         → `{ verification: { pass: false, ... }, handoff }`
 *  - fail + retry strategy exhausted → `{ verification: { pass: false, ... } }` (no handoff)
 */
export interface WorkflowNodeResult {
  readonly verification: VerificationResult;
  readonly handoff?: StateHandoff;
}

/**
 * An event-driven worker cell. The node:
 *   1. invokes `skill` (the worker agent),
 *   2. feeds its output to `verifier`,
 *   3. on pass, returns the verification,
 *   4. on fail, applies `onFailure` — retry the worker+verifier, or
 *      return the verification plus a `StateHandoff` to the next node.
 *
 * `hooks` is optional and sparse: zero, one, or many Pi lifecycle events
 * may be subscribed. One handler per event name; a node that needs
 * fan-out dispatches internally.
 */
export interface WorkflowNode {
  readonly id: string;
  readonly skill: SkillInvocation;
  readonly verifier: Verifier;
  readonly onFailure: FailureStrategy;
  readonly hooks?: Partial<Record<PiLifecycleEvent, LifecycleHandler>>;

  run(ctx: PiContext, input?: unknown): Promise<WorkflowNodeResult>;
}
