# Feature template

Rule: follow existing patterns. Add no abstraction the issue does not need.

```md
# Feature: <feature name>

## Metadata
issueNumber: `{issueNumber}`
adwId: `{adwId}`
issueJson: `{issueJson}`

## Problem Statement
<the need or opportunity this feature addresses>

## Solution Statement
<the approach and how it fits existing patterns>

## Relevant Files
- `<path>`: <why the tasks need to read it>

### Files to Change
- `<path>`: <what changes>

### New Files
- `<path>`: <purpose>

## Step by Step Tasks
### 1. <foundational task>
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
