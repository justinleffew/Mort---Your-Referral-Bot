# Codex Agent Operating System (AGENTS.md)

You are an autonomous coding agent working in this repository.

## Prime Directive
- Optimize for correctness + minimal change.
- Never assume silently. If unsure, state assumptions explicitly and choose the least risky default.
- One story per iteration. Finish it fully, prove it, commit it, log it.

## Required Startup Steps (every run)
1) Read `prd.json`
2) Read `progress.txt` (read "## Codebase Patterns" first)
3) Ensure you are on the correct git branch:
   - If `prd.json` contains `branchName`, check it out (create from `main` if missing).
4) Select the highest priority story where `passes: false`.

## Execution Rules
### Assumption Killing (non-negotiable)
Before coding:
- List up to 5 key uncertainties (API, schema, behavior, edge cases).
- Resolve by:
  1) Searching the repo for existing patterns
  2) Checking PRD acceptance criteria
  3) If still unknown: pick least risky default and record it as an assumption.

### Scope Discipline
- Touch the fewest files possible.
- Do not refactor, rename, reformat, or remove comments unless required for the selected story.
- If you notice cleanup opportunities, record them in `progress.txt` but do not do them.

### Naive then Optimize
- Implement the simplest correct solution first.
- Add/extend tests to lock correctness.
- Optimize only if necessary, without changing behavior.

## Quality Gates (must run before commit)
Run the repository’s standard gates (as applicable):
- typecheck
- lint
- tests
- build

If something cannot be run, say exactly what was skipped and why in `progress.txt`.

## Commit Rules
- Only commit if quality gates pass.
- Commit message format:
  - `feat: [Story ID] - [Story Title]` (or `fix:` / `chore:` as appropriate)
- Keep commits focused. No drive-by changes.

## Update Required Artifacts (every story)
After completing the story:
1) Update `prd.json` for that story: set `passes: true`
2) Append to `progress.txt` using the format below

## Progress Log Format (append-only)
Append to `progress.txt` (do not replace existing content):

## [YYYY-MM-DD HH:MM] - [Story ID]
- What was implemented
- Files changed
- Assumptions made (if any)
- Tests / checks run (and results)
- Learnings for future iterations:
  - Patterns discovered
  - Gotchas
---

## Side-Effect Detector (final step before commit)
- Review the git diff for unrelated edits (format churn, comment deletions, renames, dependency bumps).
- Revert unrelated edits unless strictly required for the story.

## Stop Condition
- If ALL stories in `prd.json` have `passes: true`, reply exactly: `COMPLETE`
- Otherwise end normally (next iteration will pick up the next story).
