"""NinTranslate local RapidOCR sidecar.

The process reads newline-delimited JSON from stdin and writes one JSON response
per request to stdout. Images are decoded and processed in memory only.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR
from rapid_layout import RapidLayout


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


def make_high_accuracy_engine() -> RapidOCR:
    root = model_directory()
    version = OCRVersion.PPOCRV5
    return RapidOCR(params={
        "Global.model_root_dir": str(root),
        "Global.log_level": "warning",
        "Global.text_score": 0.35,
        "Det.ocr_version": version,
        # The mobile detector already preserves complete visual lines better
        # for screenshots. Upgrade recognition only; the Server detector tends
        # to split UI sentences into many word boxes and hurts reading order.
        "Det.model_type": ModelType.MOBILE,
        "Det.model_path": str(root / "ch_PP-OCRv5_det_mobile.onnx"),
        "Det.limit_type": "max",
        "Det.limit_side_len": 1600,
        "Cls.ocr_version": version,
        "Rec.ocr_version": version,
        "Rec.lang_type": LangRec.CH,
        "Rec.model_type": ModelType.SERVER,
        "Rec.model_path": str(root / "ch_PP-OCRv5_rec_server.onnx"),
    })


class EnginePool:
    def __init__(self) -> None:
        self.engines: dict[str, RapidOCR] = {}
        self.layout_engines: dict[str, RapidLayout] = {}
        self.high_accuracy_engine: RapidOCR | None = None

    def get(self, group: str) -> RapidOCR:
        if group not in self.engines:
            self.engines[group] = make_engine(MODEL_GROUPS[group])
        return self.engines[group]

    def get_layout(self, ocr_group: str) -> RapidLayout:
        layout_group = "cjk" if ocr_group in {"cjk", "korean"} else "latin"
        if layout_group not in self.layout_engines:
            model_type = "pp_layout_cdla" if layout_group == "cjk" else "pp_layout_publaynet"
            filename = "layout_cdla.onnx" if layout_group == "cjk" else "layout_publaynet.onnx"
            model_path = model_directory() / filename
            if not model_path.is_file():
                raise RuntimeError(f"本地版面分析模型不存在：{model_path}")
            previous_logging_disable = logging.root.manager.disable
            logging.disable(logging.INFO)
            try:
                self.layout_engines[layout_group] = RapidLayout(
                    model_type=model_type,
                    model_dir_or_path=model_path,
                    conf_thresh=0.35,
                    iou_thresh=0.5,
                )
            finally:
                logging.disable(previous_logging_disable)
            for logger_name in list(logging.root.manager.loggerDict):
                if logger_name == "RapidLayout" or logger_name.startswith("rapid_layout"):
                    layout_logger = logging.getLogger(logger_name)
                    layout_logger.setLevel(logging.WARNING)
                    for handler in layout_logger.handlers:
                        handler.setLevel(logging.WARNING)
        return self.layout_engines[layout_group]

    def get_high_accuracy(self) -> RapidOCR:
        if self.high_accuracy_engine is None:
            self.high_accuracy_engine = make_high_accuracy_engine()
        return self.high_accuracy_engine


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


def prepare_ocr_pixels(image: np.ndarray) -> np.ndarray:
    """Remove coloured subpixel fringes from light text on dark UI surfaces."""
    border = np.concatenate((image[0], image[-1], image[:, 0], image[:, -1]), axis=0)
    background = np.median(border.astype(np.float32), axis=0)
    luminance = float(0.114 * background[0] + 0.587 * background[1] + 0.299 * background[2])
    if luminance >= 128:
        return image
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def normalize_recognized_text(text: str, next_text: str = "") -> str:
    """Correct only high-confidence OCR confusions without semantic rewriting."""
    normalized = text.strip()
    normalized = re.sub(r"^(\d+[.)、])(?=\S)", r"\1 ", normalized)
    normalized = re.sub(
        r"\b(I|you|he|she|it|we|they|that|there|who)([’'])\s+[Il]{1,2}\b",
        lambda match: f"{match.group(1)}{match.group(2)}ll",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bAl(?=\s+(?:gets?|learns?|understands?|protects?|translates?|generates?))",
        "AI",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"(?<=evolution of )Al\b", "AI", normalized, flags=re.IGNORECASE)
    if re.search(r"\bAl$", normalized, flags=re.IGNORECASE) and re.match(
        r"^(?:gets?|learns?|understands?|protects?|translates?|generates?)\b",
        next_text.strip(),
        flags=re.IGNORECASE,
    ):
        normalized = re.sub(r"Al$", "AI", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"から(?=この(?:問題|疑問|点|結果|方法))", "から、", normalized)
    return normalized


def run_candidate(
    pool: EnginePool,
    group: str,
    image: bytes | np.ndarray,
    offset_x: int = 0,
    offset_y: int = 0,
    engine: RapidOCR | None = None,
) -> Candidate:
    if isinstance(image, bytes):
        prepared, offset_x, offset_y = trim_uniform_margin(image)
    else:
        prepared = image
    result = (engine or pool.get(group))(prepared)
    texts = list(result.txts or ())
    scores = [float(score) for score in (result.scores or ())]
    boxes = list(result.boxes) if result.boxes is not None else []
    raw_items = [
        (text.strip(), score, box)
        for text, score, box in zip(texts, scores, boxes)
        if text.strip()
    ]
    paragraphs = [
        {
            "text": normalize_recognized_text(
                text,
                raw_items[index + 1][0] if index + 1 < len(raw_items) else "",
            ),
            "confidence": round(score * 100, 2),
            "bounds": box_bounds(box, offset_x, offset_y),
        }
        for index, (text, score, box) in enumerate(raw_items)
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


def should_try_high_accuracy(candidate: Candidate) -> bool:
    """Use the heavier recognizer only when the fast pass is genuinely unsure."""
    return (
        candidate.group in {"cjk", "latin"}
        and visible_length(candidate.text) >= 2
        and candidate.confidence < 98.5
    )


def overlap_ratio(line: dict[str, int], region: list[float]) -> float:
    left = max(float(line["x"]), region[0])
    top = max(float(line["y"]), region[1])
    right = min(float(line["x"] + line["width"]), region[2])
    bottom = min(float(line["y"] + line["height"]), region[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    return intersection / max(1.0, float(line["width"] * line["height"]))


def visual_line_count(paragraphs: list[dict[str, Any]]) -> int:
    if not paragraphs:
        return 0
    typical_height = float(np.median([item["bounds"]["height"] for item in paragraphs]))
    tolerance = max(4.0, typical_height * 0.6)
    centers = sorted(
        item["bounds"]["y"] + item["bounds"]["height"] / 2
        for item in paragraphs
    )
    rows: list[float] = []
    for center in centers:
        if not rows or abs(center - rows[-1]) > tolerance:
            rows.append(center)
        else:
            rows[-1] = (rows[-1] + center) / 2
    return len(rows)


def detect_horizontal_separators(image: np.ndarray) -> list[float]:
    """Find long ruled/grid lines without writing an intermediate image.

    Text normally occupies a small part of a scanline. A real horizontal rule
    differs from the surrounding background across much of the image width,
    including light-blue spreadsheet and document-editor separators.
    """
    height, width = image.shape[:2]
    if width < 80 or height < 24:
        return []
    border = np.concatenate((image[0], image[-1], image[:, 0], image[:, -1]), axis=0)
    background = np.median(border.astype(np.float32), axis=0)
    difference = np.max(np.abs(image.astype(np.float32) - background), axis=2)
    foreground = difference > 10
    longest_runs: list[int] = []
    for row in foreground:
        padded = np.concatenate(([False], row, [False])).astype(np.int8)
        transitions = np.diff(padded)
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        longest_runs.append(int(np.max(ends - starts)) if len(starts) else 0)
    # A ruled line is horizontally continuous. Long sentences may cover much
    # of the width in total, but spaces between glyphs keep every run short.
    candidate_rows = np.flatnonzero(np.asarray(longest_runs) >= width * 0.42)
    if not len(candidate_rows):
        return []
    groups: list[list[int]] = [[int(candidate_rows[0])]]
    for row in candidate_rows[1:]:
        if int(row) <= groups[-1][-1] + 1:
            groups[-1].append(int(row))
        else:
            groups.append([int(row)])
    max_thickness = max(5, round(height * 0.035))
    return [float(np.mean(group)) for group in groups if len(group) <= max_thickness]


def annotate_horizontal_breaks(paragraphs: list[dict[str, Any]], image: np.ndarray, offset_y: int) -> None:
    separators = [position + offset_y for position in detect_horizontal_separators(image)]
    if not separators or len(paragraphs) < 2:
        return
    typical_height = float(np.median([item["bounds"]["height"] for item in paragraphs]))
    tolerance = max(4.0, typical_height * 0.55)
    ordered = sorted(paragraphs, key=lambda item: (
        item["bounds"]["y"] + item["bounds"]["height"] / 2,
        item["bounds"]["x"],
    ))
    rows: list[list[dict[str, Any]]] = []
    for paragraph in ordered:
        center = paragraph["bounds"]["y"] + paragraph["bounds"]["height"] / 2
        if not rows:
            rows.append([paragraph])
            continue
        row_center = float(np.median([
            item["bounds"]["y"] + item["bounds"]["height"] / 2
            for item in rows[-1]
        ]))
        if abs(center - row_center) <= tolerance:
            rows[-1].append(paragraph)
        else:
            rows.append([paragraph])
    for index in range(1, len(rows)):
        previous_center = max(
            item["bounds"]["y"] + item["bounds"]["height"] / 2
            for item in rows[index - 1]
        )
        current_center = min(
            item["bounds"]["y"] + item["bounds"]["height"] / 2
            for item in rows[index]
        )
        if any(previous_center < separator < current_center for separator in separators):
            for item in rows[index]:
                item["hardBreakBefore"] = True


def annotate_layout(
    pool: EnginePool,
    paragraphs: list[dict[str, Any]],
    image: np.ndarray,
    offset_x: int,
    offset_y: int,
    ocr_group: str,
) -> tuple[bool, float]:
    if visual_line_count(paragraphs) < 2:
        return False, 0.0
    started = time.perf_counter()
    try:
        result = pool.get_layout(ocr_group)(image)
        boxes = list(result.boxes) if result.boxes is not None else []
        labels = list(result.class_names) if result.class_names is not None else []
        scores = [float(score) for score in result.scores] if result.scores is not None else []
        regions: list[tuple[str, str, list[float], float]] = []
        for index, (box, label, score) in enumerate(zip(boxes, labels, scores)):
            if score < 0.35:
                continue
            regions.append((
                f"layout-{index}",
                str(label).lower(),
                [float(box[0]) + offset_x, float(box[1]) + offset_y,
                 float(box[2]) + offset_x, float(box[3]) + offset_y],
                score,
            ))
        assigned = 0
        for paragraph in paragraphs:
            bounds = paragraph["bounds"]
            center_x = bounds["x"] + bounds["width"] / 2
            center_y = bounds["y"] + bounds["height"] / 2
            best: tuple[str, str, float] | None = None
            for block_id, layout_type, region, score in regions:
                ratio = overlap_ratio(bounds, region)
                center_inside = region[0] <= center_x <= region[2] and region[1] <= center_y <= region[3]
                match_score = max(ratio, 0.6 if center_inside else 0.0) * score
                if match_score >= 0.2 and (best is None or match_score > best[2]):
                    best = (block_id, layout_type, match_score)
            if best is not None:
                paragraph["layoutBlockId"] = best[0]
                paragraph["layoutType"] = best[1]
                assigned += 1
        return assigned > 0, round((time.perf_counter() - started) * 1000, 2)
    except Exception as error:
        print(f"[RapidLayout] {error}", file=sys.stderr)
        return False, round((time.perf_counter() - started) * 1000, 2)


def recognize(
    pool: EnginePool,
    image_data: str,
    recognition_mode: str = "multilingual",
) -> dict[str, Any]:
    image, offset_x, offset_y = trim_uniform_margin(decode_image(image_data))
    ocr_image = prepare_ocr_pixels(image)
    if recognition_mode == "zh-en-fast":
        # The Chinese PP-OCRv5 mobile recognizer includes Latin characters, so
        # one pass covers common Simplified Chinese and English screenshots.
        # Do not silently escalate to the large Server recognizer: fast mode
        # must remain predictable for users who explicitly selected speed.
        candidates = [run_candidate(pool, "cjk", ocr_image, offset_x, offset_y)]
    elif recognition_mode == "multilingual":
        candidates = [
            run_candidate(pool, group, ocr_image, offset_x, offset_y)
            for group in MODEL_GROUPS
        ]
    else:
        raise ValueError("不支持的文字识别模式。")
    best = select_candidate(candidates)
    high_accuracy_applied = (
        recognition_mode == "multilingual" and should_try_high_accuracy(best)
    )
    if high_accuracy_applied:
        candidates.append(run_candidate(
            pool,
            best.group,
            ocr_image,
            offset_x,
            offset_y,
            engine=pool.get_high_accuracy(),
        ))
        best = select_candidate(candidates)
    annotate_horizontal_breaks(best.paragraphs, image, offset_y)
    layout_applied, layout_elapsed_ms = annotate_layout(
        pool, best.paragraphs, image, offset_x, offset_y, best.group
    )
    return {
        "text": best.text,
        "confidence": round(best.confidence, 2),
        "paragraphs": best.paragraphs,
        "modelGroup": best.group,
        "layoutApplied": layout_applied,
        "layoutElapsedMs": layout_elapsed_ms,
        "highAccuracyApplied": high_accuracy_applied,
        "recognitionMode": recognition_mode,
    }


def respond(payload: dict[str, Any]) -> None:
    # ASCII JSON escapes keep the pipe byte-identical on Windows systems whose
    # legacy console encoding is GBK, while JSON.parse restores Unicode text.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> None:
    pool = EnginePool()
    respond({"type": "ready", "engine": "RapidOCR + RapidLayout", "version": "3.8.1/1.2.1"})
    for line in sys.stdin:
        request_id: Any = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("action") != "recognize":
                raise ValueError("不支持的 OCR 请求。")
            recognition_mode = request.get("recognitionMode", "multilingual")
            respond({"id": request_id, "ok": True, "result": recognize(
                pool, request["imageData"], recognition_mode
            )})
        except Exception as error:  # keep the long-lived process available for retry
            traceback.print_exc(file=sys.stderr)
            respond({"id": request_id, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
