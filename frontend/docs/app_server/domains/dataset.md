# App Server Domain: dataset

## Purpose
<!-- MANUAL:BEGIN -->
Dataset retrieval/patch domain for in-memory dataset instances.
Also handles generated/manual dataset file discovery and dataset Notes persistence under each project `data` folder.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN app_server.dataset.entry_points -->
| Method | Path | Handler | Request Model | Schema | Service Calls |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/dataset/notes/load` | `load_dataset_notes` | `DatasetNotesLoadRequest` | [`app_server/schemas/dataset.py`](../../../app_server/schemas/dataset.py) | `dataset_service.load_dataset_notes` |
| `POST` | `/dataset/notes/save` | `save_dataset_notes` | `DatasetNotesSaveRequest` | [`app_server/schemas/dataset.py`](../../../app_server/schemas/dataset.py) | `dataset_service.save_dataset_notes` |
| `GET` | `/dataset/{ds_id}` | `get_dataset` | `str` | - | `dataset_service.get_dataset` |
| `GET` | `/dataset/{ds_id}/diagonal` | `get_diagonal` | `str` | - | `dataset_service.get_diagonal` |
| `POST` | `/dataset/{ds_id}/patch` | `patch_dataset` | `PatchRequest` | [`app_server/schemas/dataset.py`](../../../app_server/schemas/dataset.py) | `dataset_service.patch_dataset` |
| `GET` | `/datasets` | `list_datasets` | - | - | `dataset_service.list_datasets` |
| `GET` | `/datasets/cached` | `list_cached_dataset_names` | `str` | - | `dataset_service.list_cached_dataset_names` |
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN app_server.dataset.key_files -->
- [`app_server/api/dataset_router.py`](../../../app_server/api/dataset_router.py) - Dataset query/patch routes.
- [`app_server/services/dataset_service.py`](../../../app_server/services/dataset_service.py) - Dataset in-memory operations.
- [`app_server/schemas/dataset.py`](../../../app_server/schemas/dataset.py) - Dataset patch request model.
- [`ui/shared/api.js`](../../../ui/shared/api.js) - Frontend client wrapper for dataset API.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Called by dataset/DFM frontend flows via `shared/api.js`.
- Exposes Notes load/save endpoints for project-scoped dataset notes persistence.
- Exposes a project/path cached dataset lookup for Project Instance; the server resolves `project_name` plus selected reserving-class path to both `projects/<project>/data/generated/<ReservingClassFolder>` and `projects/<project>/data/manual/<ReservingClassFolder>`, then returns dataset names inferred from `.csv` files and metadata `.json` sidecars.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Uses in-memory dataset map and patch payloads.
- ArcRhoTri CSV request targets are `projects/<project>/data/generated/<ReservingClassFolder>/<DatasetName>.csv`; the matching metadata sidecar is written as `<DatasetName>.json` in the same folder and records dataset type/instance labels plus shape inputs such as origin/development length. The reserving-class path is a single filename-escaped folder name using the reversible `_%XX_` rule and is not repeated in the CSV filename.
- ArcRhoTri precheck/execution treats missing or shape-mismatched sidecar metadata as a cache miss and rebuilds the generated CSV/JSON pair.
- Persists dataset Notes as JSON files in `projects/<project>/data/manual/<ReservingClassFolder>/ArcRhoTriNotes@<DatasetName>.json`.
- Cached dataset lookup is read-only and scans both generated and manual folders for the selected reserving-class path, matching `.csv` and `.json` filenames/sidecars back to dataset-name candidates after applying the same server-side folder/file sanitizers used by runtime cache writes.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Change patch semantics: align schema, service patch rules, and frontend expectations.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Patch operations can introduce subtle data integrity issues.
<!-- MANUAL:END -->
