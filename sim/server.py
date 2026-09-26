"""Local bridge from the MaleCNS spiking model to the Next.js console.

Loads the flybrain package (166,700 neurons, MaleCNS v1.0) once, steps it
continuously, and serves the latest spike snapshot on http://127.0.0.1:8787.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

HOST = os.environ.get("FLY_HOST", "127.0.0.1")
PORT = int(os.environ.get("FLY_PORT", "8787"))
WINDOW = 25  # 0.5 s at the default 20 ms step
PUBLISH_EVERY = 0.05

STIMULI = {
    "quiet": [],
    "loom": ["LC4", "LPLC2"],
    "chase": ["LC10a"],
    "odor": ["ORN_DM1", "ORN_DM2"],
}

READOUTS = [
    ("DNp01", "L", "DNp01 left", "Giant fiber · escape"),
    ("DNp01", "R", "DNp01 right", "Giant fiber · escape"),
    ("DNa02", "L", "DNa02 left", "Steering"),
    ("DNa02", "R", "DNa02 right", "Steering"),
    ("DNg100", None, "DNg100", "Forward walking"),
    ("MDN", "L", "MDN left", "Backward walking"),
    ("MDN", "R", "MDN right", "Backward walking"),
    ("DM1_lPN", None, "DM1", "Food-odour projection"),
    ("DM2_lPN", None, "DM2", "Food-odour projection"),
]

stim_lock = threading.Lock()
stim = {"kind": "quiet", "side": "L", "strength": 0.8}

published = {
    "ready": False,
    "phase": "boot",
    "message": "Starting the brain server",
    "t": 0.0,
    "spikes": 0,
    "stepMs": 0.0,
    "neurons": 0,
    "synapses": 0,
    "device": "cpu",
    "stimulus": dict(stim),
    "catalog": {},
    "readouts": [],
    "drive": {"escape": 0.0, "turn": 0.0, "forward": 0.0, "back": 0.0, "food": 0.0},
    "sparks": [],
    "trace": [],
}
atlas = {"points": []}


def publish(**patch) -> None:
    global published
    published = {**published, **patch}


def snapshot_stim() -> dict:
    with stim_lock:
        return dict(stim)


def set_stimulus(body: dict) -> str | None:
    kind = body.get("kind", stim["kind"])
    side = body.get("side", stim["side"])
    strength = body.get("strength", stim["strength"])
    if kind not in STIMULI:
        return "unknown stimulus"
    if side not in ("L", "R"):
        return "side must be L or R"
    try:
        strength = float(strength)
    except (TypeError, ValueError):
        return "strength must be a number"
    strength = max(0.0, min(1.5, strength))
    with stim_lock:
        stim["kind"] = kind
        stim["side"] = side
        stim["strength"] = strength
    publish(stimulus=snapshot_stim())
    return None


def _unit(hz: float, rest: float = 2.0, span: float = 22.0) -> float:
    return max(0.0, min(1.0, (hz - rest) / span))


def _xy(positions: np.ndarray) -> np.ndarray:
    pos = np.asarray(positions, dtype=np.float64)
    xy = np.full((pos.shape[0], 2), np.nan, np.float32)
    if pos.ndim != 2 or pos.shape[1] < 2:
        return xy
    finite = np.isfinite(pos).all(axis=1)
    if int(finite.sum()) < 10:
        return xy
    cols = pos.shape[1]
    variance = np.nanvar(pos[finite], axis=0)
    order = np.argsort(variance)[::-1]
    a, b = int(order[0]), int(order[1] if cols > 1 else 0)
    raw = pos[:, [a, b]]
    finite = np.isfinite(raw).all(axis=1)
    lo = raw[finite].min(axis=0)
    hi = raw[finite].max(axis=0)
    span = np.maximum(hi - lo, 1e-9)
    xy[finite] = ((raw[finite] - lo) / span).astype(np.float32)
    return xy


def _pack(points: np.ndarray, limit: int) -> list[float]:
    if len(points) == 0:
        return []
    if len(points) > limit:
        pick = np.random.choice(len(points), limit, replace=False)
        points = points[pick]
    rounded = np.round(points, 3).astype(np.float32)
    return rounded.reshape(-1).tolist()


def boot() -> None:
    try:
        publish(phase="import", message="Importing the flybrain model")
        from flybrain import FlyBrain

        from fetch_brain import ensure_brain, ready

        folder = Path(os.environ.get("FLY_DATA", Path.home() / "fly-data"))
        if not ready(folder):
            publish(
                phase="download",
                message=f"Downloading the prebuilt MaleCNS brain into {folder} (~260 MB, once)",
            )
            ensure_brain(folder)
        publish(phase="load", message="Loading 166,700 neurons and 25.6 million connections")

        brain = FlyBrain(device="cpu", sensory_input=False)
        publish(
            phase="compile",
            message="Compiling the first step with numba. This happens once.",
            neurons=int(brain.n),
            synapses=int(len(brain.weights)),
            device=brain.device,
        )
        brain.step()

        labels = brain.cell_type.astype(str)
        unique = np.unique(labels)
        for needle in ("DM1", "DM2", "DNp01", "LC4", "LPLC2", "LC10a", "DNa02", "MDN", "DNg"):
            hits = [name for name in unique if needle in name][:12]
            print(f"types {needle}: {hits}", flush=True)

        found = []
        for type_name, side, label, role in READOUTS:
            idx = brain.cells([type_name], side=side)
            if len(idx) == 0:
                continue
            found.append(
                {
                    "key": f"{type_name}:{side or '*'}",
                    "id": label,
                    "role": role,
                    "idx": idx,
                }
            )
            print(f"readout {label}: {len(idx)}", flush=True)

        catalog = {}
        for kind, types in STIMULI.items():
            if not types:
                continue
            catalog[kind] = {
                "L": int(len(brain.cells(types, side="L"))),
                "R": int(len(brain.cells(types, side="R"))),
                "any": int(len(brain.cells(types))),
            }
        print(f"catalog {catalog}", flush=True)

        xy = _xy(brain.positions) if brain.positions is not None else np.full((brain.n, 2), np.nan, np.float32)
        finite_idx = np.flatnonzero(np.isfinite(xy[:, 0]))
        if len(finite_idx):
            sample = finite_idx if len(finite_idx) <= 4500 else np.random.choice(finite_idx, 4500, replace=False)
            global atlas
            atlas = {"points": _pack(xy[sample], 4500)}

        counts = {item["key"]: deque(maxlen=WINDOW) for item in found}
        trace: deque[int] = deque(maxlen=56)
        ema = None
        last_pub = 0.0
        dt = float(brain.dt)

        publish(
            ready=True,
            phase="run",
            message="Simulating",
            catalog=catalog,
            neurons=int(brain.n),
            synapses=int(brain.weights.size if hasattr(brain.weights, "size") else len(brain.weights)),
        )

        while True:
            spec = snapshot_stim()
            inject = []
            types = STIMULI[spec["kind"]]
            if types:
                if spec["kind"] == "odor":
                    idx = brain.cells(types)
                else:
                    idx = brain.cells(types, side=spec["side"])
                if len(idx):
                    inject.append((idx, spec["strength"]))

            started = time.perf_counter()
            fired = brain.step(inject=inject)
            step_ms = (time.perf_counter() - started) * 1000.0
            remain = dt - (time.perf_counter() - started)
            if remain > 0:
                time.sleep(remain)
            ema = step_ms if ema is None else ema * 0.9 + step_ms * 0.1
            trace.append(int(len(fired)))

            for item in found:
                counts[item["key"]].append(int(np.isin(fired, item["idx"]).sum()))

            now = time.perf_counter()
            if now - last_pub < PUBLISH_EVERY:
                continue
            last_pub = now

            readouts = []
            hz_by_key = {}
            for item in found:
                samples = counts[item["key"]]
                neurons = max(1, len(item["idx"]))
                hz = (sum(samples) / (len(samples) * dt * neurons)) if samples else 0.0
                hz_by_key[item["key"]] = hz
                readouts.append(
                    {
                        "id": item["id"],
                        "role": item["role"],
                        "hz": round(hz, 2),
                        "neurons": int(len(item["idx"])),
                    }
                )

            left_escape = hz_by_key.get("DNp01:L", 0.0)
            right_escape = hz_by_key.get("DNp01:R", 0.0)
            left_turn = hz_by_key.get("DNa02:L", 0.0)
            right_turn = hz_by_key.get("DNa02:R", 0.0)
            forward = hz_by_key.get("DNg100:*", 0.0)
            back = max(hz_by_key.get("MDN:L", 0.0), hz_by_key.get("MDN:R", 0.0))
            food = max(hz_by_key.get("DM1_lPN:*", 0.0), hz_by_key.get("DM2_lPN:*", 0.0))
            turn = max(-1.0, min(1.0, (left_turn - right_turn) / 12.0))

            finite_fired = fired[np.isfinite(xy[fired, 0])] if len(fired) else fired
            sparks = _pack(xy[finite_fired], 700) if len(finite_fired) else []

            publish(
                ready=True,
                phase="run",
                message="Simulating",
                t=round(brain.steps * dt, 3),
                spikes=int(len(fired)),
                stepMs=round(ema, 2),
                stimulus=spec,
                catalog=catalog,
                readouts=readouts,
                drive={
                    "escape": round(max(_unit(left_escape), _unit(right_escape)), 3),
                    "turn": round(turn, 3),
                    "forward": round(_unit(forward, rest=2.0, span=18.0), 3),
                    "back": round(_unit(back, rest=1.0, span=10.0), 3),
                    "food": round(_unit(food, rest=14.0, span=16.0), 3),
                },
                sparks=sparks,
                trace=list(trace),
            )
    except Exception as exc:
        traceback.print_exc()
        publish(ready=False, phase="error", message=f"{type(exc).__name__}: {exc}")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/frame"):
            self._send(200, published)
        elif path == "/atlas":
            self._send(200, atlas)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/stimulus":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(min(length, 65536)) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            self._send(400, {"error": "bad json"})
            return
        if not isinstance(body, dict):
            self._send(400, {"error": "expected an object"})
            return
        error = set_stimulus(body)
        if error:
            self._send(400, {"error": error})
            return
        self._send(200, {"ok": True, "stimulus": snapshot_stim()})


def main() -> None:
    threading.Thread(target=boot, name="flybrain", daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"fly brain server on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
