"""Document text and citation extraction module using PyMuPDF and regex parsing.

Extracts text from PDFs, separates body text from bibliography,
and extracts claim sentences mapped to their cited references.
"""

from typing import Dict, List, Any, Tuple
import re
import pymupdf as fitz


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract clean raw text from a PDF file using PyMuPDF (fitz).

    Args:
        file_bytes: Binary contents of the uploaded PDF file.

    Returns:
        Extracted plain text across all document pages.
    """
    if not file_bytes:
        return ""

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages_text: List[str] = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text")
            if text:
                pages_text.append(text.strip())
        doc.close()
        return "\n\n".join(pages_text)
    except Exception as exc:
        raise ValueError(f"Failed to extract text from PDF: {exc}") from exc


def _split_into_sentences(text: str) -> List[str]:
    """Split text into sentences while respecting academic abbreviations."""
    # Mask common academic abbreviations with temporary placeholders
    abbreviations = {
        r"\bet al\.": "__ET_AL__",
        r"\be\.g\.,": "__EG_COMMA__",
        r"\be\.g\.": "__EG__",
        r"\bi\.e\.,": "__IE_COMMA__",
        r"\bi\.e\.": "__IE__",
        r"\bFig\.\s*(\d+)": r"__FIG__\1",
        r"\bTab\.\s*(\d+)": r"__TAB__\1",
        r"\bDr\.": "__DR__",
        r"\bProf\.": "__PROF__",
        r"\bvs\.": "__VS__",
        r"\bvol\.": "__VOL__",
        r"\bno\.": "__NO__",
        r"\bpp\.": "__PP__",
        r"\bEq\.\s*(\d+)": r"__EQ__\1",
    }

    masked = text
    for pattern, placeholder in abbreviations.items():
        masked = re.sub(pattern, placeholder, masked, flags=re.IGNORECASE)

    # Split on sentence terminals followed by whitespace and an uppercase letter or bracket
    raw_sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'\[\(])", masked)

    # Restore placeholders
    unmask = {
        "__ET_AL__": "et al.",
        "__EG_COMMA__": "e.g.,",
        "__EG__": "e.g.",
        "__IE_COMMA__": "i.e.,",
        "__IE__": "i.e.",
        "__FIG__": "Fig. ",
        "__TAB__": "Tab. ",
        "__DR__": "Dr.",
        "__PROF__": "Prof.",
        "__VS__": "vs.",
        "__VOL__": "vol.",
        "__NO__": "no.",
        "__PP__": "pp.",
        "__EQ__": "Eq. ",
    }

    cleaned_sentences = []
    for s in raw_sentences:
        candidate = s.strip()
        if not candidate:
            continue
        for ph, orig in unmask.items():
            candidate = candidate.replace(ph, orig)
        # Normalize internal whitespace
        candidate = re.sub(r"\s+", " ", candidate)
        cleaned_sentences.append(candidate)

    return cleaned_sentences


def _parse_references_section(ref_text: str) -> Dict[str, str]:
    """Parse bibliography text into a dictionary mapping marker to reference string."""
    entries: Dict[str, str] = {}
    lines = [line.strip() for line in ref_text.splitlines() if line.strip()]

    current_marker = ""
    current_content: List[str] = []

    # Regex for reference markers like [1], 1., (Vaswani et al., 2017), or Author (2020)
    marker_pattern = re.compile(
        r"^(?:(\[\d+\])|(\d+[\.\)])|(\([A-Za-z]+(?:\s+et\s+al\.)?,\s*\d{4}[a-z]?\))|([A-Za-z]+(?:\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)))\s*(.*)$"
    )

    for line in lines:
        match = marker_pattern.match(line)
        if match:
            # Save previous entry
            if current_marker:
                entry_str = " ".join(current_content).strip()
                entries[current_marker] = entry_str
                # Also store canonical bracketed key if numeric
                digits = re.findall(r"\d+", current_marker)
                if digits:
                    canonical = f"[{digits[0]}]"
                    entries[canonical] = entry_str
                    entries[digits[0]] = entry_str

            bracket_m, dot_m, paren_m, auth_m, rest = match.groups()
            raw_marker = bracket_m or dot_m or paren_m or auth_m
            current_marker = raw_marker.rstrip(".")
            current_content = [rest] if rest else []
        else:
            if current_marker:
                current_content.append(line)
            else:
                # In case no marker preceded
                pass

    if current_marker:
        entry_str = " ".join(current_content).strip()
        entries[current_marker] = entry_str
        digits = re.findall(r"\d+", current_marker)
        if digits:
            entries[f"[{digits[0]}]"] = entry_str
            entries[digits[0]] = entry_str

    return entries


def extract_claims_and_bib(document_text: str) -> Dict[str, Any]:
    """Splits document into body and references, identifies claims with citations,

    and maps each claim sentence to its bibliography entry.

    Args:
        document_text: Full raw text of the document.

    Returns:
        Dict containing:
            - claims: list of claim objects with claim_id, claim_text, citation_marker, cited_reference
            - bibliography: dict of marker -> full reference string
            - body_text: string of body
            - references_text: string of references section
    """
    if not document_text:
        return {
            "claims": [],
            "bibliography": {},
            "body_text": "",
            "references_text": "",
        }

    # Locate References / Bibliography section heading
    heading_regex = re.compile(
        r"(?im)^\s*(?:references|bibliography|works\s+cited|sources)\s*[:.]?\s*$"
    )
    matches = list(heading_regex.finditer(document_text))

    if matches:
        # Use the last heading match to handle any accidental mentions in text
        split_match = matches[-1]
        body_text = document_text[: split_match.start()].strip()
        references_text = document_text[split_match.end() :].strip()
    else:
        # Fallback: look for "[1]" starting a line in the latter half of the document
        half_point = len(document_text) // 2
        ref_start_match = re.search(r"(?m)^\s*\[1\]\s+", document_text[half_point:])
        if ref_start_match:
            split_idx = half_point + ref_start_match.start()
            body_text = document_text[:split_idx].strip()
            references_text = document_text[split_idx:].strip()
        else:
            body_text = document_text.strip()
            references_text = ""

    bibliography = _parse_references_section(references_text)

    # Split body text into sentences
    sentences = _split_into_sentences(body_text)

    # Patterns to match inline citations:
    # 1. Bracketed numbers: [1], [1, 2], [1-3]
    bracket_cite_pattern = re.compile(r"\[(\d+(?:\s*,\s*\d+)*|\d+\s*-\s*\d+)\]")
    # 2. Parenthetical author-year: (Vaswani et al., 2017) or (Brown, 2020)
    author_cite_pattern = re.compile(
        r"\(([A-Z][A-Za-z\s.-]+(?:\s+et\s+al\.)?,\s*\d{4}[a-z]?)\)"
    )

    claims: List[Dict[str, Any]] = []
    claim_id = 1

    for sentence in sentences:
        # Check bracketed citations
        bracket_matches = list(bracket_cite_pattern.finditer(sentence))
        author_matches = list(author_cite_pattern.finditer(sentence))

        if not bracket_matches and not author_matches:
            continue

        found_markers: List[str] = []

        # Process bracket matches
        for bm in bracket_matches:
            raw_inside = bm.group(1).strip()
            if "-" in raw_inside:
                # Range like 1-3
                parts = raw_inside.split("-")
                try:
                    start_num, end_num = int(parts[0].strip()), int(parts[1].strip())
                    for n in range(start_num, end_num + 1):
                        found_markers.append(f"[{n}]")
                except ValueError:
                    found_markers.append(f"[{raw_inside}]")
            elif "," in raw_inside:
                # Comma separated like 1, 2
                parts = raw_inside.split(",")
                for p in parts:
                    digits = re.findall(r"\d+", p)
                    if digits:
                        found_markers.append(f"[{digits[0]}]")
            else:
                digits = re.findall(r"\d+", raw_inside)
                if digits:
                    found_markers.append(f"[{digits[0]}]")
                else:
                    found_markers.append(f"[{raw_inside}]")

        # Process author matches
        for am in author_matches:
            found_markers.append(f"({am.group(1).strip()})")

        # Remove duplicates while preserving order
        unique_markers: List[str] = []
        for m in found_markers:
            if m not in unique_markers:
                unique_markers.append(m)

        for marker in unique_markers:
            # Resolve cited reference from bibliography
            ref_str = (
                bibliography.get(marker)
                or bibliography.get(marker.strip("[]"))
                or bibliography.get(f"[{marker}]")
                or ""
            )

            # If not direct match, try fuzzy matching on author/year
            if not ref_str and marker.startswith("(") and marker.endswith(")"):
                inner = marker[1:-1]
                for k, v in bibliography.items():
                    if inner.lower() in v.lower():
                        ref_str = v
                        break

            # If still not found, provide a placeholder noting the marker
            if not ref_str:
                ref_str = f"Reference {marker} (Unlisted in References section)"

            claims.append(
                {
                    "claim_id": claim_id,
                    "claim_text": sentence,
                    "citation_marker": marker,
                    "cited_reference": ref_str,
                }
            )
            claim_id += 1

    return {
        "claims": claims,
        "bibliography": bibliography,
        "body_text": body_text,
        "references_text": references_text,
    }
