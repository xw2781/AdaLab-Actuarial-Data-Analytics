"""Best-effort local debug trace logging."""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List

from fastapi import HTTPException

from app_server import config

_TRACE_LOCK = threading.Lock()
_MAX_EVENTS_PER_APPEND = 500


def _clean_text(value: Any, max_len: int = 5000) -> str:
    text = str(value if value is not None else "").strip()
    return text[:max_len]


def _safe_name(value: Any, fallback: str = "trace") -> str:
    cleaned = _clean_text(value, 80).lower()
    cleaned = re.sub(r"[^a-z0-9_.-]+", "_", cleaned)
    cleaned = cleaned.strip("._-")
    return cleaned or fallback


def _debug_log_dir() -> str:
    return os.path.join(config._get_user_appdata_dir(), "debug_logs")


def _trace_path(source: str) -> str:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"{_safe_name(source)}_{day}.jsonl"
    return os.path.join(_debug_log_dir(), filename)


def _sanitize_value(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return _clean_text(value, 500)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _clean_text(value)
    if isinstance(value, list):
        return [_sanitize_value(item, depth + 1) for item in value[:50]]
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in list(value.items())[:80]:
            out[_clean_text(key, 120)] = _sanitize_value(item, depth + 1)
        return out
    return _clean_text(value, 1000)


def append_debug_trace(
    source: str,
    session_id: str,
    project_name: str,
    events: Iterable[Dict[str, Any]],
) -> Dict[str, Any]:
    source_clean = _clean_text(source, 80)
    session_clean = _clean_text(session_id, 120)
    if not source_clean:
        raise HTTPException(400, "source is required.")
    if not session_clean:
        raise HTTPException(400, "session_id is required.")

    event_list: List[Dict[str, Any]] = []
    for raw in list(events or [])[:_MAX_EVENTS_PER_APPEND]:
        if not isinstance(raw, dict):
            continue
        event_list.append(_sanitize_value(raw))
    if not event_list:
        return {
            "ok": True,
            "path": _trace_path(source_clean),
            "count": 0,
        }

    now = datetime.now(timezone.utc).isoformat()
    path = _trace_path(source_clean)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with _TRACE_LOCK:
        with open(path, "a", encoding="utf-8", newline="\n") as fh:
            for event in event_list:
                line = {
                    "server_ts": now,
                    "source": source_clean,
                    "session_id": session_clean,
                    "project_name": _clean_text(project_name, 240),
                    "event": event,
                }
                fh.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")))
                fh.write("\n")

    return {
        "ok": True,
        "path": path,
        "count": len(event_list),
    }
