from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def _kill_process_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except OSError:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            process.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a command with a hard timeout and process-tree cleanup.")
    parser.add_argument("--timeout", type=float, default=115.0, help="Seconds before killing the child process tree.")
    parser.add_argument("--cwd", default="", help="Optional working directory for the child command.")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Command to run after --.")
    args = parser.parse_args()

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("command is required after --")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")

    cwd = Path(args.cwd).resolve() if args.cwd else None
    start = time.monotonic()
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=str(cwd) if cwd else None,
        creationflags=creationflags,
        start_new_session=(os.name != "nt"),
    )
    try:
        return process.wait(timeout=args.timeout)
    except KeyboardInterrupt:
        _kill_process_tree(process)
        raise
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - start
        print(
            f"run_with_timeout: timeout after {elapsed:.1f}s; killed process tree rooted at PID {process.pid}: "
            + " ".join(command),
            file=sys.stderr,
        )
        _kill_process_tree(process)
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
