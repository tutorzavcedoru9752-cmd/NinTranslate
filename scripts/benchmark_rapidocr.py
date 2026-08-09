from pathlib import Path

from rapidocr_sidecar import EnginePool, MODEL_GROUPS, run_candidate, select_candidate


pool = EnginePool()
for fixture in sorted(Path("src/main/__fixtures__/ocr").glob("*.png")):
    candidates = [run_candidate(pool, group, fixture.read_bytes()) for group in MODEL_GROUPS]
    best = select_candidate(candidates)
    details = " ; ".join(
        f"{candidate.group}:{candidate.confidence:.1f}:{candidate.text!r}"
        for candidate in candidates
    )
    print(f"{fixture.stem}: BEST={best.group} {best.confidence:.1f} {best.text!r} | {details}")
