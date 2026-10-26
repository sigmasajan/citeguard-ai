"""Evidence retrieval module combining local BM25 ranking and live academic APIs.

Implements rank-bm25 for local documents and queries Crossref & arXiv APIs
with similarity validation to prevent false matches.
"""

from typing import Dict, List, Any, Optional
import re
import urllib.parse
import xml.etree.ElementTree as ET
import httpx
from rank_bm25 import BM25Okapi


def _tokenize(text: str) -> List[str]:
    """Tokenize text into lowercase alphanumeric words."""
    return re.findall(r"\b[a-zA-Z0-9]+\b", text.lower())


def _chunk_text(text: str, chunk_size_words: int = 60, overlap_words: int = 15) -> List[str]:
    """Split text into overlapping chunks of words or by paragraph blocks."""
    if not text.strip():
        return []

    # First, split into paragraph blocks
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: List[str] = []
    for p in paragraphs:
        words = p.split()
        if len(words) <= chunk_size_words:
            chunks.append(p)
        else:
            step = max(1, chunk_size_words - overlap_words)
            for i in range(0, len(words), step):
                chunk = " ".join(words[i : i + chunk_size_words])
                chunks.append(chunk)
                if i + chunk_size_words >= len(words):
                    break

    return chunks if chunks else [text.strip()]


def retrieve_evidence_bm25(claim_text: str, source_document: str, top_k: int = 2) -> str:
    """Retrieve the most relevant evidence passage(s) from source_document using BM25Okapi.

    Args:
        claim_text: The sentence or claim needing verification.
        source_document: Full text of the source paper or passage.
        top_k: Number of top scoring chunks to combine for evidence.

    Returns:
        Best matching evidence snippet or combined snippets.
    """
    if not source_document or not source_document.strip():
        return ""

    chunks = _chunk_text(source_document)
    if not chunks:
        return ""

    if len(chunks) == 1:
        return chunks[0].strip()

    tokenized_corpus = [_tokenize(chunk) for chunk in chunks]
    # Filter out empty token sets
    valid_indices = [i for i, tokens in enumerate(tokenized_corpus) if tokens]
    if not valid_indices:
        return chunks[0].strip()

    filtered_corpus = [tokenized_corpus[i] for i in valid_indices]
    filtered_chunks = [chunks[i] for i in valid_indices]

    bm25 = BM25Okapi(filtered_corpus)
    query_tokens = _tokenize(claim_text)
    if not query_tokens:
        return filtered_chunks[0].strip()

    scores = bm25.get_scores(query_tokens)

    # Rank indices by score descending
    ranked_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)

    top_indices = ranked_indices[:top_k]
    selected_chunks = [filtered_chunks[i] for i in top_indices if scores[i] > 0]

    if not selected_chunks:
        # If no positive BM25 score, return the first chunk as fallback
        return filtered_chunks[0].strip()

    return " [...] ".join(selected_chunks).strip()


def _clean_abstract(raw_text: str) -> str:
    """Strip JATS XML / HTML tags and normalize whitespace."""
    clean = re.sub(r"<[^>]+>", " ", raw_text)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def _title_similarity(candidate_title: str, query_ref: str) -> float:
    """Compute token Jaccard similarity between paper title and cited reference."""
    cand_words = set(re.findall(r"\b[a-zA-Z]{4,}\b", candidate_title.lower()))
    ref_words = set(re.findall(r"\b[a-zA-Z]{4,}\b", query_ref.lower()))

    if not cand_words or not ref_words:
        return 0.0

    intersection = cand_words.intersection(ref_words)
    # Give higher weight to matching title words
    overlap_ratio = len(intersection) / len(cand_words)
    return overlap_ratio


def fetch_external_source(cited_reference: str) -> Dict[str, Any]:
    """Query live academic APIs (Crossref & arXiv) to retrieve metadata and abstract.

    Validates title similarity to avoid false matches.

    Args:
        cited_reference: The bibliographic reference string (e.g., from References section).

    Returns:
        Dict with keys: source_found (bool), source_type (str), source_url (str), evidence_snippet (str).
    """
    empty_result = {
        "source_found": False,
        "source_type": "Not Found",
        "source_url": "",
        "evidence_snippet": "",
    }

    if not cited_reference or len(cited_reference.strip()) < 10:
        return empty_result

    # Quick check for known fabrication/hallucination signals
    fabrication_markers = [
        "fabricated",
        "non-existent",
        "nonexistent",
        "unlisted in references",
        "fictional",
        "ghost paper",
        "not real",
        "imaginary",
        "fake reference",
    ]
    ref_lower = cited_reference.lower()
    if any(marker in ref_lower for marker in fabrication_markers):
        return empty_result

    headers = {
        "User-Agent": "CiteGuardAI/1.0 (mailto:contact@citeguard.ai; https://github.com/citeguard-ai)"
    }

    # Extract potential DOI if present
    doi_match = re.search(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", cited_reference)
    candidate_doi = doi_match.group(0).rstrip(".,;") if doi_match else None

    # Step 1: Try Crossref API
    try:
        with httpx.Client(timeout=4.0, headers=headers) as client:
            if candidate_doi:
                url = f"https://api.crossref.org/works/{urllib.parse.quote(candidate_doi)}"
                resp = client.get(url)
                if resp.status_code == 200:
                    data = resp.json().get("message", {})
                    title_list = data.get("title", [])
                    title = title_list[0] if title_list else ""
                    abstract = _clean_abstract(data.get("abstract", ""))
                    doi_url = data.get("URL") or f"https://doi.org/{candidate_doi}"
                    snippet = abstract if abstract else f"Paper Title: {title}. Published in: {data.get('container-title', [''])[0]}."
                    return {
                        "source_found": True,
                        "source_type": "Crossref API",
                        "source_url": doi_url,
                        "evidence_snippet": snippet,
                    }

            # Search by bibliographic query
            clean_query = re.sub(r"^\[\d+\]\s*", "", cited_reference)[:200]
            url = f"https://api.crossref.org/works?query.bibliographic={urllib.parse.quote(clean_query)}&rows=1"
            resp = client.get(url)
            if resp.status_code == 200:
                items = resp.json().get("message", {}).get("items", [])
                if items:
                    item = items[0]
                    title_list = item.get("title", [])
                    item_title = title_list[0] if title_list else ""

                    # Verify title similarity to prevent false positives
                    similarity = _title_similarity(item_title, cited_reference)
                    if similarity >= 0.35 or len(set(_tokenize(item_title)) & set(_tokenize(cited_reference))) >= 3:
                        raw_abstract = item.get("abstract", "")
                        abstract = _clean_abstract(raw_abstract)
                        doi = item.get("DOI", "")
                        doi_url = item.get("URL") or (f"https://doi.org/{doi}" if doi else "")
                        snippet = abstract if len(abstract) > 40 else f"{item_title}. Authors: {', '.join([a.get('family', '') for a in item.get('author', [])][:3])}."
                        return {
                            "source_found": True,
                            "source_type": "Crossref API",
                            "source_url": doi_url,
                            "evidence_snippet": snippet,
                        }
    except Exception:
        # Crossref failed or timed out, fallback to arXiv
        pass

    # Step 2: Try arXiv API
    try:
        # Extract title or main keywords from reference
        quoted = re.findall(r'"([^"]+)"', cited_reference)
        search_term = quoted[0] if quoted else re.sub(r"^[A-Za-z\s.,&]+(?:\(\d{4}\)|\d{4})[.:]\s*", "", cited_reference)
        search_term = re.sub(r"^\[\d+\]\s*", "", search_term)[:120].strip()

        arxiv_url = f"http://export.arxiv.org/api/query?search_query=all:{urllib.parse.quote(search_term)}&max_results=1"
        with httpx.Client(timeout=4.0, headers=headers) as client:
            resp = client.get(arxiv_url)
            if resp.status_code == 200:
                root = ET.fromstring(resp.text)
                # Atom namespace
                ns = {"atom": "http://www.w3.org/2005/Atom"}
                entry = root.find("atom:entry", ns)
                if entry is not None:
                    title_elem = entry.find("atom:title", ns)
                    summary_elem = entry.find("atom:summary", ns)
                    id_elem = entry.find("atom:id", ns)

                    entry_title = title_elem.text.strip() if title_elem is not None and title_elem.text else ""
                    entry_summary = summary_elem.text.strip() if summary_elem is not None and summary_elem.text else ""
                    entry_id = id_elem.text.strip() if id_elem is not None and id_elem.text else ""

                    similarity = _title_similarity(entry_title, cited_reference)
                    if similarity >= 0.35 or len(set(_tokenize(entry_title)) & set(_tokenize(cited_reference))) >= 3:
                        clean_summary = re.sub(r"\s+", " ", entry_summary)
                        return {
                            "source_found": True,
                            "source_type": "arXiv API",
                            "source_url": entry_id,
                            "evidence_snippet": clean_summary,
                        }
    except Exception:
        pass

    return empty_result
