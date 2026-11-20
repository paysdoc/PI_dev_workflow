# Chore template

Rule: no behaviour change beyond what the chore asks for.

```md
# Chore: <chore name>

## Metadata
issueNumber: `{issueNumber}`
adwId: `{adwId}`
issueJson: `{issueJson}`

## Problem Statement
<what needs doing and why>

## Solution Statement
<how the chore will be done>

## Relevant Files
- `<path>`: <why the tasks need to read it>

### Files to Change
- `<path>`: <what changes>

### New Files
- `<path>`: <purpose>

## Step by Step Tasks
### 1. <task>
- <bullets>
Files: `<path>`, `<path>`
Tests: `<test path>`

### <last>. Run the Validation Commands
Files: none
Tests: none: validation only

## Acceptance Criteria
- <measurable outcome, including edge cases>

## Validation Commands
- `<command>`

## Notes
<optional>

### Dependencies
- `<package>`: `<install command>`
```
