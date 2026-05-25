import argparse
import getpass
import json
import os
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.error import URLError
from urllib.request import Request, urlopen


MODULE_ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = MODULE_ROOT.parent
PRODUCT_ROOT = SOURCE_ROOT.parent
BUNDLE_ROOT = Path(getattr(sys, "_MEIPASS", MODULE_ROOT)).resolve()
EXE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else None
DEFAULT_DEPLOY_ROOT = Path(os.environ.get("ARCRHO_DEPLOY_ROOT", r"E:\ArcRho Server")).expanduser()

if "ARCRHO_ROOT" not in os.environ:
    if EXE_DIR and EXE_DIR.name.lower() == "apps":
        os.environ["ARCRHO_ROOT"] = str(EXE_DIR.parent)
    elif EXE_DIR and EXE_DIR.parent.name.lower() == "apps":
        os.environ["ARCRHO_ROOT"] = str(EXE_DIR.parent.parent)
    elif not getattr(sys, "frozen", False):
        os.environ["ARCRHO_ROOT"] = str(DEFAULT_DEPLOY_ROOT)

for path in (PRODUCT_ROOT, SOURCE_ROOT, BUNDLE_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

DEFAULT_PORT = 8765
DEFAULT_STALE_AFTER_SECONDS = 60
ENGINE_STALE_AFTER_SECONDS = 6
PROJECT_ROOT_NAMES = ("ArcRho Server", "ArcRho", "ADAS")
COMPONENT_DIRS = {
    "admin": ("arcrho_admin",),
    "engine": ("arcrho_engine", "ArcRho Engine", "ADAS Agent"),
    "orchestrator": ("arcrho_orchestrator", "ArcRho Orchestrator", "ADAS Master"),
    "bridge": ("arcrho_bridge",),
    "bridge_worker": ("arcrho_bridge_worker",),
}


def find_project_root():
    starts = []
    configured_root = os.environ.get("ARCRHO_ROOT")
    if configured_root:
        starts.append(Path(configured_root).expanduser())
    if EXE_DIR:
        starts.append(EXE_DIR)
        if EXE_DIR.name.lower() == "apps":
            starts.append(EXE_DIR.parent)
        if EXE_DIR.parent.name.lower() == "apps":
            starts.append(EXE_DIR.parent.parent)
    starts.extend((DEFAULT_DEPLOY_ROOT, MODULE_ROOT))

    seen = set()
    for start in starts:
        current = start.resolve()
        if current in seen:
            continue
        seen.add(current)
        for candidate in (current, *current.parents):
            if candidate.name.lower() in {name.lower() for name in PROJECT_ROOT_NAMES}:
                return candidate
            if ((candidate / "config" / "config.json").exists() or (candidate / "core" / "config.json").exists()):
                return candidate
    return PRODUCT_ROOT


PROJECT_ROOT = find_project_root()
_CONFIG_ENV = os.environ.get("ARCRHO_CONFIG") or os.environ.get("ADAS_CONFIG")
_DEFAULT_CONFIG_FILE = PROJECT_ROOT / "config" / "config.json"
_LEGACY_CONFIG_FILE = PROJECT_ROOT / "core" / "config.json"


def resolve_config_file():
    if _DEFAULT_CONFIG_FILE.exists():
        return _DEFAULT_CONFIG_FILE
    if _CONFIG_ENV:
        return Path(_CONFIG_ENV)
    if _LEGACY_CONFIG_FILE.exists():
        return _LEGACY_CONFIG_FILE
    return _DEFAULT_CONFIG_FILE


CONFIG_FILE = resolve_config_file()


def resource_path(name):
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def default_config():
    return {
        "config_version": "1.0",
        "root": str(PROJECT_ROOT),
        "apps": {
            "engine": {"kill_all": False},
            "orchestrator": {
                "kill_all": False,
                "auto_create_workers": True,
                "max_workers": 5,
            },
            "bridge": {
                "kill_all": False,
                "max_workers": 1,
            },
            "bridge_worker": {"kill_all": False},
        },
    }


def load_config():
    try:
        with open(CONFIG_FILE, mode="r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        return default_config()


def save_config(config):
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_path = CONFIG_FILE.with_name(f"{CONFIG_FILE.name}.{os.getpid()}.tmp")
    with open(temp_path, mode="w", encoding="utf-8") as file:
        json.dump(config, file, indent=2)
        file.write("\n")
    os.replace(temp_path, CONFIG_FILE)


def set_nested_value(data, key_path, value):
    parts = key_path.split(".")
    current = data
    for part in parts[:-1]:
        if part not in current or not isinstance(current[part], dict):
            current[part] = {}
        current = current[part]
    current[parts[-1]] = value


def current_timestamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def admin_instance_id():
    stamp = datetime.now().strftime("%y%m%d-%H%M%S")
    return f"{socket.gethostname()}@{getpass.getuser()}@{os.getpid()}@{stamp}"


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with open(temp_path, mode="w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)
        file.write("\n")
    os.replace(temp_path, path)


def safe_unlink(path):
    if path is None:
        return False
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def admin_heartbeat_payload(instance_id, created):
    return {
        "Server": instance_id,
        "Role": "admin",
        "User": getpass.getuser(),
        "Created": created,
        "Last seen": current_timestamp(),
    }


def start_admin_heartbeat(server, instance_path):
    instance_id = instance_path.stem
    created = current_timestamp()
    write_json(instance_path, admin_heartbeat_payload(instance_id, created))

    def monitor():
        while True:
            time.sleep(2)
            if getattr(server, "shutdown_requested", False):
                return
            if not instance_path.exists():
                server.shutdown_requested = True
                threading.Thread(target=server.shutdown, daemon=True).start()
                return
            write_json(instance_path, admin_heartbeat_payload(instance_id, created))

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    return thread


def instance_sources():
    return {
        "admin": ("Admin Control", resolve_app_path("admin", "instances")),
        "engine": ("Engine", resolve_app_path("engine", "instances")),
        "orchestrator": ("Orchestrator", resolve_app_path("orchestrator", "instances")),
        "bridge": ("Bridge", resolve_app_path("bridge", "instances")),
        "bridge_worker": ("Bridge Worker", resolve_app_path("bridge_worker", "instances")),
    }


def resolve_app_path(role, *parts):
    normalized_parts = tuple(str(part) for part in parts)
    if normalized_parts and normalized_parts[0].lower() == "instances":
        return PROJECT_ROOT.joinpath("runtime", "instances", COMPONENT_DIRS[role][0], *normalized_parts[1:])
    for dirname in COMPONENT_DIRS[role]:
        for candidate in (
            PROJECT_ROOT / "core" / dirname,
            PROJECT_ROOT / "data-engine" / "src" / dirname,
            PROJECT_ROOT / "src" / dirname,
        ):
            if candidate.exists():
                return candidate.joinpath(*parts)
    return (PROJECT_ROOT / "core" / COMPONENT_DIRS[role][0]).joinpath(*parts)


def instance_age(last_seen):
    if not last_seen:
        return None
    try:
        seen = datetime.strptime(last_seen, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return max(0, int((datetime.now() - seen).total_seconds()))


def instance_user(server_name):
    parts = str(server_name or "").split("@")
    return parts[1] if len(parts) >= 3 and parts[1] else ""


def instance_created(server_name, path):
    token = str(server_name or "").split("@")[-1]
    try:
        created = datetime.strptime("-".join(token.split("-")[:2]), "%y%m%d-%H%M%S")
    except ValueError:
        try:
            created = datetime.fromtimestamp(path.stat().st_ctime)
        except OSError:
            return ""
    return created.strftime("%Y-%m-%d %H:%M:%S")


def stale_after_seconds(role):
    return ENGINE_STALE_AFTER_SECONDS if role in ("engine", "bridge_worker") else DEFAULT_STALE_AFTER_SECONDS


def read_instance_file(path):
    try:
        with open(path, mode="r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return {}


def list_instances():
    rows = []
    for role_key, (role_label, folder) in instance_sources().items():
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            data = read_instance_file(path)
            last_seen = data.get("Last seen", "")
            server = data.get("Server") or path.stem
            age = instance_age(last_seen)
            stale_after = stale_after_seconds(role_key)
            rows.append(
                {
                    "role": role_key,
                    "role_label": role_label,
                    "name": path.name,
                    "server": server,
                    "user": data.get("User") or instance_user(server),
                    "created": data.get("Created") or instance_created(server, path),
                    "last_seen": last_seen,
                    "age_seconds": age,
                    "stale_after_seconds": stale_after,
                    "status": "Active" if age is None or age <= stale_after else "Stale",
                }
            )
    return rows


def remove_instance(role, name):
    sources = instance_sources()
    if role not in sources:
        raise ValueError(f"Unknown role: {role}")
    if not name.lower().endswith(".json") or Path(name).name != name:
        raise ValueError("Invalid instance file name")

    path = sources[role][1] / name
    folder = sources[role][1].resolve()
    resolved = path.resolve()
    if folder not in resolved.parents:
        raise ValueError("Instance path is outside the expected folder")
    if resolved.exists():
        resolved.unlink()
        return True
    return False


class AdminHandler(BaseHTTPRequestHandler):
    server_version = "ArcRhoAdmin/1.0"

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self.send_file(resource_path("index.html"), "text/html; charset=utf-8")
        elif parsed.path == "/api/health":
            self.send_json({"ok": True})
        elif parsed.path == "/api/config":
            self.send_json({"path": str(CONFIG_FILE), "config": load_config()})
        elif parsed.path == "/api/instances":
            self.send_json(
                {
                    "instances": list_instances(),
                    "stale_after_seconds": DEFAULT_STALE_AFTER_SECONDS,
                    "stale_after_seconds_by_role": {
                        "admin": DEFAULT_STALE_AFTER_SECONDS,
                        "engine": ENGINE_STALE_AFTER_SECONDS,
                        "orchestrator": DEFAULT_STALE_AFTER_SECONDS,
                        "bridge": DEFAULT_STALE_AFTER_SECONDS,
                        "bridge_worker": ENGINE_STALE_AFTER_SECONDS,
                    },
                }
            )
        else:
            self.send_error(404, "Not found")

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/config":
            self.send_error(404, "Not found")
            return

        payload = self.read_json_body()
        key_path = payload.get("path")
        if not key_path:
            self.send_error(400, "Missing config path")
            return

        config = load_config()
        set_nested_value(config, key_path, payload.get("value"))
        save_config(config)
        self.send_json({"ok": True, "path": str(CONFIG_FILE), "config": config})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/instances":
            self.send_error(404, "Not found")
            return

        query = parse_qs(parsed.query)
        try:
            removed = remove_instance(query.get("role", [""])[0], query.get("name", [""])[0])
            self.send_json({"ok": True, "removed": removed, "instances": list_instances()})
        except ValueError as exc:
            self.send_error(400, str(exc))

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/open-config-folder":
            os.startfile(CONFIG_FILE.parent)
            self.send_json({"ok": True})
        elif parsed.path == "/api/reset-config":
            config = default_config()
            save_config(config)
            self.send_json({"ok": True, "path": str(CONFIG_FILE), "config": config})
        elif parsed.path == "/api/shutdown":
            self.send_json({"ok": True})
            self.server.shutdown_requested = True
            instance_path = getattr(self.server, "admin_instance_path", None)
            if instance_path is not None:
                safe_unlink(instance_path)
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        else:
            self.send_error(404, "Not found")

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def send_file(self, path, content_type):
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            self.send_error(404, f"Missing file: {path}")
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def make_server(port):
    for candidate in range(port, port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), AdminHandler)
            server.shutdown_requested = False
            server.admin_instance_path = None
            return server
        except OSError:
            continue
    raise OSError(f"No available port found from {port} to {port + 19}")


class StartupSplash:
    def __init__(self):
        self._ready = threading.Event()
        self._close = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()
        self._ready.wait(timeout=0.8)

    def close(self):
        self._close.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.0)

    def _run(self):
        try:
            import tkinter as tk
        except Exception:
            self._ready.set()
            return

        try:
            root = tk.Tk()
            root.overrideredirect(True)
            root.attributes("-topmost", True)
            root.configure(bg="#f4f7fb")

            width = 360
            height = 190
            screen_w = root.winfo_screenwidth()
            screen_h = root.winfo_screenheight()
            x = int((screen_w - width) / 2)
            y = int((screen_h - height) / 2)
            root.geometry(f"{width}x{height}+{x}+{y}")

            frame = tk.Frame(root, bg="#ffffff", highlightbackground="#dfe6ef", highlightthickness=1)
            frame.place(x=10, y=10, width=width - 20, height=height - 20)

            canvas = tk.Canvas(frame, width=64, height=64, bg="#ffffff", highlightthickness=0)
            canvas.pack(pady=(24, 10))
            canvas.create_oval(11, 11, 53, 53, outline="#dbeafe", width=5)
            arc = canvas.create_arc(11, 11, 53, 53, start=90, extent=105, outline="#2563eb", width=5, style="arc")

            title = tk.Label(frame, text="ArcRho Admin Control", bg="#ffffff", fg="#1f3b67", font=("Segoe UI", 13, "bold"))
            title.pack()
            detail = tk.Label(frame, text="Starting local admin server...", bg="#ffffff", fg="#5d6a7f", font=("Segoe UI", 9))
            detail.pack(pady=(6, 0))

            state = {"angle": 90}

            def tick():
                if self._close.is_set():
                    root.destroy()
                    return
                state["angle"] = (state["angle"] - 18) % 360
                canvas.itemconfigure(arc, start=state["angle"])
                root.after(55, tick)

            self._ready.set()
            tick()
            root.mainloop()
        except Exception:
            self._ready.set()


def is_admin_server(port):
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/config", timeout=0.35) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return isinstance(payload.get("config"), dict) and "path" in payload
    except (OSError, URLError, ValueError, json.JSONDecodeError):
        return False


def request_admin_shutdown(port):
    request = Request(f"http://127.0.0.1:{port}/api/shutdown", data=b"", method="POST")
    try:
        with urlopen(request, timeout=0.35):
            return True
    except (OSError, URLError):
        return False


def wait_for_admin_shutdown(ports, timeout_seconds=3.0):
    deadline = time.monotonic() + timeout_seconds
    remaining = set(ports)

    while remaining and time.monotonic() < deadline:
        remaining = {port for port in remaining if is_admin_server(port)}
        if remaining:
            time.sleep(0.1)

    return remaining


def shutdown_existing_admin_servers(port, port_count=20):
    shutdown_ports = []
    for candidate in range(port, port + port_count):
        if is_admin_server(candidate) and request_admin_shutdown(candidate):
            shutdown_ports.append(candidate)

    if shutdown_ports:
        remaining = wait_for_admin_shutdown(shutdown_ports)
        closed = sorted(set(shutdown_ports) - remaining)
        if closed:
            print(f"Closed previous ArcRho Admin Control server(s) on port(s): {', '.join(map(str, closed))}")
        if remaining:
            print(f"Warning: previous admin server(s) still responding on port(s): {', '.join(map(str, sorted(remaining)))}")
        return remaining
    return set()


def main():
    parser = argparse.ArgumentParser(description="Run ArcRho Admin Control in a local browser.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-splash", action="store_true")
    args = parser.parse_args()

    splash = None if args.no_splash else StartupSplash()
    if splash:
        splash.start()

    try:
        remaining_servers = shutdown_existing_admin_servers(args.port)
        if remaining_servers:
            raise OSError(f"Could not close previous ArcRho Admin Control server(s) on port(s): {', '.join(map(str, sorted(remaining_servers)))}")

        server = make_server(args.port)
        server.admin_instance_path = resolve_app_path("admin", "instances", f"{admin_instance_id()}.json")
        start_admin_heartbeat(server, server.admin_instance_path)
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"ArcRho Admin Control: {url}")

        if not args.no_browser:
            webbrowser.open(url)
    finally:
        if splash:
            splash.close()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown_requested = True
        safe_unlink(server.admin_instance_path)
        server.server_close()


if __name__ == "__main__":
    main()



