import shutil
import os
import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent.parent
SOURCE_ROOT = BASE_DIR.parent
for path in (PROJECT_ROOT, SOURCE_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

BUILD_ROOT = PROJECT_ROOT / "builds" / BASE_DIR.name
DEPLOY_ROOT = Path(os.environ.get("ARCRHO_DEPLOY_ROOT", r"E:\ArcRho Server"))
APPS_DIR = DEPLOY_ROOT / "apps"
VENV_PYTHON = PROJECT_ROOT / "venvs" / BASE_DIR.name / "Scripts" / "python.exe"
ENTRY_PY = BASE_DIR / "main.py"
APP_NAME = "ArcRho Admin Control"
ICON = PROJECT_ROOT.parent / "assets" / "icons" / "ArcRho Orchestrator.ico"

BUILD_DIR = BUILD_ROOT / "build"
SPEC_DIR = BUILD_ROOT / "spec"


def run(cmd, check=True):
    print("\n>>>", " ".join(map(str, cmd)))
    return subprocess.run(list(map(str, cmd)), check=check)


def clean_build_dirs():
    for path in (BUILD_DIR, SPEC_DIR):
        try:
            shutil.rmtree(path)
        except FileNotFoundError:
            pass


def ensure_venv():
    if VENV_PYTHON.exists():
        return
    run([sys.executable, "-m", "venv", VENV_PYTHON.parent.parent])


def install_pyinstaller():
    run([VENV_PYTHON, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run([VENV_PYTHON, "-m", "pip", "install", "pyinstaller"])


def build_exe():
    APPS_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        VENV_PYTHON,
        "-m",
        "PyInstaller",
        "--specpath",
        SPEC_DIR,
        "--noconfirm",
        "--onedir",
        "--paths",
        SOURCE_ROOT,
        "--hidden-import",
        "utils",
        "--exclude-module",
        "tkinter",
        "--exclude-module",
        "_tkinter",
        f"--icon={ICON}",
        "--add-data",
        f"{BASE_DIR / 'index.html'};.",
        "--noconsole",
        "--clean",
        "--name",
        APP_NAME,
        "--distpath",
        APPS_DIR,
        "--workpath",
        BUILD_DIR,
        ENTRY_PY,
    ]
    run(cmd)


def main():
    clean_build_dirs()
    ensure_venv()
    install_pyinstaller()
    build_exe()
    print(f"\nBuild finished: {APPS_DIR / APP_NAME / f'{APP_NAME}.exe'}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"\nERROR: Command failed with exit code {exc.returncode}")
        sys.exit(exc.returncode)

