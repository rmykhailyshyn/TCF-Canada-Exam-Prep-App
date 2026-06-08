#!/usr/bin/env python3
"""Parse a Réussir TCF Canada "results" PDF into structured JSON.

spec: docs/specs/reading-import.md §PDF structure (shared with listening-import.md)

Reads the score summary and every question block (sequence, text, options A-D with text and
fill colour, and the per-question Correcte/Incorrecte label). Correct answers are detected from
the GREEN fill on the option's rounded-rectangle background, which print-to-PDF emits as bezier
`curves` (NOT `rects`) — see the spec's "Validated against a real results PDF" note.

Usage:  python3 parse_results_pdf.py <path-to-pdf>
Output: JSON document on stdout. On a parse failure, a message on stderr and a non-zero exit.

This script does NOT touch the database; persistence is handled by the TS orchestrator
(scripts/ocr.ts) so all DB access stays in Drizzle (see CLAUDE.md §Drizzle).
"""

import json
import re
import sys

try:
    import pdfplumber
except ImportError:  # pragma: no cover - environment guard
    sys.stderr.write(
        "pdfplumber is not installed. Run: scripts/.venv/bin/pip install -r scripts/requirements.txt\n"
    )
    sys.exit(2)

# Validated fill colours (RGB 0-1) — see spec §PDF structure.
GREEN = (0.0, 0.7372549, 0.2705882)
REDS = [(0.8392157, 0.1137255, 0.1137255), (0.8862745, 0.05098039, 0.05098039)]
GRAY = (0.9411765, 0.9529412, 0.9647059)
TOLERANCE = 0.06


def _close(a, b, tol=TOLERANCE):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def _classify(color):
    if not isinstance(color, (tuple, list)) or len(color) != 3:
        return None
    if _close(color, GREEN):
        return "green"
    if any(_close(color, r) for r in REDS):
        return "red"
    if _close(color, GRAY):
        return "gray"
    return None


def _collect(pdf):
    """Return (answer_row_curves, lines) across all pages.

    answer_row_curves: list of {page, top, bottom, x0, color} for option-row backgrounds.
    lines: list of {page, top, text} clustered word lines in reading order.
    """
    rows = []
    raw_words = []
    for pi, page in enumerate(pdf.pages):
        for c in page.curves:
            width = c["x1"] - c["x0"]
            height = c["bottom"] - c["top"]
            cls = _classify(c.get("non_stroking_color"))
            # Option rows: width ~ 746, height ~ 58. x0 differs by section (~898 listening,
            # ~844 reading), so accept a wide band.
            if 300 < width and 40 < height < 80 and 780 < c["x0"] < 940 and cls:
                rows.append({"page": pi, "top": c["top"], "bottom": c["bottom"], "x0": c["x0"], "color": cls})
        for w in page.extract_words():
            raw_words.append((pi, w["top"], w["x0"], w["text"]))

    # De-duplicate rows: one rounded rect is drawn as several overlapping curves
    # (spec §PDF structure). Merge by (page, ~top, ~x0); keep a non-gray classification.
    rows.sort(key=lambda r: (r["page"], r["top"], r["x0"]))
    merged = []
    for r in rows:
        prev = merged[-1] if merged else None
        if (
            prev
            and prev["page"] == r["page"]
            and abs(prev["top"] - r["top"]) < 6
            and abs(prev["x0"] - r["x0"]) < 6
        ):
            if r["color"] != "gray" and prev["color"] == "gray":
                prev["color"] = r["color"]
            continue
        merged.append(r)

    # Cluster words into lines by (page, top).
    raw_words.sort(key=lambda w: (w[0], w[1], w[2]))
    lines = []
    current = None
    for pi, top, x0, text in raw_words:
        if current and current["page"] == pi and abs(current["top"] - top) < 12:
            current["parts"].append((x0, text))
        else:
            current = {"page": pi, "top": top, "parts": [(x0, text)]}
            lines.append(current)
    for line in lines:
        line["text"] = " ".join(t for _, t in sorted(line["parts"], key=lambda p: p[0]))
    return merged, lines


def _color_for(rows, page, ytop):
    for r in rows:
        if r["page"] == page and r["top"] - 4 <= ytop <= r["bottom"] + 4:
            return r["color"]
    return None


def _parse_score_summary(text):
    correct = re.search(r"(\d+)\s+de\s+\d+\s+réponses\s+correctes", text)
    points = re.search(r"You have reached\s+(\d+)\s+of\s+(\d+)\s+point", text)
    time_m = re.search(r"Votre temps:\s*([\d:]+)", text)
    if not correct or not points:
        return None
    return {
        "correctCount": int(correct.group(1)),
        "totalPoints": int(points.group(1)),
        "maxPoints": int(points.group(2)),
        "time": time_m.group(1) if time_m else None,
    }


# Option line: "<A-D> 88 <optional text>". The mandatory "88" icon glyph (spec §PDF structure)
# anchors real option rows and prevents passage text starting with A-D from matching.
_OPTION_RE = re.compile(r"^([ABCD])\s+88\s*(.*)$")
# Listening question header, e.g. "7. Question" (reading PDFs have no such header).
_QUESTION_RE = re.compile(r"^(\d+)\.\s+Question$")
# Audio play-range timestamps (listening only), e.g. "00:11 00:46" — ignored (spec §PDF structure).
_TIMESTAMP_RE = re.compile(r"^\d{1,2}:\d{2}(?:\s+\d{1,2}:\d{2})*$")


def _parse_questions(rows, lines):
    """Detect questions by their option block + result label, in document order.

    Sequence is the 1-based position (both PDFs list questions in order). Listening PDFs carry a
    "N. Question" header followed by the instruction text, captured as `text`; reading PDFs have
    neither (the question text lives in the per-question image and is OCR'd by the orchestrator),
    so `text` is empty there.
    """
    questions = []
    options = {}
    instruction_parts = []
    capturing_instruction = False

    for line in lines:
        text = line["text"]

        # Listening: a header starts a fresh instruction capture.
        if _QUESTION_RE.match(text):
            capturing_instruction = True
            instruction_parts = []
            continue

        option = _OPTION_RE.match(text)
        if option:
            capturing_instruction = False
            label = option.group(1)
            if label not in options:
                color = _color_for(rows, line["page"], line["top"])
                options[label] = {"label": label, "text": option.group(2).strip(), "color": color}
            continue

        if text in ("Correcte", "Incorrecte"):
            # Close the question only if we actually collected options (skips the legend at the
            # top of the page, which renders "Correcte"/"Incorrecte" with no options).
            if options:
                ordered = [options[k] for k in ("A", "B", "C", "D") if k in options]
                questions.append(
                    {
                        "sequence": len(questions) + 1,
                        "text": " ".join(instruction_parts).strip(),
                        "options": ordered,
                        "result": text,
                    }
                )
                options = {}
                instruction_parts = []
            continue

        if capturing_instruction and not _TIMESTAMP_RE.match(text):
            instruction_parts.append(text)

    return questions


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("Usage: parse_results_pdf.py <path-to-pdf>\n")
        sys.exit(2)
    path = sys.argv[1]
    try:
        pdf = pdfplumber.open(path)
    except Exception as exc:  # noqa: BLE001 - report any open/parse failure to the caller
        sys.stderr.write(f"Failed to open PDF: {exc}\n")
        sys.exit(1)

    full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    summary = _parse_score_summary(full_text)
    rows, lines = _collect(pdf)
    questions = _parse_questions(rows, lines)

    if summary is None:
        sys.stderr.write("Score summary not found — not a recognised results PDF.\n")
        sys.exit(1)
    if not questions:
        sys.stderr.write("No question blocks found in the PDF.\n")
        sys.exit(1)

    json.dump({"scoreSummary": summary, "questions": questions}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
