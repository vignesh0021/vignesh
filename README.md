# Tamil Spell Checker

A production-ready command-line tool that detects and auto-corrects Tamil spelling
errors in **DOCX** and **PDF** documents while preserving all original formatting.

---

## Table of Contents

1. [Features](#features)
2. [Requirements](#requirements)
3. [Installation](#installation)
   - [System Dependencies](#system-dependencies)
   - [Python Packages](#python-packages)
   - [Tamil Font Setup (PDF only)](#tamil-font-setup-pdf-only)
4. [Quick Start](#quick-start)
5. [Usage](#usage)
   - [Basic Syntax](#basic-syntax)
   - [All Options](#all-options)
6. [Examples](#examples)
   - [DOCX Examples](#docx-examples)
   - [PDF Examples](#pdf-examples)
7. [How It Works](#how-it-works)
   - [Spell Checker Backends](#spell-checker-backends)
   - [DOCX Processing](#docx-processing)
   - [PDF Processing](#pdf-processing)
8. [Proper Nouns File](#proper-nouns-file)
9. [Output and Logs](#output-and-logs)
   - [Summary Report](#summary-report)
   - [Log Levels](#log-levels)
10. [Limitations and Known Constraints](#limitations-and-known-constraints)
11. [Troubleshooting](#troubleshooting)
12. [File Safety](#file-safety)
13. [Project Structure](#project-structure)

---

## Features

- Detects Tamil spelling errors using the **open-tamil** library with four fallback strategies
- Auto-corrects mistakes directly inside the document, writing a clean output file
- Supports **.docx** (Microsoft Word) and **.pdf** file formats
- Preserves all original formatting — fonts, sizes, bold/italic, colours, tables, headers, footers
- Processes DOCX **text boxes** (DrawingML) in addition to body text
- Handles **mixed Tamil-English** documents — only Tamil words are checked
- Excludes **proper nouns** via a user-supplied list
- **Dry-run mode** to report errors without modifying any file
- Detects **scanned PDFs** (image-only, no text layer) and warns instead of silently failing
- File size guard to prevent out-of-memory on oversized inputs
- Overwrite protection — never silently clobbers an existing file
- Detailed **correction log** and **summary report** after every run

---

## Requirements

| Requirement | Version | Purpose |
|---|---|---|
| Python | ≥ 3.8 | Runtime |
| open-tamil | ≥ 0.9 | Tamil spell checking and text utilities |
| python-docx | ≥ 0.8.11 | Reading and writing DOCX files |
| PyMuPDF | ≥ 1.23.0 | Reading and editing PDF files |
| A Tamil font file | any | Required for PDF auto-correction only |

---

## Installation

### System Dependencies

**Ubuntu / Debian**
```bash
sudo apt update
sudo apt install python3 python3-pip
```

**Fedora / RHEL**
```bash
sudo dnf install python3 python3-pip
```

**macOS** (with Homebrew)
```bash
brew install python
```

**Windows**

Download and install Python 3.8+ from https://www.python.org/downloads/ and
make sure to check **"Add Python to PATH"** during setup.

---

### Python Packages

Clone or download the project, then install all Python dependencies at once:

```bash
pip install -r requirements.txt
```

Or install them individually:

```bash
pip install open-tamil python-docx PyMuPDF
```

> **Tip:** Use a virtual environment to keep dependencies isolated:
> ```bash
> python -m venv venv
> source venv/bin/activate   # Windows: venv\Scripts\activate
> pip install -r requirements.txt
> ```

---

### Tamil Font Setup (PDF only)

PDF auto-correction requires a Tamil-capable font to reinsert corrected text.
The tool searches common system font directories automatically. If it cannot
find one, it will print an error with installation instructions.

**Ubuntu / Debian — install Lohit Tamil**
```bash
sudo apt install fonts-lohit-taml
```

**Fedora**
```bash
sudo dnf install lohit-tamil-fonts
```

**Ubuntu / Debian — install Noto Sans Tamil (recommended)**
```bash
sudo apt install fonts-noto-core
```

**macOS**

Tamil fonts are bundled with macOS. No extra installation is needed.

**Windows**

Latha (`latha.ttf`) ships with Windows by default. No extra installation needed.

**Manual font path**

If the tool cannot auto-detect a font, point it to one explicitly:
```bash
python tamil_spell_checker.py document.pdf --tamil-font /path/to/NotoSansTamil-Regular.ttf
```

> **DOCX files do not need a Tamil font.** Font detection only applies to PDF correction.

---

## Quick Start

```bash
# Check a DOCX file and auto-correct it
python tamil_spell_checker.py my_document.docx

# Check a PDF file and auto-correct it
python tamil_spell_checker.py my_document.pdf

# Only report errors — do not change any file
python tamil_spell_checker.py my_document.docx --no-autocorrect
```

The corrected file is saved as `my_document_corrected.docx` (or `.pdf`) in the
same directory as the input unless you specify a different path with `--output`.

---

## Usage

### Basic Syntax

```
python tamil_spell_checker.py <input_file> [OPTIONS]
```

### All Options

| Option | Short | Default | Description |
|---|---|---|---|
| `input_file` | — | *(required)* | Path to the `.docx` or `.pdf` file to process |
| `--output PATH` | `-o` | `<stem>_corrected.<ext>` | Custom path for the output file |
| `--no-autocorrect` | — | off | Dry-run mode: report errors only, write nothing |
| `--proper-nouns-file FILE` | — | none | Path to a plain-text file of Tamil proper nouns to skip |
| `--tamil-font FILE` | — | auto-detect | Path to a Tamil `.ttf`/`.otf`/`.ttc` font (PDF only) |
| `--max-size MB` | — | `50` | Maximum input file size in megabytes |
| `--force` | — | off | Overwrite the output file if it already exists |
| `--log-level LEVEL` | — | `INFO` | Verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

---

## Examples

### DOCX Examples

**1. Auto-correct a DOCX file (simplest usage)**
```bash
python tamil_spell_checker.py report.docx
```
Saves corrected output to `report_corrected.docx` in the same folder.

---

**2. Specify a custom output path**
```bash
python tamil_spell_checker.py report.docx --output /home/user/final_report.docx
```

---

**3. Dry run — see all errors without changing anything**
```bash
python tamil_spell_checker.py report.docx --no-autocorrect
```
Useful before committing to auto-correction. Every spelling error is printed
to the terminal with its location (paragraph number and run number).

---

**4. Skip proper nouns**
```bash
python tamil_spell_checker.py report.docx --proper-nouns-file proper_nouns.txt
```
Words in `proper_nouns.txt` are never flagged, even if they are not in the
dictionary. See [Proper Nouns File](#proper-nouns-file) for the file format.

---

**5. Process a large document (raise the size limit)**
```bash
python tamil_spell_checker.py large_book.docx --max-size 200
```

---

**6. Overwrite an existing output file**
```bash
python tamil_spell_checker.py report.docx --output report_corrected.docx --force
```

---

**7. Debug — see every word checked and every decision made**
```bash
python tamil_spell_checker.py report.docx --log-level DEBUG
```

---

**8. Combine multiple options**
```bash
python tamil_spell_checker.py report.docx \
  --output /tmp/report_fixed.docx \
  --proper-nouns-file nouns.txt \
  --log-level DEBUG \
  --force
```

---

### PDF Examples

**1. Auto-correct a PDF (Tamil font auto-detected)**
```bash
python tamil_spell_checker.py report.pdf
```
The tool searches common system font directories automatically.

---

**2. Specify a Tamil font explicitly**
```bash
python tamil_spell_checker.py report.pdf \
  --tamil-font /usr/share/fonts/truetype/lohit-tamil/Lohit-Tamil.ttf
```

---

**3. Dry run on a PDF (no font needed)**
```bash
python tamil_spell_checker.py report.pdf --no-autocorrect
```
Reporting-only mode never rewrites text, so no Tamil font is required.

---

**4. PDF with custom output and font**
```bash
python tamil_spell_checker.py annual_report.pdf \
  --output annual_report_corrected.pdf \
  --tamil-font /usr/share/fonts/opentype/noto/NotoSansTamil-Regular.ttf \
  --proper-nouns-file proper_nouns.txt
```

---

## How It Works

### Spell Checker Backends

The tool initialises its spell checker using the following priority order.
It uses the first backend that loads successfully.

| Priority | Backend | How to enable |
|---|---|---|
| 1 | `spell.checker.SpellChecker` | Installed automatically with `open-tamil` ≥ 0.9 |
| 2 | `tamil.spell.SpellChecker` | Alternative open-tamil packaging layout |
| 3 | Dictionary lookup (open-tamil word files) | Automatic fallback if spell module unavailable |
| 4 | Pass-through (no checking) | Last resort — logs a warning at startup |

The active backend is printed at startup:
```
2025-01-01 12:00:00 [INFO] Spell checker: using spell.checker.SpellChecker
```

**How words are corrected (dictionary mode)**

When the native spell checker is unavailable, the tool falls back to a
word-list loaded from open-tamil's bundled data files. Suggestions are ranked
by **Levenshtein edit distance** — the number of single-character insertions,
deletions, or substitutions needed to transform the misspelled word into the
candidate. The candidate with the smallest distance is applied as the correction.

---

### DOCX Processing

The tool processes every text-bearing element in a DOCX file:

| Element | What is processed |
|---|---|
| Body text | All paragraphs and their runs |
| Tables | Every cell in every row of every table |
| Headers | All three header variants (default, first-page, even-page) |
| Footers | All three footer variants (default, first-page, even-page) |
| Text boxes | DrawingML `<wps:txbx>` shapes (not exposed by the standard API) |

Each **Run** (the smallest formatting unit in a DOCX file) is processed
independently. This means bold, italic, underline, font family, font size,
and colour are all preserved exactly as-is. Only the text content changes.

---

### PDF Processing

PDF text editing is more complex than DOCX because PDFs are not designed
to be edited. The tool uses a three-pass strategy per page:

**Pass 1 — Extraction**
Each page is parsed with PyMuPDF's `get_text("dict")` which returns every
text span with its bounding box, font size, and colour.

**Pass 2 — Redaction (batched)**
All misspelled spans on the page are marked for redaction simultaneously,
then `apply_redactions()` is called once. This is critical: calling it once
per span shifts the page geometry and misaligns all subsequent corrections.

**Pass 3 — Reinsertion**
Corrected text is inserted at the original bounding box position using the
Tamil font. Font size and text colour from the original span are matched.

> **Note:** PDF editing is inherently "best-effort". Documents with complex
> multi-column layouts, overlapping elements, or proprietary font encodings
> may show minor visual differences in corrected spans.

**Scanned PDF detection**

The tool samples up to the first 10 pages. If none of them contain extractable
text but they all contain embedded images, the document is treated as a scan.
The tool exits with a warning and recommends using an OCR tool first:
```
sudo apt install ocrmypdf
ocrmypdf input.pdf input_with_text.pdf
python tamil_spell_checker.py input_with_text.pdf
```

---

## Proper Nouns File

Create a plain UTF-8 text file with one Tamil word per line:

```
# Lines starting with # are comments and are ignored
சென்னை
மதுரை
திருவனந்தபுரம்
ஐயா
அம்பேத்கர்
```

Pass it to the tool:
```bash
python tamil_spell_checker.py report.docx --proper-nouns-file proper_nouns.txt
```

Words in this file are compared exactly (case-sensitive for Tamil script) and
skipped even if the spell checker flags them as errors.

---

## Output and Logs

### Summary Report

After processing, the tool always prints a summary:

```
══════════════════════════════════════════════════════════════
  TAMIL SPELL CHECK SUMMARY
══════════════════════════════════════════════════════════════
  Total Tamil words checked  : 1423
  Spelling errors found      : 8
  Corrections applied        : 6
  Words with no suggestion   : 2

  CORRECTIONS APPLIED:
  ──────────────────────────────────────────────────────────
  'வணககம்'  →  'வணக்கம்'
      Location: body › para 3 › run 1
  'படிகிறன்'  →  'படிக்கிறான்'
      Location: body › para 7 › run 2

  UNCORRECTABLE WORDS (no suggestion found):
  ──────────────────────────────────────────────────────────
  'அவர்கலுக்கு'  (×2)
══════════════════════════════════════════════════════════════
```

**Total Tamil words checked** — count of Tamil tokens examined  
**Spelling errors found** — total errors (corrected + uncorrectable combined)  
**Corrections applied** — errors where a suggestion was found and applied  
**Words with no suggestion** — errors where the spell checker had no fix  

Uncorrectable words listed with `(×N)` show how many times they appear.
These require manual review.

---

### Log Levels

Control verbosity with `--log-level`:

| Level | What you see |
|---|---|
| `ERROR` | Only fatal errors that stop the tool |
| `WARNING` | Errors plus important warnings (e.g. scanned PDF, missing font) |
| `INFO` *(default)* | Normal progress messages and correction counts |
| `DEBUG` | Every word checked, every correction decision, every skipped span |

Example — see exactly what the tool is doing:
```bash
python tamil_spell_checker.py report.docx --log-level DEBUG 2>&1 | tee debug.log
```

---

## Limitations and Known Constraints

### Tamil Morphology

Tamil is an **agglutinative language** — a single root word can have hundreds
of valid inflected forms (e.g. `படி` → `படிக்கிறான்`, `படித்தார்கள்`).
Dictionary-based backends may flag some valid inflected forms as errors because
they only store root forms. If you see false positives, add those forms to your
`--proper-nouns-file` as a workaround until a morphology-aware backend is used.

### PDF Layout Changes

Reinserted text may not perfectly match the original visual layout when:
- The corrected word is significantly longer or shorter than the original
- The document uses a proprietary or embedded-subset Tamil font
- The page uses right-to-left or complex bidirectional text flows

Always visually inspect the corrected PDF before distributing it.

### Scanned PDFs

Scanned PDFs contain images of text, not actual text. This tool cannot correct
them. Run OCR first:
```bash
pip install ocrmypdf
ocrmypdf input_scan.pdf input_with_text.pdf
python tamil_spell_checker.py input_with_text.pdf
```

### Mixed-Script Words

A token that contains both Tamil and non-Tamil characters (e.g. `3வது`) has
only its Tamil portion extracted and checked. The surrounding characters are
preserved verbatim.

### File Size

The default limit is **50 MB**. Raise it with `--max-size` if needed.
Processing very large files may take several minutes.

---

## Troubleshooting

**`ModuleNotFoundError: No module named 'tamil'`**
```bash
pip install open-tamil
```

**`ModuleNotFoundError: No module named 'docx'`**
```bash
pip install python-docx
```

**`ModuleNotFoundError: No module named 'fitz'`**
```bash
pip install PyMuPDF
```

---

**`No Tamil-capable font found`** (PDF correction only)
```bash
# Ubuntu / Debian
sudo apt install fonts-lohit-taml

# Fedora
sudo dnf install lohit-tamil-fonts

# Or point directly to any Tamil font you have
python tamil_spell_checker.py file.pdf --tamil-font /path/to/font.ttf
```

---

**`Output file already exists`**

Either choose a different output path or pass `--force`:
```bash
python tamil_spell_checker.py file.docx --output new_name.docx
# or
python tamil_spell_checker.py file.docx --force
```

---

**`File size X MB exceeds the Y MB limit`**
```bash
python tamil_spell_checker.py large_file.docx --max-size 200
```

---

**`This PDF appears to be scanned`**

The PDF has no text layer. Run OCR first:
```bash
pip install ocrmypdf
ocrmypdf input.pdf input_ocr.pdf
python tamil_spell_checker.py input_ocr.pdf
```

---

**Spell checker initialises in dictionary or pass-through mode**

The `open-tamil` spell sub-package may not have installed correctly.
Reinstall:
```bash
pip uninstall open-tamil -y
pip install open-tamil
```

If you see `Spell checker: dictionary mode`, spell checking still works using
open-tamil's bundled word lists and Levenshtein-based correction. Accuracy
will be lower than the native spell checker backend.

---

**Corrections look wrong (false positives or bad suggestions)**

1. Add domain-specific words and proper nouns to a `--proper-nouns-file`
2. Use `--no-autocorrect` to review errors before applying them
3. Use `--log-level DEBUG` to inspect individual decisions

---

## File Safety

- The **original file is never modified**. All corrections are written to a
  separate output file.
- If the output path already exists, the tool exits with an error unless
  `--force` is passed.
- A partially written output file is left behind if the tool crashes
  mid-processing. Delete it and re-run after fixing the underlying issue.

---

## Project Structure

```
.
├── tamil_spell_checker.py   # Main script — all logic in one file
├── requirements.txt         # Python dependencies
└── README.md                # This document
```

The script is intentionally self-contained. No package structure,
no configuration files, and no additional modules are required.
