# App Server Domain: workflow

## Purpose
<!-- MANUAL:BEGIN -->
Workflow file save/load domain.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN app_server.workflow.entry_points -->
| Method | Path | Handler | Request Model | Schema | Service Calls |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/template/default_dir` | `template_default_dir` | - | - | `workflow_service.get_template_default_dir` |
| `GET` | `/workflow/default_dir` | `workflow_default_dir` | - | - | `workflow_service.get_workflow_default_dir` |
| `POST` | `/workflow/load` | `workflow_load` | `WorkflowLoadRequest` | [`app_server/schemas/workflow.py`](../../../app_server/schemas/workflow.py) | `workflow_service.load_workflow` |
| `POST` | `/workflow/save` | `workflow_save` | `WorkflowSaveRequest` | [`app_server/schemas/workflow.py`](../../../app_server/schemas/workflow.py) | `workflow_service.save_workflow` |
| `POST` | `/workflow/save_as` | `workflow_save_as` | `WorkflowSaveAsRequest` | [`app_server/schemas/workflow.py`](../../../app_server/schemas/workflow.py) | `workflow_service.save_workflow_as` |
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN app_server.workflow.key_files -->
- [`app_server/api/workflow_router.py`](../../../app_server/api/workflow_router.py) - HTTP routes for workflow save/load/default dirs.
- [`app_server/services/workflow_service.py`](../../../app_server/services/workflow_service.py) - Workflow file I/O operations.
- [`app_server/schemas/workflow.py`](../../../app_server/schemas/workflow.py) - Workflow request models.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Consumed primarily by `workflow_main.js`.
- Uses typed request models in `app_server/schemas/workflow.py`.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Reads/writes workflow files under configured workflow directory; saved workflow names use the shared reversible `_%XX_` filename escaping rule for Windows-invalid filename characters.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Add a workflow route: update router + schema + service.
2. Keep backward compatibility when changing saved payload shape.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- File I/O errors and path permissions are common failure modes.
<!-- MANUAL:END -->
