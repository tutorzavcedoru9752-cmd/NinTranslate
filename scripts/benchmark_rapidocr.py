import base64
import os
import statistics
import sys
from pathlib import Path

from rapidocr_sidecar import EnginePool, MODEL_GROUPS, recognize, run_candidate, select_candidate

os.environ.setdefault(
    "NINTRANSLATE_OCR_MODEL_DIR",
    str(Path("resources/rapidocr/models").resolve()),
)
sys.stdout.reconfigure(encoding="utf-8")

pool = EnginePool()
for fixture in sorted(Path("src/main/__fixtures__/ocr").glob("*.png")):
    candidates = [run_candidate(pool, group, fixture.read_bytes()) for group in MODEL_GROUPS]
    best = select_candidate(candidates)
    server = run_candidate(pool, "cjk", fixture.read_bytes(), engine=pool.get_high_accuracy())
    details = " ; ".join(
        f"{candidate.group}:{candidate.confidence:.1f}:{candidate.text!r}"
        for candidate in candidates
    )
    print(
        f"{fixture.stem}: BEST={best.group} {best.confidence:.1f} {best.text!r} "
        f"| SERVER={server.confidence:.1f}:{server.text!r} | {details}"
    )

layout_fixture = Path("src/main/__fixtures__/ocr/layout-paragraphs.png")
payload = base64.b64encode(layout_fixture.read_bytes()).decode("ascii")
recognize(pool, payload)  # cold initialization is recorded separately by integration tests
layout_times = [recognize(pool, payload)["layoutElapsedMs"] for _ in range(10)]
ordered = sorted(layout_times)
p95 = ordered[max(0, int(len(ordered) * 0.95 + 0.999) - 1)]
print(
    "LAYOUT_WARM "
    f"runs={len(layout_times)} median_ms={statistics.median(layout_times):.2f} "
    f"p95_ms={p95:.2f} values={layout_times}"
)
