# AGENTS.md

This is the ArcRho monorepo root. Use one Git repository here for all ArcRho components.

## Repository Layout
- `frontend/`: current ArcRho desktop/web UI, Electron host, backend service code currently bundled with the frontend app, docs, release fragments, and frontend-specific agent rules.
- `data-engine/`: ArcRho data-engine component, including the legacy agent/master/shell Python services previously stored under `backend/`.
- `tools/`: repository-level automation, including commit/push helpers for agents.

## Mandatory Read Before Editing
Before making code or documentation edits, run `git branch --show-current`.

If the current branch is `main` and the requested work appears feature-specific, experimental, or tied to an existing non-main branch, stop and ask the user whether to switch branches first.

For ArcBot-related work, use `codex/arcbot` unless the user explicitly asks to work on another branch.

Before changing files under `frontend/`, read `frontend/AGENTS.md` and follow its contracts and documentation workflow.

When future component-specific `AGENTS.md` files are added, read the nearest one before editing that component.

## Commit and Push Workflow
When the user asks an agent to commit and/or push ArcRho code:
1. Inspect the final root-level diff/status and make sure the commit scope matches the current conversation.
2. Decide whether the work should stay on the current branch or move to a new branch. Consider a new branch for larger changes, multi-commit work, experimental changes, PR review, CI validation before merging, or when unrelated local changes make scope separation important. Present the recommendation and ask the user for the final branch decision before committing or pushing.
3. Write a fresh, specific commit message from the actual updates in that conversation. Do not reuse a generic message.
4. Run the root helper from `ArcRho/`:
   `powershell -ExecutionPolicy Bypass -File tools\agent_commit_push.ps1 -Message "Describe the current update"`
5. Use `-DryRun` when reviewing commit scope, `-NoPush` for a local commit only, and a comma-list such as `-Pathspec frontend,data-engine` when intentionally limiting scope.
6. Report the commit hash and push result back to the user.
