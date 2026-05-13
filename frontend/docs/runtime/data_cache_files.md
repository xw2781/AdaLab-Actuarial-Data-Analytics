# Runtime: Data and Cache Files

## Purpose
<!-- MANUAL:BEGIN -->
Index cache/data files and refresh points used by app-server services.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN runtime.data_cache_files.entry_points -->
| Method | Path | Domain | Handler |
| --- | --- | --- | --- |
| `POST` | `/arcrho/headers/cache/clear` | `arcrho` | `clear_arcrho_headers_cache` |
| `POST` | `/arcrho/tri/refresh` | `arcrho` | `arcrho_tri_refresh` |
| `POST` | `/dfm/method-index/refresh` | `dfm_method_index` | `refresh_dfm_method_index` |
| `POST` | `/reserving_class_values/refresh` | `reserving_class` | `refresh_reserving_class_values` |
| `GET` | `/table_summary` | `table_summary` | `get_table_summary` |
| `POST` | `/table_summary/refresh` | `table_summary` | `refresh_table_summary` |
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN runtime.data_cache_files.key_files -->
- [`app_server/config.py`](../../app_server/config.py) - Cache/data file names and lock constants.

Cache/lock constants detected:
- `AUDIT_LOG_FILE`
- `DATASET_TYPES_FILE`
- `FIELD_MAPPING_FILE`
- `FOLDER_STRUCTURE_FILE`
- `GENERAL_SETTINGS_FILE`
- `PROJECT_SETTINGS_XLSX_FILE`
- `RESERVING_CLASS_COMBINATIONS_FILE`
- `RESERVING_CLASS_FILTER_SPEC_PREF_FILE`
- `RESERVING_CLASS_PATH_TREE_FILE`
- `RESERVING_CLASS_TYPES_FILE`
- `RESERVING_CLASS_VALUES_FILE`
- `SCRIPTING_PREFS_FILE`
- `_AUDIT_LOG_LOCK`
- `_RESERVING_CLASS_FILTER_SPEC_LOCK`
- `_RESERVING_CLASS_PATH_TREE_LOCK`
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Cache refresh is exposed via route endpoints and service calls.
- Several caches are project-folder scoped; others are user AppData scoped.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- File names and limits are defined in `app_server/config.py` constants.
- Refresh endpoints can clear and rebuild cache files.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Add cache file constant: update config, service readers/writers, and this index.
2. Change refresh logic: verify endpoint side effects and lock behavior.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Cache invalidation bugs can surface as stale or mismatched UI data.
- File locking can fail writes under concurrent access.
<!-- MANUAL:END -->
