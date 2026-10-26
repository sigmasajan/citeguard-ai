"""LLM Judge and Deterministic Heuristic Verification Engine.

Classifies claims into:
- "Supported"
- "Weakly Supported"
- "Mismatched"
- "Unverifiable"

Includes support for Google GenAI (gemini-2.5-flash / gemma-3-27b-it) and Groq (llama-3.3-70b-versatile)
with a deterministic NLI heuristic fallback that runs offline with zero external dependencies.
"""

from typing import Dict, Any, List, Set, Tuple, Optional
import os
import re
import json
from dotenv import load_dotenv

load_dotenv()

# Stopwords for lexical overlap calculation
STOPWORDS: Set[str] = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
    "by", "can", "did", "do", "does", "doing", "don", "down", "during", "each", "few", "for",
    "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself",
    "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
    "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
    "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "s", "same", "she",
    "should", "so", "some", "such", "t", "than", "that", "the", "their", "theirs", "them",
    "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
    "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which",
    "while", "who", "whom", "why", "will", "with", "would", "you", "your", "yours", "yourself",
}


def _extract_content_words(text: str) -> List[str]:
    """Extract lowercase words excluding common stopwords."""
    words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
    return [w for w in words if w not in STOPWORDS]


def _extract_numbers_and_percentages(text: str) -> List[str]:
    """Extract numbers, percentages, and multipliers like 85%, 10x, 3.4."""
    # Matches patterns like 85%, 85 percent, 10x, 4.5
    raw_nums = re.findall(r"\b\d+(?:\.\d+)?%?|\b\d+x\b", text.lower())
    return raw_nums


def _heuristic_verify(
    claim_text: str, cited_reference: str, evidence_snippet: str
) -> Dict[str, Any]:
    """Deterministic NLI/heuristic analyzer for offline and fallback verification."""
    claim_words = _extract_content_words(claim_text)
    evid_words = _extract_content_words(evidence_snippet)

    if not claim_words:
        return {
            "verdict": "Weakly Supported",
            "confidence": 0.60,
            "explanation": "Claim text contains insufficient content words to establish direct factual verification.",
        }

    claim_set = set(claim_words)
    evid_set = set(evid_words)
    overlap = claim_set.intersection(evid_set)
    overlap_ratio = len(overlap) / len(claim_set) if claim_set else 0.0

    # 1. Topic Mismatch / Complete Irrelevance
    if overlap_ratio < 0.12 and len(overlap) < 2:
        return {
            "verdict": "Mismatched",
            "confidence": 0.88,
            "explanation": (
                f"The cited evidence is on a completely different topic with minimal lexical overlap "
                f"({overlap_ratio:.1%}). No factual link to the claim exists."
            ),
        }

    # 2. Numerical Contradiction Analysis
    claim_nums = _extract_numbers_and_percentages(claim_text)
    evid_nums = _extract_numbers_and_percentages(evidence_snippet)

    if claim_nums and evid_nums:
        # Check if numbers conflict directly
        claim_percentages = [n for n in claim_nums if "%" in n]
        evid_percentages = [n for n in evid_nums if "%" in n]
        if claim_percentages and evid_percentages:
            if not any(cp in evid_percentages for cp in claim_percentages):
                return {
                    "verdict": "Mismatched",
                    "confidence": 0.94,
                    "explanation": (
                        f"Numerical contradiction detected: Claim cites {', '.join(claim_percentages)}, "
                        f"whereas the source evidence explicitly reports {', '.join(evid_percentages)}."
                    ),
                }

    # 3. Direct Negation and Contradiction Keywords
    contradiction_indicators = [
        "failed to", "fails to", "failure to", "did not", "does not", "cannot", "no evidence",
        "no significant difference", "no significant", "contrary to", "contradict", "contradicted",
        "refutes", "refuted", "opposite", "ineffective", "underperformed", "worse than",
        "disproven", "incompatible", "did not observe", "failed to show", "did not improve",
        "no measurable", "failed",
    ]
    evid_lower = evidence_snippet.lower()
    claim_lower = claim_text.lower()

    # Look for contradiction phrases in evidence
    found_contradictions = [c for c in contradiction_indicators if c in evid_lower]
    # Check if the claim asserted positive outcome or confirmed effect
    positive_claim_words = [
        "reduced", "improves", "improved", "outperformed", "achieved", "eliminates", "eliminated",
        "superior", "successful", "prevented", "confirmed", "effective", "matches", "matching",
    ]
    has_positive_claim = any(
        re.search(r"\b" + re.escape(p) + r"\b", claim_lower) for p in positive_claim_words
    )

    if found_contradictions and (has_positive_claim or overlap_ratio >= 0.25):
        return {
            "verdict": "Mismatched",
            "confidence": 0.92,
            "explanation": (
                f"Direct factual contradiction: The source evidence explicitly reports contradictory or "
                f"null findings ({', '.join(found_contradictions[:2])}) regarding the claimed effect."
            ),
        }

    # 4. Hedging / Overgeneralization Analysis -> Weakly Supported
    hedging_indicators = [
        "preliminary", "suggests", "may indicate", "potential", "exploratory", "further research",
        "further study", "requires verification", "limited sample", "small cohort", "anecdotal",
        "inconclusive", "hypothesized", "modest", "partially", "indicates a tendency",
        "cannot be generalized", "in some scenarios", "promising early",
    ]
    overgeneralization_claim_markers = [
        "completely", "all", "universal", "guarantees", "solves", "definitively", "every",
        "without exception", "revolutionized", "eliminates any",
    ]

    has_hedging = any(h in evid_lower for h in hedging_indicators)
    has_overgen = any(
        re.search(r"\b" + re.escape(o) + r"\b", claim_lower)
        for o in overgeneralization_claim_markers
    )

    if has_hedging or (has_overgen and overlap_ratio >= 0.25):
        reason = (
            "The source mentions the relevant phenomenon, but uses cautious/hedged language, "
            "whereas the claim overgeneralizes or states it as an absolute established certainty."
            if has_overgen
            else "The source evidence only provides preliminary or indirect indications without conclusive proof."
        )
        return {
            "verdict": "Weakly Supported",
            "confidence": 0.82,
            "explanation": reason,
        }


    # 5. Overlap threshold check for Weakly Supported vs Supported
    if 0.15 <= overlap_ratio < 0.38 and len(overlap) < 4:
        return {
            "verdict": "Weakly Supported",
            "confidence": 0.75,
            "explanation": (
                f"The source is tangentially related ({overlap_ratio:.1%} key term overlap), "
                f"but does not contain sufficient specific evidentiary details to fully substantiate the claim."
            ),
        }

    # 6. Supported (Strong alignment and verified facts)
    confidence = min(0.96, max(0.80, 0.70 + (overlap_ratio * 0.3)))
    return {
        "verdict": "Supported",
        "confidence": round(confidence, 2),
        "explanation": (
            f"The retrieved evidence directly substantiates the core claims and entities "
            f"with consistent findings ({overlap_ratio:.1%} conceptual alignment)."
        ),
    }


def _call_gemini_judge(
    claim_text: str, cited_reference: str, evidence_snippet: str, api_key: str
) -> Optional[Dict[str, Any]]:
    """Query Google GenAI (gemini-2.5-flash / gemma-3-27b-it) to judge claim citation support."""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        prompt = f"""You are an expert scientific peer-review judge verifying citation fidelity.
Evaluate whether the cited evidence substantiates the author's claim.

CLAIM:
"{claim_text}"

CITED REFERENCE:
"{cited_reference}"

RETRIEVED SOURCE EVIDENCE:
"{evidence_snippet}"

Classify into EXACTLY one of these 4 verdicts:
1. "Supported": Source directly backs the claim and facts/numbers agree.
2. "Weakly Supported": Source is related, but the claim overgeneralizes, exaggerates, or lacks specific proof.
3. "Mismatched": Source directly contradicts the claim, has conflicting numbers/conclusions, or is completely irrelevant.
4. "Unverifiable": Source cannot be evaluated or contains no relevant text.

Respond ONLY with a valid JSON object matching this schema:
{{
  "verdict": "Supported" | "Weakly Supported" | "Mismatched" | "Unverifiable",
  "confidence": 0.0 to 1.0,
  "explanation": "concise rationale under 2 sentences"
}}"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )

        if response and response.text:
            parsed = json.loads(response.text.strip())
            valid_verdicts = {"Supported", "Weakly Supported", "Mismatched", "Unverifiable"}
            if parsed.get("verdict") in valid_verdicts:
                return {
                    "verdict": parsed["verdict"],
                    "confidence": float(parsed.get("confidence", 0.90)),
                    "explanation": str(parsed.get("explanation", "")).strip(),
                }
    except Exception:
        # Logging or silent fallback to ensure zero downtime
        pass
    return None


def _call_groq_judge(
    claim_text: str, cited_reference: str, evidence_snippet: str, api_key: str
) -> Optional[Dict[str, Any]]:
    """Query Groq API (llama-3.3-70b-versatile) as secondary LLM judge."""
    try:
        from groq import Groq

        client = Groq(api_key=api_key)

        prompt = f"""You are an expert peer-review citation judge. Classify whether the evidence supports the claim into EXACTLY one of:
- "Supported"
- "Weakly Supported"
- "Mismatched"
- "Unverifiable"

CLAIM: {claim_text}
REFERENCE: {cited_reference}
EVIDENCE: {evidence_snippet}

Return valid JSON:
{{"verdict": "Supported"|"Weakly Supported"|"Mismatched"|"Unverifiable", "confidence": 0.95, "explanation": "..."}}"""

        chat_completion = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        reply = chat_completion.choices[0].message.content
        if reply:
            parsed = json.loads(reply.strip())
            valid_verdicts = {"Supported", "Weakly Supported", "Mismatched", "Unverifiable"}
            if parsed.get("verdict") in valid_verdicts:
                return {
                    "verdict": parsed["verdict"],
                    "confidence": float(parsed.get("confidence", 0.90)),
                    "explanation": str(parsed.get("explanation", "")).strip(),
                }
    except Exception:
        pass
    return None


def verify_claim(
    claim_text: str,
    cited_reference: str,
    evidence_snippet: str,
    source_found: bool,
) -> Dict[str, Any]:
    """Verify whether a retrieved source substantiates an in-text claim.

    Args:
        claim_text: The sentence containing the citation.
        cited_reference: The corresponding entry from the references section.
        evidence_snippet: Retrieved passage, abstract, or quote from the source paper.
        source_found: Whether the source was found in local docs or via live APIs.

    Returns:
        Dict containing:
            - verdict: "Supported" | "Weakly Supported" | "Mismatched" | "Unverifiable"
            - confidence: float between 0.0 and 1.0
            - explanation: string explaining the rationale
    """
    # Rule 1: If source could not be found or evidence is empty, verdict is immediately Unverifiable
    if not source_found or not evidence_snippet or not evidence_snippet.strip():
        return {
            "verdict": "Unverifiable",
            "confidence": 0.95,
            "explanation": (
                "The cited source does not exist, is fabricated, or no usable text/abstract could be retrieved."
            ),
        }

    # Rule 2: Attempt LLM Judge if API keys are configured
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        llm_result = _call_gemini_judge(claim_text, cited_reference, evidence_snippet, gemini_key)
        if llm_result:
            return llm_result

    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        groq_result = _call_groq_judge(claim_text, cited_reference, evidence_snippet, groq_key)
        if groq_result:
            return groq_result

    # Rule 3: Deterministic NLI / Heuristic Fallback
    return _heuristic_verify(claim_text, cited_reference, evidence_snippet)
