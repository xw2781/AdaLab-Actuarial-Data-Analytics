# AGENTS.md

This is the ArcRho monorepo root. Use one Git repository here for all ArcRho components.

## Repository Layout
- `frontend/`: current ArcRho desktop/web UI, Electron host, backend service code currently bundled with the frontend app, docs, release fragments, and frontend-specific agent rules.
- `data-engine/`: ArcRho data-engine component.
- `tools/`: repository-level automation, including commit/push helpers for agents.

## Mandatory Read Before Editing
Before changing files under `frontend/`, read `frontend/AGENTS.md`.

## Bug Fix Cleanup Review
When fixing a bug, remove clearly obsolete code in the touched area. Ask before broader cleanup or cleanup with behavior risk.

## Validation Runtime Limit
No validation command should run for more than 120 seconds by default. Use targeted fast checks first, and put tests, docs checks, syntax checks, and smoke checks behind a timeout of 120 seconds or less. If a broader validation is expected to exceed 120 seconds, ask before running it and explain why the longer run is needed. When a validation times out, stop it and report the timeout instead of retrying indefinitely.
