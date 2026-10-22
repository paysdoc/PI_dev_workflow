# Bug template

Rule: fix the root cause with the minimum change. Nothing beyond the bug.

```md
# Bug: <bug name>

## Metadata
issueNumber: `{issueNumber}`
adwId: `{adwId}`
issueJson: `{issueJson}`

## Problem Statement
<the defect: expected vs actual behaviour>

## Solution Statement
<the fix and why it addresses the root cause>

## Steps to Reproduce
<exact steps that trigger the bug>

## Root Cause Analysis
Hypothesis (not verified by running anything): <the cause, citing file:line evidence>

## Relevant Files
- `<path>`: <why it is relevant>

### New Files
- `<path>`: <purpose>

## Step by Step Tasks
### 1. Write a test that reproduces the bug
- <omit this task if unit tests are disabled>

### <n>. <task>
- <bullets>

### <last>. Run the Validation Commands

## Acceptance Criteria
- <measurable outcome, including edge cases>

## Validation Commands
- `<command>`

## Notes
<optional; required for new dependencies>
```
