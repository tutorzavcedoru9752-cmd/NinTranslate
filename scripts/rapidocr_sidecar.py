"""NinTranslate local RapidOCR sidecar.

The process reads newline-delimited JSON from stdin and writes one JSON response
per request to stdout. Images are decoded and processed in memory only.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from rapidocr import LangRec, OCRVersion, RapidOCR


MODEL_GROUPS = {
    "cjk": LangRec.CH,
    "korean": LangRec.KOREAN,
    "latin": LangRec.LATIN,
    "cyrillic": LangRec.ESLAV,
}


@dataclass
class Candidate:
    group: str
    text: str
    confidence: float
    paragraphs: list[dict[str, Any]]


def model_directory() -> Path:
    configured = os.environ.get("NINTRANSLATE_OCR_MODEL_DIR")
    if not configured:
        raise RuntimeError("缺少本地 OCR 模型目录配置。")
    path = Path(configured).resolve()
    if not path.is_dir():
        raise RuntimeError(f"本地 OCR 模型目录不存在：{path}")
    return path


def make_engine(language: LangRec) -> RapidOCR:
    version = OCRVersion.PPOCRV5
    return RapidOCR(params={
        "Global.model_root_dir": str(model_directory()),
        "Global.log_level": "warning",
        "Global.text_score": 0.35,
        "Det.ocr_version": version,
        "Det.limit_type": "max",
        "Det.limit_side_len": 1280,
        "Cls.ocr_version": version,
        "Rec.ocr_version": version,
        "Rec.lang_type": language,
    })


class EnginePool:
    def __init__(self) -> None:
        self.engines: dict[str, RapidOCR] = {}

    def get(self, group: str) -> RapidOCR:
        if group not in self.engines:
            self.engines[group] = make_engine(MODEL_GROUPS[group])
        return self.engines[group]


def decode_image(value: str) -> bytes:
    payload = value.split(",", 1)[1] if value.startswith("data:") else value
    try:
        return base64.b64decode(payload, validate=True)
    except ValueError as error:
        raise ValueError("截图数据不是有效的 Base64 图片。") from error


def box_bounds(box: Any, offset_x: int = 0, offset_y: int = 0) -> dict[str, int]:
    xs = [float(point[0]) for point in box]
    ys = [float(point[1]) for point in box]
    left, top = min(xs), min(ys)
    return {
        "x": round(left) + offset_x,
        "y": round(top) + offset_y,
        "width": max(1, round(max(xs) - left)),
        "height": max(1, round(max(ys) - top)),
    }


def trim_uniform_margin(image: bytes) -> tuple[np.ndarray, int, int]:
    array = np.frombuffer(image, dtype=np.uint8)
    decoded = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError("截图图片无法解码。")
    height, width = decoded.shape[:2]
    border = np.concatenate((decoded[0], decoded[-1], decoded[:, 0], decoded[:, -1]), axis=0)
    background = np.median(border.astype(np.float32), axis=0)
    difference = np.max(np.abs(decoded.astype(np.float32) - background), axis=2)
    ys, xs = np.where(difference > 18)
    if not len(xs):
        return decoded, 0, 0
    content_height = int(ys.max() - ys.min() + 1)
    content_width = int(xs.max() - xs.min() + 1)
    if content_height * content_width > height * width * 0.92:
        return decoded, 0, 0
    margin = max(12, round(content_height * 0.35))
    left, right = max(0, int(xs.min()) - margin), min(width, int(xs.max()) + margin + 1)
    top, bottom = max(0, int(ys.min()) - margin), min(height, int(ys.max()) + margin + 1)
    return decoded[top:bottom, left:right], left, top


def run_candidate(
    pool: EnginePool,
    group: str,
    image: bytes | np.ndarray,
    offset_x: int = 0,
    offset_y: int = 0,
) -> Candidate:
    if isinstance(image, bytes):
        prepared, offset_x, offset_y = trim_uniform_margin(image)
    else:
        prepared = image
    result = pool.get(group)(prepared)
    texts = list(result.txts or ())
    scores = [float(score) for score in (result.scores or ())]
    boxes = list(result.boxes) if result.boxes is not None else []
    paragraphs = [
        {
            "text": text.strip(),
            "confidence": round(score * 100, 2),
            "bounds": box_bounds(box, offset_x, offset_y),
        }
        for text, score, box in zip(texts, scores, boxes)
        if text.strip()
    ]
    weighted_length = sum(max(1, len(item["text"])) for item in paragraphs)
    confidence = (
        sum(item["confidence"] * max(1, len(item["text"])) for item in paragraphs)
        / weighted_length
        if weighted_length else 0.0
    )
    return Candidate(group, "\n".join(item["text"] for item in paragraphs), confidence, paragraphs)


def script_ratio(pattern: str, text: str) -> float:
    visible = re.sub(r"[\s\d\W_]", "", text, flags=re.UNICODE)
    return len(re.findall(pattern, visible)) / max(1, len(visible))


def visible_length(text: str) -> int:
    return len(re.sub(r"\s", "", text))


def candidate_score(candidate: Candidate, longest_text: int) -> float:
    text = candidate.text
    score = candidate.confidence
    ratios = {
        "cjk": script_ratio(r"[\u3040-\u30ff\u3400-\u9fff]", text),
        "korean": script_ratio(r"[\uac00-\ud7af\u1100-\u11ff]", text),
        "cyrillic": script_ratio(r"[\u0400-\u052f]", text),
        "latin": script_ratio(r"[A-Za-z\u00c0-\u024f]", text),
    }
    own_ratio = ratios[candidate.group]
    score += own_ratio * 28
    if candidate.group == "latin" and ratios["latin"] > 0.8:
        score += 2
    score += min(1.0, visible_length(text) / max(1, longest_text)) * 24
    if not text.strip():
        score -= 100
    return score


def select_candidate(candidates: list[Candidate]) -> Candidate:
    if not candidates:
        return Candidate("cjk", "", 0.0, [])
    longest_text = max(visible_length(candidate.text) for candidate in candidates)
    return max(candidates, key=lambda candidate: candidate_score(candidate, longest_text))


def recognize(pool: EnginePool, image_data: str) -> dict[str, Any]:
    image, offset_x, offset_y = trim_uniform_margin(decode_image(image_data))
    candidates = [
        run_candidate(pool, group, image, offset_x, offset_y)
        for group in MODEL_GROUPS
    ]
    best = select_candidate(candidates)
    return {
        "text": best.text,
        "confidence": round(best.confidence, 2),
        "paragraphs": best.paragraphs,
        "modelGroup": best.group,
    }


def respond(payload: dict[str, Any]) -> None:
    # ASCII JSON escapes keep the pipe byte-identical on Windows systems whose
    # legacy console encoding is GBK, while JSON.parse restores Unicode text.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> None:
    pool = EnginePool()
    respond({"type": "ready", "engine": "RapidOCR", "version": "3.8.1"})
    for line in sys.stdin:
        request_id: Any = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("action") != "recognize":
                raise ValueError("不支持的 OCR 请求。")
            respond({"id": request_id, "ok": True, "result": recognize(pool, request["imageData"])})
        except Exception as error:  # keep the long-lived process available for retry
            traceback.print_exc(file=sys.stderr)
            respond({"id": request_id, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
