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
- `<path>`: <why it is relevant>

### New Files
- `<path>`: <purpose>

## Step by Step Tasks
### 1. <foundational task>
- <bullets; include test-writing tasks unless unit tests are disabled>

### <last>. Run the Validation Commands

## Acceptance Criteria
- <measurable outcome, including edge cases>

## Validation Commands
- `<command>`

## Notes
<optional; required for new dependencies>
```
