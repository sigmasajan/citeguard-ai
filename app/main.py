"""CiteGuard AI - Claim-to-Source Citation Verifier FastAPI Backend.

Provides endpoints for:
- GET  /api/health      : Service health check
- GET  /api/sample      : Pre-built research paper demo containing all 4 verdicts
- POST /api/extract-pdf : Extract raw text from uploaded PDF research document
- POST /api/verify       : Full claim-to-source citation extraction, retrieval, and verification
- GET  /api/benchmark   : 12-case benchmark evaluation with precision, recall, and F1 metrics
"""

from typing import Dict, List, Any, Optional
import os
import json
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.extractor import extract_text_from_pdf, extract_claims_and_bib
from app.retriever import retrieve_evidence_bm25, fetch_external_source
from app.verifier import verify_claim

app = FastAPI(
    title="CiteGuard AI",
    description="Automated Claim-to-Source Citation Verifier for Scientific and Technical Papers",
    version="1.0.0",
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request and Response Models ---

class VerifyRequest(BaseModel):
    document_text: str = Field(..., description="Full text of the paper including inline citations and References section.")
    source_texts: Optional[Dict[str, str]] = Field(default_factory=dict, description="Optional mapping of citation markers to local reference texts.")
    fetch_external: Optional[bool] = Field(default=True, description="Whether to query live open-access APIs (Crossref/arXiv) when local text is missing.")


class ClaimResult(BaseModel):
    claim_id: int
    claim_text: str
    citation_marker: str
    cited_reference: str
    source_found: bool
    source_type: str
    source_url: str
    evidence_snippet: str
    verdict: str
    confidence: float
    explanation: str


class SummaryMetrics(BaseModel):
    total_claims: int
    supported: int
    weakly_supported: int
    mismatched: int
    unverifiable: int


class VerifyResponse(BaseModel):
    summary: SummaryMetrics
    results: List[ClaimResult]


# --- Endpoints ---

@app.get("/api/health")
def health_check() -> Dict[str, str]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "CiteGuard AI",
        "version": "1.0.0",
    }


@app.get("/api/sample")
def get_sample_paper() -> Dict[str, Any]:
    """Returns a realistic research mini-paper with 4 citations and pre-bundled source texts

    demonstrating all 4 verification verdicts:
    - [1]: Supported
    - [2]: Weakly Supported
    - [3]: Mismatched
    - [4]: Unverifiable
    """
    document_text = (
        "Efficiency and Hallucinations in Retrieval-Augmented Transformers\n\n"
        "Abstract: Recent developments in neural language models have dramatically improved text generation capabilities. "
        "However, deployment in high-stakes domains requires strict verification of factual accuracy and computational efficiency.\n\n"
        "Introduction:\n"
        "To alleviate quadratic compute complexity during long-context processing, exact attention optimizations "
        "such as FlashAttention scale linearly with sequence length by reducing memory reads and writes [1]. "
        "In domain adaptation, instruction fine-tuning via reinforcement learning completely solves neural language model hallucination across all conversational domains [2]. "
        "Furthermore, modern weight pruning frameworks demonstrate that structured block pruning reduced transformer inference latency by 85% compared to the dense baseline [3]. "
        "Finally, novel quantum-assisted gradient optimization frameworks were mathematically proven to converge exponentially faster than Adam on convex manifolds [4].\n\n"
        "References\n"
        "[1] Dao, T., Fu, D. Y., Ermon, S., Rudra, A., & Re, C. (2022). FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness. Advances in Neural Information Processing Systems, 35, 16344-16359.\n"
        "[2] Ouyang, L., Wu, J., Jiang, X., et al. (2022). Training language models to follow instructions with human feedback. NeurIPS 2022.\n"
        "[3] Lagunas, F., Charlaix, E., Sanh, V., & Rush, A. M. (2021). Block Pruning For Faster Transformers. Proceedings of EMNLP 2021.\n"
        "[4] Cyberdyne, T., & Vance, X. (2024). Fictional Quantum Accelerators for Gradient Flow. Journal of Imaginary Computation, 45(2), 112-120."
    )

    source_texts = {
        "[1]": (
            "FlashAttention is an IO-aware exact attention algorithm that uses tiling to reduce the number of memory reads/writes "
            "between GPU high bandwidth memory (HBM) and GPU on-chip SRAM. Standard attention has O(N^2) memory accesses. "
            "FlashAttention requires sub-quadratic HBM accesses and scales linearly with sequence length by reducing memory reads and writes, "
            "yielding 2-4x wall-clock speedups on standard GPT-2 and BERT models."
        ),
        "[2]": (
            "We apply Reinforcement Learning from Human Feedback (RLHF) to align language models with user intent. "
            "Our preliminary findings show that fine-tuning with human feedback reduces toxic outputs and suggests improvements in truthful answers, "
            "though hallucinations remain an active limitation requiring further research in conversational domains."
        ),
        "[3]": (
            "In this work, we analyze structured pruning for transformer architectures across sequence classification benchmarks. "
            "Our empirical evaluations indicate that structured block pruning reduced transformer inference latency by only 18% on standard benchmark hardware, "
            "falling significantly short of double-digit speedups while maintaining 98% accuracy."
        ),
    }

    return {
        "title": "Sample Paper: Efficiency and Hallucinations in Retrieval-Augmented Transformers",
        "document_text": document_text,
        "source_texts": source_texts,
    }


@app.post("/api/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)) -> Dict[str, str]:
    """Extract plain text from an uploaded PDF file."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a PDF.")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded PDF file is empty.")

    try:
        text = extract_text_from_pdf(contents)
        return {"document_text": text}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF extraction error: {str(exc)}")


@app.post("/api/verify", response_model=VerifyResponse)
def verify_document(payload: VerifyRequest) -> VerifyResponse:
    """Extract inline citations from document text, retrieve supporting source passages,

    and verify each claim using LLM Judge with deterministic fallback.
    """
    doc_text = payload.document_text.strip()
    if not doc_text:
        raise HTTPException(status_code=400, detail="document_text cannot be empty.")

    extraction = extract_claims_and_bib(doc_text)
    claims = extraction["claims"]

    results: List[ClaimResult] = []
    summary_counts = {
        "supported": 0,
        "weakly_supported": 0,
        "mismatched": 0,
        "unverifiable": 0,
    }

    user_sources = payload.source_texts or {}

    for claim in claims:
        marker = claim["citation_marker"]
        claim_text = claim["claim_text"]
        cited_ref = claim["cited_reference"]

        # 1. Check local source_texts first
        local_text = (
            user_sources.get(marker)
            or user_sources.get(marker.strip("[]"))
            or user_sources.get(f"[{marker}]")
            or ""
        )

        source_found = False
        source_type = "Not Found"
        source_url = ""
        evidence_snippet = ""

        if local_text and local_text.strip():
            source_found = True
            source_type = "Local BM25"
            source_url = "Local Document Reference"
            evidence_snippet = retrieve_evidence_bm25(claim_text, local_text, top_k=2)
        elif payload.fetch_external:
            ext_res = fetch_external_source(cited_ref)
            source_found = ext_res["source_found"]
            source_type = ext_res["source_type"]
            source_url = ext_res["source_url"]
            evidence_snippet = ext_res["evidence_snippet"]

        # 2. Verify claim against evidence
        verdict_res = verify_claim(
            claim_text=claim_text,
            cited_reference=cited_ref,
            evidence_snippet=evidence_snippet,
            source_found=source_found,
        )

        verdict = verdict_res["verdict"]
        confidence = verdict_res["confidence"]
        explanation = verdict_res["explanation"]

        # Track summary count
        norm_key = verdict.lower().replace(" ", "_")
        if norm_key in summary_counts:
            summary_counts[norm_key] += 1

        results.append(
            ClaimResult(
                claim_id=claim["claim_id"],
                claim_text=claim_text,
                citation_marker=marker,
                cited_reference=cited_ref,
                source_found=source_found,
                source_type=source_type,
                source_url=source_url,
                evidence_snippet=evidence_snippet,
                verdict=verdict,
                confidence=confidence,
                explanation=explanation,
            )
        )

    summary = SummaryMetrics(
        total_claims=len(results),
        supported=summary_counts["supported"],
        weakly_supported=summary_counts["weakly_supported"],
        mismatched=summary_counts["mismatched"],
        unverifiable=summary_counts["unverifiable"],
    )

    return VerifyResponse(summary=summary, results=results)


@app.get("/api/benchmark")
def run_benchmark() -> Dict[str, Any]:
    """Runs verification across the 12 golden test cases in app/benchmark_data.json

    and returns evaluation metrics: accuracy, precision, recall, and F1 score per class.
    """
    bench_path = Path(__file__).parent / "benchmark_data.json"
    if not bench_path.exists():
        raise HTTPException(status_code=404, detail="benchmark_data.json not found.")

    with open(bench_path, "r", encoding="utf-8") as f:
        golden_cases = json.load(f)

    classes = ["Supported", "Weakly Supported", "Mismatched", "Unverifiable"]
    confusion: Dict[str, Dict[str, int]] = {c: {"TP": 0, "FP": 0, "FN": 0, "support": 0} for c in classes}

    correct_predictions = 0
    detailed_cases = []

    for case in golden_cases:
        res = verify_claim(
            claim_text=case["claim_text"],
            cited_reference=case["cited_reference"],
            evidence_snippet=case["evidence_snippet"],
            source_found=case["source_found"],
        )

        pred_verdict = res["verdict"]
        exp_verdict = case["expected_verdict"]
        passed = pred_verdict == exp_verdict

        if passed:
            correct_predictions += 1

        # Update confusion metrics
        if exp_verdict in confusion:
            confusion[exp_verdict]["support"] += 1
            if passed:
                confusion[exp_verdict]["TP"] += 1
            else:
                confusion[exp_verdict]["FN"] += 1
                if pred_verdict in confusion:
                    confusion[pred_verdict]["FP"] += 1

        detailed_cases.append(
            {
                "id": case["id"],
                "claim_text": case["claim_text"],
                "expected_verdict": exp_verdict,
                "predicted_verdict": pred_verdict,
                "passed": passed,
                "explanation": res["explanation"],
            }
        )

    total_cases = len(golden_cases)
    overall_accuracy = round(correct_predictions / total_cases, 4) if total_cases > 0 else 0.0

    per_class_metrics = {}
    for c in classes:
        tp = confusion[c]["TP"]
        fp = confusion[c]["FP"]
        fn = confusion[c]["FN"]
        support = confusion[c]["support"]

        precision = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 0.0
        recall = round(tp / (tp + fn), 4) if (tp + fn) > 0 else 0.0
        f1 = round((2 * precision * recall) / (precision + recall), 4) if (precision + recall) > 0 else 0.0

        per_class_metrics[c] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": support,
        }

    return {
        "total_cases": total_cases,
        "correct_predictions": correct_predictions,
        "overall_accuracy": overall_accuracy,
        "per_class_metrics": per_class_metrics,
        "cases": detailed_cases,
    }


# Ensure static directory exists before mounting to guarantee server never crashes
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
