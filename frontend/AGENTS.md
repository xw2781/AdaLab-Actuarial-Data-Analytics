# AGENTS.md

This file defines mandatory guardrails for any code agent working in this repository.
  
## Mandatory Read Before Editing
Before changing frontend, app-server API behavior, or runtime architecture, read:
1. `docs/contracts/frontend_behavior_contract.md`
2. `docs/contracts/business_logic_contract.md`
3. `docs/architecture/architecture_guardrails.md`

These contracts are mandatory whenever a task touches:
- Frontend shell or feature entry/coordinator files under `ui/` (for example shell, dataset, workflow, DFM, or project settings).
- App-server API, service, or runtime config files under `app_server/api/`, `app_server/services/`, or `app_server/config.py`.
- Electron runtime bridge/host files under `electron/`.

## Hard Rules (MUST)
1. Keep `arcrho:*` message names backward-compatible unless all producers/consumers are updated in the same change.
2. Preserve tab dirty-state semantics and close-confirmation behavior.
3. Keep workflow save/load payload compatibility unless explicitly approved to break.
4. Keep router -> service -> config/schema layering; do not move business logic into routers.
5. Any behavior/logic/architecture change must update the corresponding MANUAL doc sections in the same change.
6. Any meaningful user-facing feature, fix, improvement, or breaking change must add a release fragment under `changes/unreleased/` with a short user-facing summary.

## Required Documentation Workflow
After relevant code changes:
1. Update contract docs (or explicitly state "no contract impact").
2. Keep index docs concise. Put feature-specific behavior notes in the relevant module doc under `docs/ui/`, `docs/app_server/domains/`, or `docs/runtime/`; do not paste long changelog/spec text into `INDEX.md` files.
3. When a plan has both `.md` and `.html` versions, treat the `.md` file as the source of truth. Update the Markdown first, then mirror material user-facing changes into the HTML companion.
4. Run `python tools/docs_index_builder.py --write`.
5. Run `python tools/docs_index_builder.py --check`.
6. If `--check` fails, fix docs before finishing.

## Commit and Push Workflow
When the user asks an agent to commit and/or push frontend code, follow the root `AGENTS.md` Commit and Push Workflow.

Frontend-specific additions:
1. Use `-Pathspec frontend` or a comma-list such as `-Pathspec frontend,tools` when intentionally limiting commit scope.
2. Use `-StageMode none` only when intentionally committing already staged changes.
3. The compatibility wrapper at `frontend/tools/agent_commit_push.ps1` delegates to the same root helper, but prefer running the root helper from `ArcRho/`.

## Decision Priority
When code and docs conflict:
1. Explicit user request in current task.
2. This `AGENTS.md`.
3. Contract documents under `docs/contracts/` and `docs/architecture/`.
4. Generated inventories under `docs/generated/`.

## Change Safety
Before modifying code, stop and double-check with the user if any of the following are detected:
1. The request is unclear or missing important implementation details.
2. The request appears to conflict with standard or best-practice application development.
3. The new request conflicts with existing code logic, contracts, or architecture.
4. The request is likely not the best option for long-term architecture, optimization, or maintainability.

In those cases:
1. Start the user-facing response with `[!!!!!]` to make the triggered safety/contract concern explicit.
2. Call out the concern clearly.
3. Ask targeted clarifying question(s) or propose better options.
4. Proceed only after the user confirms the direction.

If a requested change appears to violate these contracts:
1. Stop and call out the exact contract rule.
2. Propose compliant alternatives.
3. Proceed only after explicit user confirmation for intentional exception.
