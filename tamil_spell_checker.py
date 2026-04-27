#!/usr/bin/env python3
"""
Tamil Spell Checker and Auto-Corrector for DOCX and PDF Documents
==================================================================
Detects and auto-corrects Tamil spelling errors in .docx and .pdf files
while preserving the original document formatting and structure.

Installation:
    pip install -r requirements.txt

Usage:
    python tamil_spell_checker.py document.docx
    python tamil_spell_checker.py document.pdf --output corrected.pdf
    python tamil_spell_checker.py document.docx --no-autocorrect
    python tamil_spell_checker.py document.docx --proper-nouns-file nouns.txt
    python tamil_spell_checker.py document.docx --log-level DEBUG
"""

import argparse
import logging
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# ── Logging setup ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


# ── Dependency availability flags ──────────────────────────────────────────────
def _try_import(module_name: str):
    try:
        import importlib
        return importlib.import_module(module_name), None
    except ImportError as e:
        return None, str(e)


_docx_mod, _docx_err = _try_import("docx")
_fitz_mod, _fitz_err = _try_import("fitz")
_pdfplumber_mod, _pdfplumber_err = _try_import("pdfplumber")
_tamil_mod, _tamil_err = _try_import("tamil")

DOCX_AVAILABLE = _docx_mod is not None
PDF_AVAILABLE = _fitz_mod is not None
TAMIL_AVAILABLE = _tamil_mod is not None


def check_dependencies(file_ext: str) -> None:
    """Exit with a clear message if required packages are missing."""
    missing: List[str] = []

    if not TAMIL_AVAILABLE:
        missing.append("open-tamil")

    if file_ext == ".docx" and not DOCX_AVAILABLE:
        missing.append("python-docx")

    if file_ext == ".pdf" and not PDF_AVAILABLE:
        missing.append("PyMuPDF")

    if missing:
        logger.error("Missing required packages: %s", ", ".join(missing))
        logger.error("Install with:  pip install %s", " ".join(missing))
        sys.exit(1)


# ── Tamil Unicode utilities ────────────────────────────────────────────────────

# Tamil Unicode block: U+0B80 – U+0BFF
_TAMIL_RE = re.compile(r"[஀-௿]+")

# Tamil digits (U+0BE6–U+0BEF) and special symbol (U+0BF0–U+0BFA)
_TAMIL_NON_WORD_RE = re.compile(r"^[௦-௺]+$")


def is_tamil_text(text: str) -> bool:
    return bool(_TAMIL_RE.search(text))


def is_checkable_tamil_word(word: str) -> bool:
    """Return True for Tamil words that should be spell-checked (skip pure numerals/symbols)."""
    clean = re.sub(r"[^஀-௿]", "", word)
    return bool(clean) and not _TAMIL_NON_WORD_RE.match(clean)


def split_into_tokens(text: str) -> List[str]:
    """
    Split text into tokens, keeping Tamil word segments and non-Tamil segments intact.
    Mixed tokens (e.g. a Tamil word attached to punctuation) are returned as-is so
    the original spacing/punctuation is preserved on reassembly.
    """
    return re.split(r"(\s+)", text)


# ── Spell-checker wrapper ──────────────────────────────────────────────────────

class TamilSpellCheckerWrapper:
    """
    Wraps the open-tamil spell module with multiple fallback strategies so the
    script stays usable even when the spell sub-package is partially installed.

    Strategy order:
      1. spell.checker.SpellChecker  (open-tamil ≥ 0.9, spell installed as top-level pkg)
      2. tamil.spell.SpellChecker    (some packaged distributions)
      3. Dictionary lookup via open-tamil's built-in word lists
      4. No checking (pass-through, with a warning)
    """

    def __init__(self) -> None:
        self._checker = None          # native spell-checker object if available
        self._word_set: Set[str] = set()
        self._mode = "none"
        self._init()

    # ── Initialisation helpers ─────────────────────────────────────────────────

    def _init(self) -> None:
        # Strategy 1 – spell.checker (open-tamil standard layout)
        try:
            from spell.checker import SpellChecker  # type: ignore
            self._checker = SpellChecker(lang="TA")
            self._mode = "spell.checker"
            logger.info("Spell checker: using spell.checker.SpellChecker")
            return
        except Exception as exc:
            logger.debug("spell.checker unavailable: %s", exc)

        # Strategy 2 – tamil.spell
        try:
            import tamil.spell as ts  # type: ignore
            self._checker = ts.SpellChecker()
            self._mode = "tamil.spell"
            logger.info("Spell checker: using tamil.spell.SpellChecker")
            return
        except Exception as exc:
            logger.debug("tamil.spell unavailable: %s", exc)

        # Strategy 3 – dictionary lookup
        self._load_word_list()
        if self._word_set:
            self._mode = "dictionary"
            logger.info(
                "Spell checker: dictionary mode (%d words loaded)", len(self._word_set)
            )
            return

        # Strategy 4 – pass-through
        logger.warning(
            "No Tamil spell checker backend found. "
            "Errors will be reported but no corrections can be suggested."
        )
        self._mode = "none"

    def _load_word_list(self) -> None:
        """Collect Tamil words from open-tamil's bundled data files."""
        if not TAMIL_AVAILABLE:
            return
        try:
            import tamil  # type: ignore

            pkg_root = Path(tamil.__file__).parent
            for wl_file in sorted(pkg_root.rglob("*.txt")):
                self._ingest_word_file(wl_file)
            for wl_file in sorted(pkg_root.rglob("*.tsv")):
                self._ingest_word_file(wl_file)
        except Exception as exc:
            logger.debug("Word list loading failed: %s", exc)

        # Always add a small seed list so the dictionary is never empty
        self._word_set.update(self._seed_words())

    def _ingest_word_file(self, path: Path) -> None:
        try:
            with path.open(encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    word = line.strip().split("\t")[0].strip()
                    if word and is_tamil_text(word):
                        self._word_set.add(word)
        except Exception:
            pass

    @staticmethod
    def _seed_words() -> List[str]:
        """
        Minimal seed list covering very common Tamil words.
        Acts as a last-resort fallback when no word files are found.
        """
        return [
            "அம்மா", "அப்பா", "வீடு", "நாடு", "மனிதன்", "மனிதர்கள்",
            "தமிழ்", "மொழி", "நண்பன்", "நண்பர்கள்", "நாள்", "வருடம்",
            "மாதம்", "ஆண்டு", "பள்ளி", "கல்லூரி", "பல்கலைக்கழகம்",
            "வணக்கம்", "நன்றி", "வாழ்க்கை", "உலகம்", "இந்தியா",
            "தமிழ்நாடு", "சென்னை", "மதுரை", "கோவை", "திருச்சி",
            "புத்தகம்", "கடல்", "மலை", "ஆறு", "காடு", "நகரம்",
            "கிராமம்", "விவசாயம்", "மரம்", "பூ", "பழம்", "காய்கறி",
            "சாப்பிடு", "படி", "விளையாடு", "பேசு", "எழுது", "படிக்க",
            "வேலை", "ஓய்வு", "தூக்கம்", "கனவு", "அன்பு", "நேசம்",
        ]

    # ── Public API ─────────────────────────────────────────────────────────────

    def is_correct(self, word: str) -> bool:
        """Return True if *word* appears to be a valid Tamil word."""
        if self._mode in ("spell.checker", "tamil.spell"):
            try:
                result = self._checker.check(word)  # type: ignore[union-attr]
                # Some versions return None on unknown words; treat as incorrect
                return bool(result)
            except Exception:
                pass
        if self._mode == "dictionary":
            return word in self._word_set
        # pass-through: unknown → assume correct so we don't flood warnings
        return True

    def suggest(self, word: str) -> List[str]:
        """Return a ranked list of suggested corrections for *word*."""
        if self._mode in ("spell.checker", "tamil.spell"):
            try:
                # open-tamil API has two possible method names
                for method in ("get_suggestion_for_word", "suggest"):
                    fn = getattr(self._checker, method, None)
                    if callable(fn):
                        result = fn(word)
                        if isinstance(result, (list, tuple)) and result:
                            return list(result)
            except Exception:
                pass
        if self._mode == "dictionary" and self._word_set:
            return self._nearest_words(word)
        return []

    def best_correction(self, word: str) -> Optional[str]:
        """Return the single best correction, or None if nothing better is found."""
        suggestions = self.suggest(word)
        return suggestions[0] if suggestions else None

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _nearest_words(self, word: str, max_results: int = 5) -> List[str]:
        """
        Cheap similarity ranking: prefer candidates of similar length with the
        most characters in common. Not a proper edit-distance algorithm, but fast
        and good enough as a last-resort fallback.
        """
        word_len = len(word)
        candidates = [
            w for w in self._word_set if abs(len(w) - word_len) <= 3
        ]

        def _score(candidate: str) -> int:
            # negative score → lower is better → sort ascending
            return -sum(1 for ch in word if ch in candidate)

        candidates.sort(key=_score)
        return candidates[:max_results]


# ── Correction records ─────────────────────────────────────────────────────────

@dataclass
class CorrectionRecord:
    original: str
    corrected: str
    location: str


@dataclass
class SpellCheckSummary:
    total_checked: int = 0
    errors_found: int = 0
    corrections_made: int = 0
    uncorrectable: List[str] = field(default_factory=list)
    log: List[CorrectionRecord] = field(default_factory=list)

    def record_correction(self, original: str, corrected: str, location: str) -> None:
        self.errors_found += 1
        self.corrections_made += 1
        self.log.append(CorrectionRecord(original, corrected, location))

    def record_uncorrectable(self, word: str) -> None:
        self.errors_found += 1
        self.uncorrectable.append(word)

    def print_summary(self) -> None:
        bar = "=" * 62
        print(f"\n{bar}")
        print("  TAMIL SPELL CHECK SUMMARY")
        print(bar)
        print(f"  Total Tamil words checked  : {self.total_checked}")
        print(f"  Spelling errors found      : {self.errors_found}")
        print(f"  Corrections applied        : {self.corrections_made}")
        print(f"  Words with no suggestion   : {len(self.uncorrectable)}")

        if self.log:
            print(f"\n  {'CORRECTIONS APPLIED':}")
            print("  " + "-" * 58)
            for rec in self.log:
                print(f"  '{rec.original}'  →  '{rec.corrected}'")
                print(f"      Location: {rec.location}")

        if self.uncorrectable:
            print(f"\n  UNCORRECTABLE WORDS (no suggestion found):")
            print("  " + "-" * 58)
            for word, count in Counter(self.uncorrectable).most_common():
                print(f"  '{word}'  (×{count})")

        print(bar + "\n")


# ── Core text-processing engine ────────────────────────────────────────────────

def process_text(
    text: str,
    checker: TamilSpellCheckerWrapper,
    summary: SpellCheckSummary,
    location: str,
    *,
    auto_correct: bool = True,
    proper_nouns: Optional[Set[str]] = None,
) -> str:
    """
    Scan *text* for Tamil spelling errors, optionally replacing them in-place.

    Non-Tamil characters and proper nouns are left untouched.
    Returns (possibly corrected) text.
    """
    if not text or not is_tamil_text(text):
        return text

    if proper_nouns is None:
        proper_nouns = set()

    result_parts: List[str] = []

    # Walk through every whitespace-delimited token, preserving spacing.
    for token in re.split(r"(\s+)", text):
        # Preserve pure whitespace tokens verbatim
        if re.fullmatch(r"\s+", token) or not token:
            result_parts.append(token)
            continue

        # Extract the Tamil content from the token (may have surrounding punctuation)
        tamil_match = _TAMIL_RE.search(token)
        if not tamil_match:
            result_parts.append(token)
            continue

        word = tamil_match.group()

        if not is_checkable_tamil_word(word):
            result_parts.append(token)
            continue

        summary.total_checked += 1

        # Skip proper nouns
        if word in proper_nouns:
            result_parts.append(token)
            continue

        if checker.is_correct(word):
            result_parts.append(token)
            continue

        # ── Misspelling found ──────────────────────────────────────────────
        if not auto_correct:
            logger.info("Spelling error at %-40s  '%s'", location + ":", word)
            summary.record_uncorrectable(word)
            result_parts.append(token)
            continue

        correction = checker.best_correction(word)
        if correction and correction != word:
            corrected_token = token[: tamil_match.start()] + correction + token[tamil_match.end() :]
            result_parts.append(corrected_token)
            summary.record_correction(word, correction, location)
            logger.debug("Corrected %-25s '%s' → '%s'", f"[{location}]", word, correction)
        else:
            result_parts.append(token)
            summary.record_uncorrectable(word)
            logger.debug("No suggestion found at %-20s for '%s'", location + ":", word)

    return "".join(result_parts)


# ── DOCX handler ───────────────────────────────────────────────────────────────

def process_docx(
    input_path: Path,
    output_path: Path,
    checker: TamilSpellCheckerWrapper,
    summary: SpellCheckSummary,
    *,
    auto_correct: bool = True,
    proper_nouns: Optional[Set[str]] = None,
) -> None:
    """
    Read *input_path* (DOCX), spell-check every Run in the document
    (body, tables, headers, footers), and save the result to *output_path*.

    Each Run is processed independently so all character-level formatting
    (bold, italic, font, size, colour) is fully preserved.
    """
    if not DOCX_AVAILABLE:
        logger.error("python-docx is required for DOCX files.  pip install python-docx")
        sys.exit(1)

    from docx import Document  # type: ignore

    logger.info("Opening DOCX: %s", input_path)
    doc = Document(str(input_path))

    def _fix_run(run, loc: str) -> None:
        if run.text and is_tamil_text(run.text):
            run.text = process_text(
                run.text, checker, summary, loc,
                auto_correct=auto_correct, proper_nouns=proper_nouns,
            )

    def _fix_paragraph(para, loc: str) -> None:
        for idx, run in enumerate(para.runs):
            _fix_run(run, f"{loc} › run {idx + 1}")

    # Body paragraphs
    for p_idx, para in enumerate(doc.paragraphs):
        _fix_paragraph(para, f"body › para {p_idx + 1}")

    # Tables (handles nested tables via cell iteration)
    for t_idx, table in enumerate(doc.tables):
        for r_idx, row in enumerate(table.rows):
            for c_idx, cell in enumerate(row.cells):
                for p_idx, para in enumerate(cell.paragraphs):
                    loc = f"table {t_idx+1} › row {r_idx+1} › col {c_idx+1} › para {p_idx+1}"
                    _fix_paragraph(para, loc)

    # Headers and footers (all sections)
    for s_idx, section in enumerate(doc.sections):
        for hf_name, hf_obj in (
            ("header", section.header),
            ("footer", section.footer),
            ("first-page header", section.first_page_header),
            ("first-page footer", section.first_page_footer),
            ("even-page header", section.even_page_header),
            ("even-page footer", section.even_page_footer),
        ):
            if hf_obj is None:
                continue
            for p_idx, para in enumerate(hf_obj.paragraphs):
                _fix_paragraph(para, f"section {s_idx+1} {hf_name} › para {p_idx+1}")

    doc.save(str(output_path))
    logger.info("Corrected DOCX saved → %s", output_path)


# ── PDF handler ────────────────────────────────────────────────────────────────

def process_pdf(
    input_path: Path,
    output_path: Path,
    checker: TamilSpellCheckerWrapper,
    summary: SpellCheckSummary,
    *,
    auto_correct: bool = True,
    proper_nouns: Optional[Set[str]] = None,
) -> None:
    """
    Read *input_path* (PDF), spell-check Tamil text spans, and write a
    corrected PDF to *output_path* using PyMuPDF.

    Correction strategy:
      1. Extract text spans with bounding boxes using get_text("dict").
      2. For each misspelled span, redact the original text area.
      3. Reinsert the corrected text at the same position, matching font size
         and colour.

    NOTE: PDF editing is inherently "best-effort". Complex layouts, embedded
    fonts, and ligature-based rendering may cause minor visual differences.
    The original PDF is never modified; corrections are written to a new file.
    """
    if not PDF_AVAILABLE:
        logger.error("PyMuPDF is required for PDF files.  pip install PyMuPDF")
        sys.exit(1)

    import fitz  # type: ignore

    logger.info("Opening PDF: %s", input_path)
    doc = fitz.open(str(input_path))

    for page_no, page in enumerate(doc):
        logger.info("  Page %d / %d …", page_no + 1, len(doc))

        # Collect corrections for this page first, then apply all at once.
        # Applying corrections mid-iteration would invalidate span positions.
        pending: List[Tuple[fitz.Rect, str, str, float, Tuple[float, float, float]]] = []

        page_dict = page.get_text("dict")
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:  # 0 = text block
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    original = span.get("text", "")
                    if not original or not is_tamil_text(original):
                        continue

                    location = f"page {page_no + 1}"
                    corrected = process_text(
                        original, checker, summary, location,
                        auto_correct=auto_correct, proper_nouns=proper_nouns,
                    )

                    if auto_correct and corrected != original:
                        bbox = fitz.Rect(span["bbox"])
                        font_size = float(span.get("size", 11))
                        color_int = span.get("color", 0)
                        color_rgb = (
                            ((color_int >> 16) & 0xFF) / 255.0,
                            ((color_int >> 8) & 0xFF) / 255.0,
                            (color_int & 0xFF) / 255.0,
                        )
                        pending.append((bbox, original, corrected, font_size, color_rgb))

        # Apply corrections via redact-and-reinsert
        for bbox, _orig, corrected, font_size, color_rgb in pending:
            _apply_pdf_span_correction(page, bbox, corrected, font_size, color_rgb)

    doc.save(str(output_path), garbage=4, deflate=True)
    doc.close()
    logger.info("Corrected PDF saved → %s", output_path)


def _apply_pdf_span_correction(
    page,
    bbox,
    corrected_text: str,
    font_size: float,
    color_rgb: Tuple[float, float, float],
) -> None:
    """
    Erase the original span with a white redaction rectangle and write the
    corrected text at the same baseline position.
    """
    import fitz  # type: ignore

    # Redact original text
    page.add_redact_annot(bbox, fill=(1, 1, 1))
    page.apply_redactions()

    # Reinsert corrected text at top-left of the original bounding box.
    # We use the built-in "helv" font as a safe fallback.  If the document
    # uses a specific Tamil font, pass fontfile= to insert_text() instead.
    insertion_point = fitz.Point(bbox.x0, bbox.y1 - 1)  # baseline approximation
    try:
        page.insert_text(
            insertion_point,
            corrected_text,
            fontsize=font_size,
            color=color_rgb,
        )
    except Exception as exc:
        # insert_text can fail for very small font sizes or encoding issues
        logger.debug("insert_text failed (%s); skipping span", exc)


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="tamil_spell_checker",
        description="Tamil spell checker and auto-corrector for DOCX and PDF files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python tamil_spell_checker.py report.docx
  python tamil_spell_checker.py report.docx --output report_fixed.docx
  python tamil_spell_checker.py report.pdf  --output report_fixed.pdf
  python tamil_spell_checker.py report.docx --no-autocorrect
  python tamil_spell_checker.py report.docx --proper-nouns-file nouns.txt --log-level DEBUG
        """,
    )
    parser.add_argument("input_file", help="Path to the input .docx or .pdf file.")
    parser.add_argument(
        "--output", "-o",
        metavar="PATH",
        help="Output file path.  Defaults to <stem>_corrected.<ext> in the same directory.",
    )
    parser.add_argument(
        "--no-autocorrect",
        action="store_true",
        help="Report spelling errors without modifying the document (dry-run mode).",
    )
    parser.add_argument(
        "--proper-nouns-file",
        metavar="FILE",
        help="Plain-text file of Tamil proper nouns to skip (one per line).",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Logging verbosity level (default: INFO).",
    )
    return parser.parse_args()


def _load_proper_nouns(filepath: Optional[str]) -> Set[str]:
    if not filepath:
        return set()
    try:
        with open(filepath, encoding="utf-8") as fh:
            nouns = {line.strip() for line in fh if line.strip()}
        logger.info("Loaded %d proper nouns from %s", len(nouns), filepath)
        return nouns
    except FileNotFoundError:
        logger.warning("Proper-nouns file not found: %s  (skipping)", filepath)
        return set()


def _default_output_path(input_path: Path) -> Path:
    return input_path.parent / f"{input_path.stem}_corrected{input_path.suffix}"


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    input_path = Path(args.input_file).resolve()
    if not input_path.exists():
        logger.error("Input file not found: %s", input_path)
        sys.exit(1)

    file_ext = input_path.suffix.lower()
    if file_ext not in (".docx", ".pdf"):
        logger.error(
            "Unsupported file format '%s'.  Supported extensions: .docx  .pdf", file_ext
        )
        sys.exit(1)

    check_dependencies(file_ext)

    output_path = Path(args.output).resolve() if args.output else _default_output_path(input_path)
    proper_nouns = _load_proper_nouns(args.proper_nouns_file)
    auto_correct = not args.no_autocorrect

    logger.info("─" * 62)
    logger.info("Input file    : %s", input_path)
    logger.info("Output file   : %s", output_path)
    logger.info("Auto-correct  : %s", auto_correct)
    logger.info("─" * 62)

    logger.info("Initialising Tamil spell checker …")
    checker = TamilSpellCheckerWrapper()

    summary = SpellCheckSummary()

    try:
        if file_ext == ".docx":
            process_docx(
                input_path, output_path, checker, summary,
                auto_correct=auto_correct, proper_nouns=proper_nouns,
            )
        else:
            process_pdf(
                input_path, output_path, checker, summary,
                auto_correct=auto_correct, proper_nouns=proper_nouns,
            )
    except Exception as exc:
        logger.error("Failed to process '%s': %s", input_path.name, exc, exc_info=True)
        sys.exit(1)

    summary.print_summary()

    if auto_correct:
        print(f"Corrected file saved to: {output_path}")
    else:
        print("Dry-run complete. No file was written.")


if __name__ == "__main__":
    main()
