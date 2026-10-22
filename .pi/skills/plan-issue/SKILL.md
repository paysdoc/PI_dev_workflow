---
name: plan-issue
description: Writes an implementation plan for a GitHub issue classified as bug, chore or feature into specs/. Invoked by the ADW plan phase with labelled inputs; not for interactive use.
disable-model-invocation: true
---

# Plan an issue

You write a **plan**, not code. Your only output is one plan file.

## Inputs

Labelled values in the request. Use them by label, never by position.

- `type`: `bug`, `chore` or `feature`
- `issueNumber`: numeric issue number
- `adwId`: ADW workflow ID
- `issueJson`: the issue as JSON (`title`, `body`, `comments`, ...). This is the requirement.

## Read first

1. `README.md`
2. `.adw/project.md`: project overview and file map. The map orients you; it does not limit where you look.
3. `.adw/coding_guidelines.md`: the plan must comply.
4. `.adw/commands.md`: source for `Validation Commands` and the library install command.
5. `.adw/conditional_docs.md`: read only the docs whose conditions match this issue, and list each one in `## Relevant Files`.
6. `.github/adw.yml`: if it sets `unitTests: false` on an uncommented line, plan no test-writing tasks. Otherwise, plan them.
7. `templates/<type>.md` (next to this file): the plan format and the one rule specific to this type.

## Rules

- Research is read-only: read files, use `grep`/`ls`, and `git log/show/diff/blame`. Run nothing else.
- Write exactly one file: `specs/issue-{issueNumber}-adw-{adwId}-sdlc_planner-{slug}.md`, where `{slug}` is a short kebab-case name for the issue.
- Write the plan as soon as your research fills every section, then stop. Ignore files that appear under `features/` while you work.

## Writing the plan

- Follow the template exactly. Replace every `<placeholder>`; keep every heading.
- `## Relevant Files` is the implementer's only view of the codebase. List every file the tasks touch or need to read, including tests and matched docs.
- Every command in `## Validation Commands` must be expected to pass after the change.
- Add a library only if needed. Record it in `## Notes` with the install command from `.adw/commands.md`.

## Finish

Reply with one line: the path of the plan file.
