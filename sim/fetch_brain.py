"""Fetch MaleCNS brain files with curl when Python's downloader times out."""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

FILES = {
    "brain.npz": "cc9bd1ecd00bd703a6fa648bc6ad145c93c7c1ee53debdcc9ce0d1f4305e6aca",
    "weights.npz": "c29919aa44069a271b1ee978abe05fa9bf6e45e4ba3e436e92b624ef1b5be40c",
}

RELEASE = os.environ.get(
    "FLYBRAIN_DATA_URL",
    "https://github.com/alextitonis/fly.ai/releases/download/brain-v1",
)


def data_dir() -> Path:
    return Path(os.environ.get("FLY_DATA", Path.home() / "fly-data"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ready(folder: Path | None = None) -> bool:
    folder = data_dir() if folder is None else Path(folder)
    for name, expected in FILES.items():
        target = folder / name
        if not target.exists():
            return False
        if sha256(target) != expected:
            return False
    return True


def _curl(url: str, target: Path) -> None:
    partial = target.with_suffix(target.suffix + ".part")
    cmd = [
        "curl",
        "-fL",
        "--retry",
        "8",
        "--retry-all-errors",
        "--connect-timeout",
        "30",
        "--continue-at",
        "-",
        "--output",
        str(partial),
        url,
    ]
    print(f"curl {target.name}", file=sys.stderr, flush=True)
    subprocess.run(cmd, check=True)
    expected = FILES[target.name]
    if sha256(partial) != expected:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"{target.name} checksum mismatch")
    partial.replace(target)


def _urllib(url: str, target: Path) -> None:
    partial = target.with_suffix(target.suffix + ".part")
    digest = hashlib.sha256()
    print(f"download {target.name}", file=sys.stderr, flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "flyos"})
    with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as out:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != FILES[target.name]:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"{target.name} checksum mismatch")
    partial.replace(target)


def ensure_brain(folder: Path | None = None) -> Path:
    folder = data_dir() if folder is None else Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    curl = shutil.which("curl")
    for name in FILES:
        target = folder / name
        if target.exists() and sha256(target) == FILES[name]:
            continue
        url = f"{RELEASE.rstrip('/')}/{name}"
        last_error: Exception | None = None
        for attempt in range(5):
            try:
                if curl:
                    _curl(url, target)
                else:
                    _urllib(url, target)
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                print(f"{name} attempt {attempt + 1} failed: {exc}", file=sys.stderr, flush=True)
        if last_error:
            raise RuntimeError(f"could not download {name}: {last_error}") from last_error
    return folder
