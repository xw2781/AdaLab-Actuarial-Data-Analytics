# App Server Domain: Project User Preferences

## Purpose
<!-- MANUAL:BEGIN -->
Project user preference routes store per-Windows-user UI defaults inside each server project folder so shared-server preferences follow the project and user instead of local AppData.
<!-- MANUAL:END -->

## Entry Points
<!-- MANUAL:BEGIN -->
Routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/project-user-preferences?project_name=<name>` | Read the current Windows user's project preference JSON for a project. |
| `POST` | `/project-user-preferences` | Merge preference updates into the current Windows user's project preference JSON. |
<!-- MANUAL:END -->

## Key Files
<!-- MANUAL:BEGIN -->
- `app_server/api/project_user_preferences_router.py` - Thin API routes.
- `app_server/schemas/project_user_preferences.py` - Update request schema.
- `app_server/services/project_user_preferences_service.py` - Windows login name resolution, project folder resolution, and atomic preference writes.
- `ui/shared/project_user_preferences.js` - Frontend loader/saver with debounced saves.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Preference file path: `projects/<project>/users/<windows-login>/preferences.json`.
- `datasetViewer` stores the project-specific last reserving class path and dataset name for Dataset Viewer.
- `datasetNamePicker` stores the Dataset Type picker `dsp-pref-pop` toggles (`doubleClickToSelect`, `closeAfterSelection`) for the current project/user.
- `dfmObject` stores the project-specific last reserving class path, input dataset name, method name, output vector, and basic DFM settings for the DFM startup chooser.
- `reservingClassTree` stores shared reserving-class path picker user settings for the current project/user, including `rcprefs-window` toggle/size/favorite preferences and `hiddenPaths` from the `ptree-window` right-click hide/unhide menu.
- Project duplication copies the project folder except the root `data` folder, so these `users/<windows-login>/preferences.json` values copy with the duplicated project.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- The folder name uses the backend process Windows login from `getpass.getuser()`. If the app-server process runs under a service account, preferences will follow that account.
- Project folders must be writable to create `users/<windows-login>/preferences.json`; otherwise UI preference saves fail silently and the app continues with current in-memory/default values.
<!-- MANUAL:END -->
