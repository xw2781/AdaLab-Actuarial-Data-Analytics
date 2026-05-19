"""ArcRho host workspace configuration for the Python API."""

from __future__ import annotations

import json
import os
from pathlib import Path

from .exceptions import InvalidArcRhoServerError

WORKSPACE_PATHS_FILE_NAME = "workspace_paths.json"
DEFAULT_WORKSPACE_PATHS = {
    "projects_dir": "projects",
    "requests_dir": "requests",
}


def _config_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "ArcRho"
    return Path.home() / "AppData" / "Roaming" / "ArcRho"


def get_config_path() -> Path:
    """Return the ArcRho host workspace config file used by the Python API."""

    return _config_dir() / WORKSPACE_PATHS_FILE_NAME


def _normalize_path(path_like: str | Path) -> Path:
    return Path(path_like).expanduser().resolve()


def _validate_server_root(path_like: str | Path) -> Path:
    root = _normalize_path(path_like)
    try:
        valid_root = root.exists() and root.is_dir()
        valid_projects = (root / "projects").exists() and (root / "projects").is_dir()
    except OSError as exc:
        raise InvalidArcRhoServerError(f"ArcRho Server root is not accessible: {root}") from exc
    if not valid_root:
        raise InvalidArcRhoServerError(f"ArcRho Server root does not exist: {root}")
    projects_dir = root / "projects"
    if not valid_projects:
        raise InvalidArcRhoServerError(
            f"ArcRho Server root must contain a projects folder: {projects_dir}"
        )
    return root


def _read_workspace_config() -> dict:
    path = get_config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_host_server_root() -> Path | None:
    raw = str(_read_workspace_config().get("workspace_root") or "").strip()
    return _normalize_path(raw) if raw else None


def _save_host_server_root(root: Path) -> None:
    config_path = get_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = config_path.with_suffix(f"{config_path.suffix}.tmp")
    payload = _read_workspace_config()
    paths = payload.get("paths")
    if not isinstance(paths, dict):
        paths = {}
    payload["workspace_root"] = str(root)
    payload["paths"] = {
        "projects_dir": str(paths.get("projects_dir") or DEFAULT_WORKSPACE_PATHS["projects_dir"]),
        "requests_dir": str(paths.get("requests_dir") or DEFAULT_WORKSPACE_PATHS["requests_dir"]),
    }
    tmp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp_path, config_path)


def _resolve_default_server_root() -> Path | None:
    return _load_host_server_root()


_server_root: Path | None = _resolve_default_server_root()


def get_server_root(*, required: bool = False) -> Path | None:
    """Return the current default ArcRho Server root.

    The value is read from the ArcRho host app workspace config file:
    `%APPDATA%\\ArcRho\\workspace_paths.json`.
    """

    global _server_root
    if _server_root is None:
        _server_root = _resolve_default_server_root()
    if _server_root is not None:
        return _server_root
    if required:
        raise InvalidArcRhoServerError(
            "ArcRho Server root was not found in the ArcRho host config file. "
            "Use ArcRho Server Connection, call set_server_root(...), or pass "
            "server_root=... to ArcRhoClient(...)."
        )
    return None


def set_server_root(server_root: str | Path, *, persist: bool = True, validate: bool = True) -> Path:
    """Set the default ArcRho Server root in process and in the host config."""

    global _server_root
    root = _validate_server_root(server_root) if validate else _normalize_path(server_root)
    _server_root = root
    if persist:
        _save_host_server_root(root)
    return root


def reload_server_root() -> Path | None:
    """Reload the server root from the ArcRho host config file."""

    global _server_root
    _server_root = _resolve_default_server_root()
    return _server_root
