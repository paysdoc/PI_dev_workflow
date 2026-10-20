#!/usr/bin/env python3
"""
Build a static HTML site from the rewrite/*.md subsystem reference docs.

Output: rewrite/site/
  - index.html                 landing page with master/flow/layer diagrams + grid of 16 cards
  - 01-config-and-environment.html ... 16-supply-chain.html  one page per subsystem
  - assets/style.css           shared stylesheet
  - assets/img/                copied diagrams (detail_N.png, master.png, flow.png, layers.png)

Narrative:
  index -> 01 -> 02 -> ... -> 16, with prev/next footer, sidebar, and auto-linked
  cross-references ("subsystem N", "N. Name", "(N) Name") pointing to the right page.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "site"
ASSETS = OUT / "assets"
IMG_OUT = ASSETS / "img"

MD_FILES = sorted(p for p in ROOT.glob("[0-9][0-9]-*.md"))

# ---------- discover sections ----------

def section_meta(path: Path) -> dict:
    """Extract number + title from first `# NN. Title` line."""
    first = path.read_text(encoding="utf-8").splitlines()[0]
    m = re.match(r"^#\s*(\d+)\.\s*(.+)$", first.strip())
    if not m:
        raise ValueError(f"Can't parse heading of {path.name}: {first!r}")
    num = int(m.group(1))
    title = m.group(2).strip()
    slug = path.stem  # e.g. 01-config-and-environment
    return {"num": num, "title": title, "slug": slug, "path": path,
            "href": f"{slug}.html"}

SECTIONS = [section_meta(p) for p in MD_FILES]
BY_NUM = {s["num"]: s for s in SECTIONS}

# ---------- markdown -> html ----------

MD = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])

def _fix_header_only_tables(md_text: str) -> str:
    """python-markdown's `tables` extension needs a `|---|---|` separator row.
    A few docs ship pipe-tables without it; synthesize one from the header's column count."""
    out = []
    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        is_pipe_row = line.lstrip().startswith("|") and line.rstrip().endswith("|")
        next_line = lines[i + 1] if i + 1 < len(lines) else ""
        next_is_sep = bool(re.match(r"^\s*\|?\s*:?-{3,}", next_line))
        next_is_pipe = next_line.lstrip().startswith("|")
        if is_pipe_row and next_is_pipe and not next_is_sep:
            # count columns in the header
            cols = [c for c in line.strip().strip("|").split("|")]
            out.append(line)
            out.append("|" + "|".join([" --- "] * len(cols)) + "|")
            i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)

def convert_body(md_text: str) -> str:
    # drop the leading H1 (we render our own header) and the blockquote right under it
    lines = md_text.splitlines()
    i = 0
    if lines and lines[0].startswith("# "):
        i = 1
        while i < len(lines) and (lines[i].strip().startswith(">") or not lines[i].strip()):
            i += 1
    body = "\n".join(lines[i:])
    body = _fix_header_only_tables(body)
    MD.reset()
    return MD.convert(body)

# ---------- cross-reference auto-linking ----------

# Match patterns like:
#   "subsystem 14"
#   "subsystem 14 (Docs...)"
#   "(1. Config & Environment)"
#   "7. Phases & orchestrators"   (used inside tables / lists)
#   "subsystems 9/10"
# We keep it conservative: only linkify explicit numeric mentions.

NUM_WORD = r"(?P<n>\d{1,2})"
PATTERNS = [
    re.compile(rf"\bsubsystems?\s+{NUM_WORD}\b", re.IGNORECASE),
    re.compile(rf"\(\s*{NUM_WORD}\.\s[^)]*\)"),             # "(7. Phases ...)"
    re.compile(rf"\(#{NUM_WORD}\)"),                           # "(#7)"
    re.compile(rf"(?<![\w#]){NUM_WORD}\.\s(?=[A-Z])"),        # start of a table-cell "7. Phases ..."
    re.compile(rf"(?<=>){NUM_WORD}\s(?=[A-Z])"),               # HTML table-cell "<td>7 Phases ..." (no dot)
    re.compile(rf"#{NUM_WORD}(?!\d)(?=[\s,.;:)])"),            # bare "#7" (e.g. in prose)
]

def linkify_cross_refs(html: str, current_num: int) -> str:
    """Linkify subsystem references in the already-rendered HTML.
    We avoid rewriting inside <a>...</a> and inside <code>...</code>."""

    # split html into safe/unsafe chunks: anything inside <a or <code> is skipped
    protect_re = re.compile(r"(<a\b[^>]*>.*?</a>|<code\b[^>]*>.*?</code>|<pre\b[^>]*>.*?</pre>)",
                            re.DOTALL | re.IGNORECASE)

    def repl_in_chunk(chunk: str) -> str:
        for pat in PATTERNS:
            def _one(m: re.Match) -> str:
                n = int(m.group("n"))
                if n not in BY_NUM or n == current_num:
                    return m.group(0)
                target = BY_NUM[n]
                return f'<a class="xref" href="{target["href"]}" title="{target["num"]:02d}. {target["title"]}">{m.group(0)}</a>'
            chunk = pat.sub(_one, chunk)
        return chunk

    out = []
    pos = 0
    for m in protect_re.finditer(html):
        out.append(repl_in_chunk(html[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(repl_in_chunk(html[pos:]))
    return "".join(out)

# ---------- page template ----------

CSS = """\
:root {
  --bg: #0f1419;
  --bg-alt: #161b22;
  --panel: #1b222b;
  --border: #273040;
  --text: #d7dde6;
  --text-dim: #8a94a7;
  --accent: #6cb6ff;
  --accent-strong: #4a9eff;
  --accent-soft: #1f3147;
  --code-bg: #11161d;
  --warn: #e5c07b;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.55; }

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-strong); text-decoration: underline; }

/* ---- top bar ---- */
header.topbar {
  position: sticky; top: 0; z-index: 10;
  background: rgba(15,20,25,.92);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border);
  padding: .75rem 1.25rem;
  display: flex; align-items: center; gap: 1rem;
}
header.topbar .brand { font-weight: 700; letter-spacing: .02em; }
header.topbar .brand a { color: var(--text); }
header.topbar .crumbs { color: var(--text-dim); font-size: .9rem; }
header.topbar .spacer { flex: 1; }
header.topbar .pager { font-size: .85rem; color: var(--text-dim); }
header.topbar .pager a { margin-left: .5rem; }

/* ---- layout ---- */
.layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 50px); }

aside.sidebar {
  background: var(--bg-alt);
  border-right: 1px solid var(--border);
  padding: 1rem 0;
  overflow-y: auto;
  position: sticky; top: 50px; height: calc(100vh - 50px);
}
aside.sidebar h3 {
  margin: 0 1rem .5rem; font-size: .72rem; letter-spacing: .14em;
  text-transform: uppercase; color: var(--text-dim);
}
aside.sidebar ol { list-style: none; margin: 0; padding: 0; }
aside.sidebar li a {
  display: flex; gap: .6rem; padding: .4rem 1rem;
  color: var(--text); font-size: .9rem; border-left: 3px solid transparent;
}
aside.sidebar li a:hover { background: var(--panel); text-decoration: none; }
aside.sidebar li a.current {
  background: var(--accent-soft); border-left-color: var(--accent);
  color: #fff; font-weight: 600;
}
aside.sidebar li a .num { color: var(--text-dim); font-variant-numeric: tabular-nums; min-width: 1.6em; }
aside.sidebar li a.current .num { color: var(--accent); }

main.content { padding: 2rem 2.5rem 4rem; max-width: 1050px; }

.hero {
  background: linear-gradient(145deg, #15202c 0%, #1b2838 100%);
  border: 1px solid var(--border); border-radius: 10px;
  padding: 1.5rem 1.75rem; margin-bottom: 1.75rem;
}
.hero .eyebrow { color: var(--accent); font-weight: 600; letter-spacing: .06em; font-size: .78rem; text-transform: uppercase; }
.hero h1 { margin: .25rem 0 .5rem; font-size: 2rem; }
.hero .lede { color: var(--text-dim); max-width: 70ch; }

.detail-figure {
  margin: 1.5rem 0 2rem; padding: 1rem; background: var(--panel);
  border: 1px solid var(--border); border-radius: 8px; text-align: center;
}
.detail-figure img { max-width: 100%; height: auto; border-radius: 4px; background: #fff; padding: 8px; }
.detail-figure figcaption { margin-top: .6rem; color: var(--text-dim); font-size: .85rem; }

h2 { margin-top: 2rem; padding-bottom: .25rem; border-bottom: 1px solid var(--border); font-size: 1.3rem; }
h3 { margin-top: 1.5rem; font-size: 1.05rem; color: #e5ecf5; }

p, li { font-size: .95rem; }
code { font-family: var(--mono); background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: .86em; border: 1px solid #222b36; }
pre { background: var(--code-bg); border: 1px solid var(--border); padding: 1rem; border-radius: 8px; overflow-x: auto; }
pre code { background: transparent; border: 0; padding: 0; }

ul, ol { padding-left: 1.3rem; }
li { margin: .2rem 0; }

table { border-collapse: collapse; margin: 1rem 0; width: 100%; font-size: .88rem; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: .5rem .7rem; text-align: left; vertical-align: top; }
th { background: var(--panel); font-weight: 600; color: #e8eef7; }
tr:nth-child(even) td { background: rgba(255,255,255,.015); }

a.xref { border-bottom: 1px dotted var(--accent); }
a.xref::after { content: " ↗"; font-size: .7em; opacity: .6; }

/* ---- footer pager ---- */
nav.footer-pager {
  margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
  display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
}
nav.footer-pager a {
  display: block; padding: 1rem 1.2rem; background: var(--panel);
  border: 1px solid var(--border); border-radius: 8px;
}
nav.footer-pager a:hover { border-color: var(--accent); text-decoration: none; }
nav.footer-pager .dir { color: var(--text-dim); font-size: .78rem; text-transform: uppercase; letter-spacing: .1em; }
nav.footer-pager .ttl { font-weight: 600; margin-top: .25rem; color: #fff; }
nav.footer-pager .next { text-align: right; }

/* ---- index-only ---- */
.diagram-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.5rem 0 2rem; }
.diagram-row .detail-figure { margin: 0; }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin-top: 1rem; }
.card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 1rem 1.1rem; display: block; color: inherit; transition: all .12s ease;
}
.card:hover { border-color: var(--accent); transform: translateY(-2px); text-decoration: none; }
.card .num {
  display: inline-block; font-variant-numeric: tabular-nums;
  color: var(--accent); font-weight: 700; font-size: .82rem; letter-spacing: .08em;
}
.card h3 { margin: .25rem 0 .4rem; font-size: 1rem; color: #fff; }
.card p { margin: 0; color: var(--text-dim); font-size: .85rem; }

.start-cta { margin-top: 2rem; text-align: center; }
.start-cta a {
  display: inline-block; padding: .8rem 1.6rem; background: var(--accent-strong);
  color: #0f1419; font-weight: 700; border-radius: 999px; letter-spacing: .02em;
}
.start-cta a:hover { background: var(--accent); color: #0f1419; text-decoration: none; }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  aside.sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  main.content { padding: 1.25rem; }
  .diagram-row { grid-template-columns: 1fr; }
}
"""

def render_sidebar(current_num: int | None) -> str:
    items = []
    for s in SECTIONS:
        cls = "current" if s["num"] == current_num else ""
        items.append(
            f'<li><a class="{cls}" href="{s["href"]}">'
            f'<span class="num">{s["num"]:02d}</span><span>{s["title"]}</span></a></li>'
        )
    index_cls = "current" if current_num is None else ""
    return (
        '<aside class="sidebar">'
        '<h3>Overview</h3>'
        f'<ol><li><a class="{index_cls}" href="index.html">'
        '<span class="num">◆</span><span>Architecture Index</span></a></li></ol>'
        '<h3 style="margin-top:1rem">Subsystems</h3>'
        f'<ol>{"".join(items)}</ol>'
        '</aside>'
    )

def render_topbar(current_num: int | None) -> str:
    if current_num is None:
        crumbs = '<span class="crumbs">Architecture overview</span>'
    else:
        crumbs = f'<span class="crumbs">{current_num:02d} / {len(SECTIONS):02d} — {BY_NUM[current_num]["title"]}</span>'

    # pager links
    prev_link = next_link = ""
    if current_num is None:
        next_link = f'<a href="{SECTIONS[0]["href"]}">Next: {SECTIONS[0]["title"]} →</a>'
    else:
        if current_num == 1:
            prev_link = '<a href="index.html">← Overview</a>'
        else:
            p = BY_NUM[current_num - 1]
            prev_link = f'<a href="{p["href"]}">← {p["title"]}</a>'
        if current_num < len(SECTIONS):
            n = BY_NUM[current_num + 1]
            next_link = f'<a href="{n["href"]}">{n["title"]} →</a>'
    pager = f'<div class="pager">{prev_link}{next_link}</div>'

    return (
        '<header class="topbar">'
        '<div class="brand"><a href="index.html">ADW Architecture</a></div>'
        f'{crumbs}'
        '<div class="spacer"></div>'
        f'{pager}'
        '</header>'
    )

def render_footer_pager(current_num: int) -> str:
    prev_cell = next_cell = ""
    if current_num == 1:
        prev_cell = ('<a href="index.html"><div class="dir">← Back</div>'
                     '<div class="ttl">Architecture overview</div></a>')
    else:
        p = BY_NUM[current_num - 1]
        prev_cell = (f'<a href="{p["href"]}"><div class="dir">← Previous · {p["num"]:02d}</div>'
                     f'<div class="ttl">{p["title"]}</div></a>')
    if current_num < len(SECTIONS):
        n = BY_NUM[current_num + 1]
        next_cell = (f'<a class="next" href="{n["href"]}"><div class="dir">Next · {n["num"]:02d} →</div>'
                     f'<div class="ttl">{n["title"]}</div></a>')
    else:
        next_cell = ('<a class="next" href="index.html"><div class="dir">Back to top ↑</div>'
                     '<div class="ttl">Architecture overview</div></a>')
    return f'<nav class="footer-pager">{prev_cell}{next_cell}</nav>'

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
{topbar}
<div class="layout">
{sidebar}
<main class="content">
{body}
</main>
</div>
</body>
</html>
"""

def render_section_page(s: dict) -> str:
    md_text = s["path"].read_text(encoding="utf-8")
    # pull the blockquote lede if present
    lede = ""
    for line in md_text.splitlines()[1:5]:
        ls = line.strip()
        if ls.startswith(">"):
            lede = ls.lstrip(">").strip()
            break

    body_html = convert_body(md_text)
    body_html = linkify_cross_refs(body_html, s["num"])

    detail_img = f'assets/img/detail_{s["num"]}.png'
    hero = (
        '<section class="hero">'
        f'<div class="eyebrow">Subsystem {s["num"]:02d} of {len(SECTIONS)}</div>'
        f'<h1>{s["title"]}</h1>'
        f'<p class="lede">{lede}</p>'
        '</section>'
    )
    figure = (
        f'<figure class="detail-figure">'
        f'<img src="{detail_img}" alt="Detail diagram for {s["title"]}">'
        f'<figcaption>Figure {s["num"]} — internal structure &amp; data flow of this subsystem</figcaption>'
        f'</figure>'
    )
    body = hero + figure + body_html + render_footer_pager(s["num"])

    return PAGE.format(
        title=f'{s["num"]:02d}. {s["title"]} — ADW Architecture',
        topbar=render_topbar(s["num"]),
        sidebar=render_sidebar(s["num"]),
        body=body,
    )

def render_index_page() -> str:
    cards = []
    for s in SECTIONS:
        # grab the Purpose paragraph for a snippet
        text = s["path"].read_text(encoding="utf-8")
        snippet = ""
        m = re.search(r"##\s*Purpose\s*\n(.+?)(?=\n##\s|\Z)", text, re.DOTALL)
        if m:
            snippet = re.sub(r"\s+", " ", m.group(1)).strip()
            # Trim: first sentence or 180 chars
            sm = re.match(r"(.+?[.!?])\s", snippet)
            if sm:
                snippet = sm.group(1)
            if len(snippet) > 220:
                snippet = snippet[:217].rstrip() + "…"
        cards.append(
            f'<a class="card" href="{s["href"]}">'
            f'<span class="num">SUBSYSTEM {s["num"]:02d}</span>'
            f'<h3>{s["title"]}</h3>'
            f'<p>{snippet}</p>'
            f'</a>'
        )

    body = f"""
<section class="hero">
  <div class="eyebrow">AI Dev Workflow</div>
  <h1>ADW Architecture — As-is Reference</h1>
  <p class="lede">A sixteen-part walkthrough of the ADW (AI Dev Workflow) system,
  layered from the configuration substrate at the bottom through orchestration,
  coordination, and operational concerns at the top. Click through in order for
  the narrative, or jump to any subsystem via the sidebar.</p>
  <div class="start-cta">
    <a href="{SECTIONS[0]['href']}">Start the walkthrough →</a>
  </div>
</section>

<h2>Big picture</h2>
<p>Three cross-cutting views of the full system. Each subsystem page below drills
into a slice of these diagrams.</p>

<figure class="detail-figure">
  <img src="assets/img/master.png" alt="Master architecture diagram">
  <figcaption>Master diagram — every subsystem and its primary edges, in one map.</figcaption>
</figure>

<div class="diagram-row">
  <figure class="detail-figure">
    <img src="assets/img/layers.png" alt="Layered architecture">
    <figcaption>Layers — static dependency stack from env/config up to triggers &amp; HITL.</figcaption>
  </figure>
  <figure class="detail-figure">
    <img src="assets/img/flow.png" alt="Runtime flow">
    <figcaption>Flow — runtime path of a single workflow execution across subsystems.</figcaption>
  </figure>
</div>

<h2>The sixteen subsystems</h2>
<p>Read them in order for the full narrative; each page ends with a “next” link
that follows the same ordering as the sidebar.</p>
<div class="card-grid">
{''.join(cards)}
</div>

<div class="start-cta" style="margin-top:3rem">
  <a href="{SECTIONS[0]['href']}">Begin at 01 — {SECTIONS[0]['title']} →</a>
</div>
"""
    return PAGE.format(
        title="ADW Architecture — Overview",
        topbar=render_topbar(None),
        sidebar=render_sidebar(None),
        body=body,
    )

# ---------- build ----------

def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    ASSETS.mkdir()
    IMG_OUT.mkdir()

    # copy images (only pngs we actually reference)
    for png in (ROOT / "_img").glob("*.png"):
        shutil.copy2(png, IMG_OUT / png.name)

    (ASSETS / "style.css").write_text(CSS, encoding="utf-8")

    (OUT / "index.html").write_text(render_index_page(), encoding="utf-8")
    for s in SECTIONS:
        (OUT / s["href"]).write_text(render_section_page(s), encoding="utf-8")

    print(f"✓ wrote {OUT}/")
    print(f"  index.html + {len(SECTIONS)} section pages + {len(list(IMG_OUT.iterdir()))} images")

if __name__ == "__main__":
    build()
