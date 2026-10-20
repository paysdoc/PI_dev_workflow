#!/usr/bin/env python3
"""Generate adw-architecture.pptx from the 16-subsystem as-is model.

Overview slides (master architecture, dependency layers, data flow) plus one
detail slide per subsystem showing its interaction neighborhood. Diagrams are
rendered with Graphviz -> PNG and embedded.

Data is hand-curated from the 16 subsystem agent reports (interaction maps).
"""
import os
import subprocess
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "_img")
os.makedirs(IMG, exist_ok=True)

# ---------------------------------------------------------------------------
# Model: 16 subsystems, grouped into dependency layers (foundational -> top)
# ---------------------------------------------------------------------------
SUBSYSTEMS = {
    1:  ("Config &\nEnvironment",        "L0"),
    2:  ("State &\nADW ID",              "L0"),
    3:  ("GitContext",                   "L1"),
    4:  ("Agent\nexecution",             "L1"),
    6:  ("Provider\nabstraction",        "L2"),
    5:  ("Phase runner\n& cost-track",   "L2"),
    13: ("Cost\ntelemetry & D1",         "L2"),
    7:  ("Phases &\norchestrators",      "L3"),
    8:  ("BDD / scenario\nsubsystem",    "L3"),
    14: ("Docs &\nliving-docs",          "L3"),
    15: ("Screenshots",                  "L3"),
    16: ("Supply-chain",                 "L3"),
    9:  ("Coordination\nkernel",         "L4"),
    11: ("Auto-merge / HITL\n+ resilience", "L4"),
    12: ("Framework\nself-upgrade",      "L4"),
    10: ("Triggers",                     "L5"),
}

LAYER_LABELS = {
    "L0": "Layer 0 — Substrate",
    "L1": "Layer 1 — I/O authorities",
    "L2": "Layer 2 — Composition & providers",
    "L3": "Layer 3 — Pipeline & content",
    "L4": "Layer 4 — Coordination & governance",
    "L5": "Layer 5 — Entry points",
}
LAYER_ORDER = ["L0", "L1", "L2", "L3", "L4", "L5"]

LAYER_COLOR = {
    "L0": "#33485e", "L1": "#2f6b6b", "L2": "#5a4a86",
    "L3": "#7a5230", "L4": "#7a2f4a", "L5": "#214d8a",
}

# Directed edges: (from, to, label). "from depends on / calls to".
EDGES = [
    # --- foundational reads ---
    (3, 1, "repo root, PAT, app-auth"),
    (4, 1, "CLI path, env allowlist, model/effort"),
    (4, 2, "writes raw_output.jsonl"),
    (4, 13, "token usage extraction"),
    (5, 1, "RUNNING_TOKENS, timeouts"),
    (5, 4, "model/effort/timeout"),
    (5, 13, "PhaseCostRecord -> D1"),
    (5, 2, "phase status, workflowStage"),
    (6, 1, "providers.md, tokens"),
    (6, 3, "all gh/git via GitContext"),
    (13, 1, "COST_API_URL/TOKEN"),
    (13, 2, "workflowId stamp"),
    # --- pipeline ---
    (7, 5, "runs each phase"),
    (7, 4, "slash-command agents"),
    (7, 6, "issue/PR/board ops"),
    (7, 8, "scenario phases"),
    (7, 14, "/document"),
    (7, 12, "upgradeGate at init"),
    (7, 2, "mints adwId, init state"),
    (8, 4, "6 scenario slash-cmds"),
    (8, 5, "runPhase, CostTracker"),
    (8, 3, "commit/push fixes"),
    (8, 15, "ADW_PROOF_DIR artifacts"),
    (14, 4, "/document agent"),
    (14, 3, "push, file issues"),
    (15, 8, "harvest proof images"),
    (15, 3, "repo id, PR number"),
    (16, 4, "depaudit via execWithRetry"),
    (16, 3, "gh secret set"),
    # --- coordination / governance ---
    (9, 2, "pid/lastSeenAt liveness"),
    (9, 3, "worktree reset, ls-remote"),
    (9, 4, "branch-slug gen"),
    (7, 9, "lock + heartbeat wrap"),
    (11, 2, "pause/merge stages"),
    (11, 6, "PR merge/approve"),
    (11, 4, "rate-limit/auth signals"),
    (11, 9, "spawn locks, takeover"),
    (7, 11, "awaiting_merge handoff"),
    (12, 3, "claim push, regen"),
    (12, 4, "/adw_init regen"),
    (12, 6, "open/merge upgrade PR"),
    # --- triggers (top) ---
    (10, 9, "spawnGate, takeover"),
    (10, 7, "spawns orchestrator"),
    (10, 1, "cwd assert, port alloc"),
    (10, 3, "per-launch context"),
    (10, 11, "scan pause/auth queues"),
    (10, 2, "discarded/abandoned"),
]

# Per-subsystem short captions for detail slides
CAPTIONS = {
    1:  "Static-config substrate: env-var accessors & secrets, runtime tuning constants, per-command model/effort routing maps, and per-target-repo .adw/ markdown config parsed into a typed ProjectConfig. Performs no orchestration. The single source every other subsystem reads.",
    2:  "Persistence substrate: mints the per-run adwId, owns the agents/{adwId}/ layout, and provides merge-aware read/write of the top-level state file (pid, pidStartedAt, lastSeenAt, workflowStage) and per-agent state. Enables phase chaining, resume, and out-of-band liveness queries.",
    3:  "Deep-module authority for ALL git and gh I/O. Constructed once per launch from a mandatory identity, resolves its base path in the constructor (self-host vs target), and injects auth per spawned command through one private #run() chokepoint — never mutating process.env. Eliminated the wrong-repo / token-bleed bug class.",
    4:  "The single seam to the model. Spawns the `claude` CLI as a detached child, drives it with a slash command, parses streamed JSONL (assistant text, tool calls, result, errors), enforces watchdog/kill/retry policy, returns a typed AgentResult. THE model-coupling core.",
    5:  "Composition glue around each phase: CostTracker + runPhase accumulate/persist/commit per-phase cost, route slash commands to model tier + effort, apply per-phase watchdog timeouts, and run a generic retry-with-resolution loop. Owns the cost-capture seam; not the cost math (13).",
    6:  "Portability seam: IssueTracker / CodeHost / BoardManager interfaces bundled into a validated RepoContext, with GitHub / GitLab / Jira impls over a thin GitHub API wrapper layer. Lets pipeline phases do issue/PR/board ops without binding to one platform.",
    7:  "The linear SDLC pipeline: classify issue -> route to orchestrator -> compose plan/build/test/review/document/PR phases, each wrapping Claude agents plus git/state side-effects. The root adw*.tsx entry scripts live here.",
    8:  "BDD-driven validation: generate per-issue Gherkin + step defs, reconcile plan vs scenarios, run tag-filtered suites as subprocesses, loop resolve+retest under Gherkin-freeze + fidelity governance, publish PR proof, and sweep scenarios for regression promotion. The plan/implementation contract.",
    9:  "Single-host coordination & recovery: per-issue spawn lock, PID+start-time liveness, heartbeat, hung-orchestrator detector, stage classifier, resume policy, remote reconcile, takeover handler, worktree reset/probe/reuse. The anti-split-brain layer.",
    10: "Two automation entry points: a 20s cron backlog sweeper and an HMAC-validated webhook server. Both resolve issue eligibility, run the takeover decision, and dispatch detached orchestrator processes — delegating all coordination primitives to subsystem 9.",
    11: "Governance + pause/resume: the stateless auto-merge gate (no hitl) OR (PR approved), a conflict-resolving merge orchestrator, durable pause queues for rate-limit/billing, a host-wide auth gate with Slack alerting, and a dev-server janitor.",
    12: "Hash-driven self-upgrade + bootstrap: a content hash over /adw_init inputs vs each target's .adw-version; on drift an atomic branch-namespace claim elects one winner to regenerate .adw/ and open an (optionally HITL-gated) PR. Same flow handles first-time bootstrap.",
    13: "Cost engine: extract Anthropic token usage from Claude JSONL, price against per-model tables, detect divergence vs CLI-reported cost, render multi-currency comment tables, and dual-write PhaseCostRecord rows to a Cloudflare D1-backed Cost API Worker.",
    14: "Living docs: the /document skill routes a change to its owning module doc and rewrites it in place, converging .adw/conditional_docs.md toward one entry per module. Deterministic guards flag doc bloat (files issues) and ownership regrowth as a post-write self-check.",
    15: "Review-screenshot pipeline: harvest BDD scenario screenshot artifacts, upload to per-repo Cloudflare R2 buckets, embed public URLs in a PR 'BDD Proof' comment. A standalone Worker serves images under screenshots.paysdoc.nl and GCs empty buckets.",
    16: "Integration with the external depaudit gate: run `depaudit setup` during target onboarding and propagate SOCKET_API_TOKEN / SLACK_WEBHOOK_URL to the target's GitHub Actions secrets. Ships the depaudit-triage Claude skill for reviewing findings.",
}

# Notable as-is findings to surface per subsystem (kept factual)
NOTES = {
    1:  "loadProjectConfig re-parses all .adw/ files on every call (no caching).",
    2:  "generateAdwId uses Math.random() (non-crypto); per-agent writes are non-atomic.",
    3:  "Two parallel boundary builders (launchGitContext + gitContextFactory); guard still allowlists ~25 residual direct git/gh sites.",
    4:  "CLI flags, JSONL field names, and error heuristics are scattered across 4 files — the coupling is not isolated behind one adapter.",
    5:  "CostTracker.commit fires postCostRecordsToD1 without awaiting; runPhasesParallel skips per-phase status writes.",
    6:  "Sync interface signatures force Jira into fire-and-forget placeholders; Bitbucket defined but unimplemented.",
    7:  "review->patch->retest loop copy-pasted across 5 orchestrators; classification parses free-form LLM text with a /feature default-on-failure.",
    8:  "Two parallel plan<->scenario reconcilers (validation-loop vs alignment); step-def generation split between a phase and the TDD loop.",
    9:  "Lock release on crash relies on next-caller staleness reclaim; stage routing split across stageClassifier + inline string checks.",
    10: "Takeover invoked from two paths with duplicated branch handling; dedup split across in-memory maps + on-disk locks.",
    11: "Two near-identical pause paths (rate-limit queue file vs auth-gate state-scan); rate-limit indicator strings hard-coded in multiple files.",
    12: "Hash recomputed at gate and again at regen (TOCTOU window); verifyAdwRegen checks presence, not content validity.",
    13: "Local computed cost is NOT independent — CLI cost copied into both fields, so divergence detection is inert; pricing tables hardcoded.",
    14: "One-off migration incomplete: live index has 221 entries vs the ~40 target / 60 gate — the flat-prime-cost goal is unmet.",
    15: "Worker hardcodes OWNER='paysdoc' while uploads are owner-parameterized; dead screenshotUrls placeholders in the review path.",
    16: "executeDepauditSetup is defined, tested, and gh-guard-allowlisted but NOT invoked by any orchestrator — the adw_init wiring is absent.",
}

GRAY = "#888888"


def esc(s):
    return s.replace("\n", "\\n")


def render(name, dot_src):
    src = os.path.join(IMG, name + ".dot")
    out = os.path.join(IMG, name + ".png")
    with open(src, "w") as f:
        f.write(dot_src)
    subprocess.run(["dot", "-Tpng", "-Gdpi=160", src, "-o", out], check=True)
    return out


def node_block(nid, fill, fontcolor="white", penwidth=1, color="#222222"):
    label, _ = SUBSYSTEMS[nid]
    return (f'  {nid} [label="{nid}. {esc(label)}", fillcolor="{fill}", '
            f'fontcolor="{fontcolor}", color="{color}", penwidth={penwidth}];\n')


# ---------------------------------------------------------------------------
# Diagram 1: master architecture (layered, all nodes + all edges)
# ---------------------------------------------------------------------------
def diagram_master():
    s = ['digraph G {', '  rankdir=BT; bgcolor="white"; compound=true;',
         '  node [shape=box, style="rounded,filled", fontname="Helvetica", '
         'fontsize=11, width=1.5, height=0.7, margin="0.08,0.05"];',
         '  edge [color="#bbbbbb", arrowsize=0.6, penwidth=0.8];',
         '  graph [fontname="Helvetica", fontsize=13, ranksep=0.55, nodesep=0.3];']
    for layer in LAYER_ORDER:
        ids = [i for i, (_, l) in SUBSYSTEMS.items() if l == layer]
        s.append(f'  subgraph cluster_{layer} {{')
        s.append(f'    label="{LAYER_LABELS[layer]}"; style="rounded,filled"; '
                 f'fillcolor="#f4f4f6"; color="#dddddd"; fontcolor="#555555";')
        for i in ids:
            s.append(node_block(i, LAYER_COLOR[layer]))
        s.append('    {rank=same; ' + '; '.join(str(i) for i in ids) + ';}')
        s.append('  }')
    for a, b, _ in EDGES:
        s.append(f'  {a} -> {b};')
    s.append('}')
    return render("master", "\n".join(s))


# ---------------------------------------------------------------------------
# Diagram 2: dependency layers (clean, no edges — just the stack)
# ---------------------------------------------------------------------------
def diagram_layers():
    s = ['digraph G {', '  rankdir=BT; bgcolor="white";',
         '  node [shape=box, style="rounded,filled", fontname="Helvetica", '
         'fontsize=12, fontcolor="white", width=1.7, height=0.6];',
         '  edge [style=invis];',
         '  graph [fontname="Helvetica", fontsize=14, ranksep=0.4, nodesep=0.25];']
    prev_first = None
    for layer in LAYER_ORDER:
        ids = [i for i, (_, l) in SUBSYSTEMS.items() if l == layer]
        s.append(f'  subgraph cluster_{layer} {{')
        s.append(f'    label="{LAYER_LABELS[layer]}"; labeljust="l"; '
                 f'style="rounded,filled"; fillcolor="{LAYER_COLOR[layer]}22"; '
                 f'color="{LAYER_COLOR[layer]}"; fontcolor="{LAYER_COLOR[layer]}"; fontsize=15;')
        for i in ids:
            s.append(node_block(i, LAYER_COLOR[layer]))
        s.append('    {rank=same; ' + '; '.join(str(i) for i in ids) + ';}')
        s.append('  }')
        if prev_first is not None:
            s.append(f'  {prev_first} -> {ids[0]};')
        prev_first = ids[0]
    s.append('}')
    return render("layers", "\n".join(s))


# ---------------------------------------------------------------------------
# Diagram 3: data flow — a single issue's life through the pipeline
# ---------------------------------------------------------------------------
def diagram_flow():
    steps = [
        ("GitHub issue", "#214d8a"),
        ("10. Trigger\n(cron/webhook)", "#214d8a"),
        ("9. Coordination\nspawn lock + takeover", "#7a2f4a"),
        ("12. Upgrade gate\n(hash check)", "#7a2f4a"),
        ("7. Classify +\nPlan", "#7a5230"),
        ("8. Scenarios\n+ step defs", "#7a5230"),
        ("7. Build\n(/implement)", "#7a5230"),
        ("8. Scenario test\n+ fix loop", "#7a5230"),
        ("7. Review\n+ patch", "#7a5230"),
        ("15. Proof\nscreenshots", "#7a5230"),
        ("14. Document", "#7a5230"),
        ("11. Auto-merge\ngate", "#7a2f4a"),
        ("Merged PR", "#2f6b6b"),
    ]
    s = ['digraph G {', '  rankdir=LR; bgcolor="white";',
         '  node [shape=box, style="rounded,filled", fontname="Helvetica", '
         'fontsize=11, fontcolor="white", width=1.4, height=0.7, margin="0.08,0.05"];',
         '  edge [color="#888888", arrowsize=0.7];',
         '  graph [ranksep=0.35, nodesep=0.2];']
    for idx, (label, color) in enumerate(steps):
        s.append(f'  n{idx} [label="{esc(label)}", fillcolor="{color}"];')
    for idx in range(len(steps) - 1):
        s.append(f'  n{idx} -> n{idx+1};')
    # side rail: cross-cutting subsystems feeding the whole pipeline
    s.append('  rail [label="Cross-cutting: 1 Config · 2 State · 3 GitContext · '
             '4 Agent exec · 5 Phase runner · 6 Providers · 13 Cost", '
             'shape=note, fillcolor="#33485e", fontsize=10, width=3];')
    s.append('  {rank=sink; rail;}')
    s.append('}')
    return render("flow", "\n".join(s))


# ---------------------------------------------------------------------------
# Detail diagram: one subsystem's neighborhood (in + out edges)
# ---------------------------------------------------------------------------
def diagram_detail(center):
    outs = [(a, b, lbl) for (a, b, lbl) in EDGES if a == center]
    ins = [(a, b, lbl) for (a, b, lbl) in EDGES if b == center]
    neighbors = set()
    for a, b, _ in outs + ins:
        neighbors.add(a); neighbors.add(b)
    neighbors.discard(center)
    s = ['digraph G {', '  rankdir=LR; bgcolor="white";',
         '  node [shape=box, style="rounded,filled", fontname="Helvetica", '
         'fontsize=11, width=1.5, height=0.6, margin="0.08,0.05"];',
         '  edge [fontname="Helvetica", fontsize=8, color="#999999", '
         'fontcolor="#555555", arrowsize=0.6];',
         '  graph [ranksep=1.6, nodesep=0.18];']
    clayer = SUBSYSTEMS[center][1]
    s.append(node_block(center, LAYER_COLOR[clayer], penwidth=3, color="#111111"))
    for n in sorted(neighbors):
        nlayer = SUBSYSTEMS[n][1]
        s.append(node_block(n, LAYER_COLOR[nlayer] + "bb", color="#cccccc"))
    for a, b, lbl in outs:
        s.append(f'  {a} -> {b} [label="{esc(lbl)}", color="#7a2f4a", penwidth=1.4];')
    for a, b, lbl in ins:
        s.append(f'  {a} -> {b} [label="{esc(lbl)}", color="#2f6b6b", penwidth=1.4, style=dashed];')
    s.append('}')
    return render(f"detail_{center}", "\n".join(s))


# ---------------------------------------------------------------------------
# PPTX assembly
# ---------------------------------------------------------------------------
INK = RGBColor(0x22, 0x22, 0x2a)
MUTED = RGBColor(0x66, 0x66, 0x70)
ACCENT = RGBColor(0x21, 0x4d, 0x8a)
PANEL = RGBColor(0xf4, 0xf4, 0xf6)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
SW, SH = prs.slide_width, prs.slide_height


def add_text(slide, x, y, w, h, text, size, color=INK, bold=False,
             align=PP_ALIGN.LEFT, font="Helvetica", anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    para = tf.paragraphs[0]
    para.alignment = align
    run = para.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    return tb


def add_band(slide, color, h=Inches(1.15)):
    band = slide.shapes.add_shape(1, 0, 0, SW, h)
    band.fill.solid()
    band.fill.fore_color.rgb = color
    band.line.fill.background()
    band.shadow.inherit = False
    return band


def fit_image(slide, path, x, y, max_w, max_h):
    from PIL import Image as _I
    try:
        iw, ih = _I.open(path).size
    except Exception:
        pic = slide.shapes.add_picture(path, x, y, width=max_w)
        return pic
    ratio = min(max_w / iw, max_h / ih)
    w = int(iw * ratio); h = int(ih * ratio)
    px = x + int((max_w - w) / 2)
    py = y + int((max_h - h) / 2)
    return slide.shapes.add_picture(path, px, py, width=w, height=h)


# --- Title slide ---
s0 = prs.slides.add_slide(BLANK)
bg = s0.shapes.add_shape(1, 0, 0, SW, SH)
bg.fill.solid(); bg.fill.fore_color.rgb = RGBColor(0x1b, 0x2a, 0x3a)
bg.line.fill.background(); bg.shadow.inherit = False
add_text(s0, Inches(0.9), Inches(2.2), Inches(11.5), Inches(1.4),
         "ADW — Architecture Reference", 40, RGBColor(0xff, 0xff, 0xff), bold=True)
add_text(s0, Inches(0.9), Inches(3.5), Inches(11.5), Inches(0.8),
         "16 functional subsystems · as-is · dependency order", 20,
         RGBColor(0xc9, 0xd4, 0xe0))
add_text(s0, Inches(0.9), Inches(5.9), Inches(11.5), Inches(0.8),
         "Each subsystem plotted against the pipeline and its interaction neighborhood. "
         "Ground truth: source code. Companion: rewrite/*.md specs + suggestions.txt.",
         13, RGBColor(0x9a, 0xa8, 0xb8))

# --- Overview slide helper ---
def overview_slide(title, subtitle, img, footnote):
    sl = prs.slides.add_slide(BLANK)
    add_band(sl, ACCENT)
    add_text(sl, Inches(0.5), Inches(0.18), Inches(12.3), Inches(0.6),
             title, 26, RGBColor(0xff, 0xff, 0xff), bold=True)
    add_text(sl, Inches(0.5), Inches(0.74), Inches(12.3), Inches(0.4),
             subtitle, 13, RGBColor(0xd5, 0xde, 0xea))
    fit_image(sl, img, Inches(0.4), Inches(1.3),
              Inches(12.5), Inches(5.4))
    add_text(sl, Inches(0.5), Inches(6.95), Inches(12.3), Inches(0.4),
             footnote, 10, MUTED)
    return sl

# --- Overview 1: master ---
overview_slide(
    "Master Architecture",
    "All 16 subsystems, grouped into six dependency layers. Arrows: “calls / depends on”.",
    diagram_master(),
    "Read bottom-up: substrate (L0) → I/O authorities (L1) → composition (L2) → pipeline & content (L3) "
    "→ coordination & governance (L4) → entry points (L5).")

# --- Overview 2: layers ---
overview_slide(
    "Dependency Layers — Build Order",
    "The order to (re)implement: each layer depends only on the ones beneath it.",
    diagram_layers(),
    "This ordering also indexes the rewrite/NN-*.md specs. Lower layers are model-agnostic substrate; "
    "the model coupling concentrates in 4 (Agent execution) and 13 (Cost).")

# --- Overview 3: data flow ---
overview_slide(
    "Data Flow — One Issue's Life",
    "A single GitHub issue traversing the pipeline, with cross-cutting subsystems feeding every step.",
    diagram_flow(),
    "Linear happy path. Coordination (9), upgrade (12), and auto-merge (11) gate the flow; "
    "cross-cutting subsystems (rail) are invoked throughout.")

# --- Detail slides ---
def detail_slide(nid):
    sl = prs.slides.add_slide(BLANK)
    label = SUBSYSTEMS[nid][0].replace("\n", " ")
    layer = SUBSYSTEMS[nid][1]
    band = add_band(sl, RGBColor.from_string(LAYER_COLOR[layer].lstrip("#")))
    add_text(sl, Inches(0.5), Inches(0.16), Inches(12.3), Inches(0.55),
             f"{nid}. {label}", 24, RGBColor(0xff, 0xff, 0xff), bold=True)
    add_text(sl, Inches(0.5), Inches(0.72), Inches(12.3), Inches(0.35),
             f"{LAYER_LABELS[layer]}", 12, RGBColor(0xe0, 0xe6, 0xee))
    # left: diagram
    fit_image(sl, diagram_detail(nid), Inches(0.3), Inches(1.3),
              Inches(8.1), Inches(5.5))
    # right: caption + note panel
    px = Inches(8.6)
    pw = Inches(4.45)
    panel = sl.shapes.add_shape(1, px, Inches(1.35), pw, Inches(5.4))
    panel.fill.solid(); panel.fill.fore_color.rgb = PANEL
    panel.line.color.rgb = RGBColor(0xdd, 0xdd, 0xe2)
    panel.shadow.inherit = False
    add_text(sl, px + Inches(0.2), Inches(1.5), pw - Inches(0.4), Inches(0.3),
             "WHAT IT DOES", 11, ACCENT, bold=True)
    add_text(sl, px + Inches(0.2), Inches(1.85), pw - Inches(0.4), Inches(2.6),
             CAPTIONS[nid], 12, INK)
    add_text(sl, px + Inches(0.2), Inches(4.75), pw - Inches(0.4), Inches(0.3),
             "AS-IS NOTE", 11, RGBColor(0x9a, 0x2a, 0x2a), bold=True)
    add_text(sl, px + Inches(0.2), Inches(5.1), pw - Inches(0.4), Inches(1.5),
             NOTES[nid], 11, MUTED)
    # legend
    add_text(sl, Inches(0.4), Inches(6.95), Inches(8), Inches(0.4),
             "Solid red → this subsystem calls out · Dashed teal → called by · spec: rewrite/%02d-*.md" % nid,
             10, MUTED)
    return sl

# detail slides in dependency order
DETAIL_ORDER = [1, 2, 3, 4, 6, 5, 13, 7, 8, 14, 15, 16, 9, 11, 12, 10]
for nid in DETAIL_ORDER:
    detail_slide(nid)

out = os.path.join(HERE, "adw-architecture.pptx")
prs.save(out)
print("Saved", out, "with", len(prs.slides._sldIdLst), "slides")
