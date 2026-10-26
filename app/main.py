"""CiteGuard AI - Claim-to-Source Citation Verifier FastAPI Backend.

Provides endpoints for:
- GET  /api/health            : Service health check
- GET  /api/sample            : Pre-built research paper demo containing all 4 verdicts
- POST /api/extract-pdf       : Extract raw text from uploaded PDF research document
- POST /api/fetch-url         : Fetch research paper metadata/abstract from DOI or arXiv URL
- POST /api/verify            : Full claim-to-source citation extraction, retrieval, and verification
- GET  /api/benchmark         : 12-case benchmark evaluation with precision, recall, and F1 metrics
- POST /api/register          : User registration with SQLite storage
- POST /api/login             : User login and session token generation
- GET  /api/me                : Fetch current authenticated user profile
- POST /api/logout            : Invalidate user session token
- GET  /api/history           : Fetch user's previous verification analyses
- GET  /api/history/{id}      : Fetch a complete past analysis session to re-load into Inspector
- DELETE /api/history/{id}   : Delete a past analysis record
"""

from typing import Dict, List, Any, Optional
import os
import re
import json
import urllib.parse
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import httpx

from app.extractor import extract_text_from_pdf, extract_claims_and_bib
from app.retriever import retrieve_evidence_bm25, fetch_external_source
from app.verifier import verify_claim
from app.database import (
    create_user,
    authenticate_user,
    create_session,
    get_user_by_token,
    delete_session,
    save_analysis,
    get_user_analyses,
    get_analysis_by_id,
    delete_analysis,
    check_availability,
    verify_user_email,
    resend_verification_code,
)
from app.email_service import send_verification_email, is_smtp_configured

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
    paper_title: Optional[str] = Field(default=None, description="Optional document or paper title.")
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
    analysis_id: Optional[int] = None


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username_or_email: str
    password: str


class VerifyEmailRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, description="6-digit email verification code.")
    identifier: Optional[str] = Field(default=None, description="Username or email if not logged in.")


class ResendVerificationRequest(BaseModel):
    identifier: Optional[str] = Field(default=None, description="Username or email if not logged in.")


class UrlFetchRequest(BaseModel):
    url: str


# --- Authentication Dependency ---

def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Dependency to retrieve the currently logged in user."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in.")
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please sign in again.")
    return user


def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """Dependency to retrieve user if a valid session exists, otherwise None."""
    if not authorization:
        return None
    return get_user_by_token(authorization)


# --- Auth Endpoints ---

@app.get("/api/check-availability")
def check_credential_availability(
    username: Optional[str] = None,
    email: Optional[str] = None,
) -> Dict[str, Any]:
    """Check whether a username or email is valid and available in real-time."""
    return check_availability(username=username, email=email)


@app.get("/api/email-status")
def email_status() -> Dict[str, Any]:
    """Check whether SMTP is configured for live email delivery."""
    configured = is_smtp_configured()
    return {
        "smtp_configured": configured,
        "mode": "live" if configured else "demo",
        "description": "Live emails are sent to recipient inboxes via SMTP." if configured else "SMTP is not configured yet; verification code is displayed on screen for testing.",
    }


@app.post("/api/register")
def register(payload: RegisterRequest) -> Dict[str, Any]:
    """Register a new user account, dispatch email verification OTP, and return session token."""
    try:
        user = create_user(payload.username, payload.email, payload.password)
        token = create_session(user["id"])
        email_sent, email_msg = send_verification_email(
            to_email=user["email"],
            username=user["username"],
            code=user["verification_code"],
        )
        return {
            "success": True,
            "token": token,
            "user": user,
            "verification_code": user.get("verification_code"),
            "email_sent": email_sent,
            "email_status": email_msg,
            "message": f"Account created! {email_msg}",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/verify-email")
def verify_email(
    payload: VerifyEmailRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
) -> Dict[str, Any]:
    """Verify email address with 6-digit verification code."""
    identifier = None
    if current_user:
        identifier = current_user.get("id")
    elif payload.identifier:
        identifier = payload.identifier.strip()

    if not identifier:
        raise HTTPException(
            status_code=400,
            detail="User identifier (username or email) or active session is required to verify email.",
        )

    success, message, user = verify_user_email(str(identifier), payload.code)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {
        "success": True,
        "message": message,
        "user": user,
    }


@app.post("/api/resend-verification")
def resend_verification(
    payload: ResendVerificationRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
) -> Dict[str, Any]:
    """Generate and dispatch a fresh 6-digit email verification code."""
    identifier = None
    if current_user:
        identifier = current_user.get("id")
    elif payload.identifier:
        identifier = payload.identifier.strip()

    if not identifier:
        raise HTTPException(
            status_code=400,
            detail="User identifier (username or email) or active session is required to resend code.",
        )

    success, message, code, user_info = resend_verification_code(str(identifier))
    if not success:
        raise HTTPException(status_code=400, detail=message)

    email_sent = False
    email_msg = ""
    if user_info and code:
        email_sent, email_msg = send_verification_email(
            to_email=user_info["email"],
            username=user_info["username"],
            code=code,
        )

    return {
        "success": True,
        "message": f"{message} {email_msg}".strip(),
        "verification_code": code,
        "email_sent": email_sent,
        "email_status": email_msg,
    }


@app.post("/api/login")
def login(payload: LoginRequest) -> Dict[str, Any]:
    """Authenticate with username/email and password, returning a session token."""
    user = authenticate_user(payload.username_or_email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username/email or password.")

    token = create_session(user["id"])
    return {
        "success": True,
        "token": token,
        "user": user,
        "message": "Login successful.",
    }


@app.get("/api/me")
def get_profile(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Return profile details for currently logged-in user."""
    return {"user": current_user}


@app.post("/api/logout")
def logout(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Invalidate session token on logout."""
    if authorization:
        delete_session(authorization)
    return {"success": True, "message": "Logged out successfully."}


# --- History Endpoints ---

@app.get("/api/history")
def get_history(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Retrieve list of past analyses for the logged-in user."""
    history_items = get_user_analyses(current_user["id"])
    return {"history": history_items}


@app.get("/api/history/{analysis_id}")
def get_history_detail(
    analysis_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Retrieve full verification analysis to re-load into the Inspector."""
    item = get_analysis_by_id(analysis_id, current_user["id"])
    if not item:
        raise HTTPException(status_code=404, detail="Analysis report not found.")
    return item


@app.delete("/api/history/{analysis_id}")
def delete_history_item(
    analysis_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Delete a past analysis report."""
    deleted = delete_analysis(analysis_id, current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Analysis report not found.")
    return {"success": True, "message": "Analysis deleted."}


# --- Verification Endpoints ---

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


@app.post("/api/fetch-url")
def fetch_from_url(payload: UrlFetchRequest) -> Dict[str, str]:
    """Fetch paper text/abstract from an arXiv URL, DOI, or publication link."""
    target_url = payload.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Please provide a valid URL or DOI.")

    # Check for arXiv ID pattern e.g. 2301.00000 or arxiv.org/abs/2301.00000
    arxiv_match = re.search(r"(\d{4}\.\d{4,5}(?:v\d+)?)", target_url)
    if arxiv_match:
        arxiv_id = arxiv_match.group(1)
        api_query_url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}&max_results=1"
        try:
            with httpx.Client(timeout=6.0) as client:
                resp = client.get(api_query_url)
                if resp.status_code == 200:
                    import xml.etree.ElementTree as ET
                    root = ET.fromstring(resp.text)
                    ns = {"atom": "http://www.w3.org/2005/Atom"}
                    entry = root.find("atom:entry", ns)
                    if entry is not None:
                        title = entry.find("atom:title", ns).text.strip()
                        summary = entry.find("atom:summary", ns).text.strip()
                        clean_summary = re.sub(r"\s+", " ", summary)
                        doc_text = (
                            f"{title}\n\nAbstract: {clean_summary}\n\n"
                            f"Main Findings:\nThis paper demonstrates key theoretical and empirical properties of {title.lower()} [1].\n\n"
                            f"References\n[1] {title}. arXiv:{arxiv_id}."
                        )
                        return {"document_text": doc_text, "title": title}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to fetch from arXiv API: {exc}")

    # Check for DOI pattern
    doi_match = re.search(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", target_url)
    if doi_match:
        doi = doi_match.group(0)
        crossref_url = f"https://api.crossref.org/works/{urllib.parse.quote(doi)}"
        try:
            headers = {"User-Agent": "CiteGuardAI/1.0 (mailto:team@citeguard.ai)"}
            with httpx.Client(timeout=6.0, headers=headers) as client:
                resp = client.get(crossref_url)
                if resp.status_code == 200:
                    data = resp.json().get("message", {})
                    title_list = data.get("title", [])
                    title = title_list[0] if title_list else f"Paper DOI {doi}"
                    abstract_raw = data.get("abstract", "")
                    clean_abstract = re.sub(r"<[^>]+>", " ", abstract_raw)
                    clean_abstract = re.sub(r"\s+", " ", clean_abstract).strip()
                    if not clean_abstract:
                        clean_abstract = f"Published in {data.get('container-title', ['Scientific Journal'])[0]} with DOI {doi}."
                    doc_text = (
                        f"{title}\n\nAbstract: {clean_abstract}\n\n"
                        f"Findings:\nThe research establishes new empirical bounds for the stated hypothesis [1].\n\n"
                        f"References\n[1] {title}. https://doi.org/{doi}"
                    )
                    return {"document_text": doc_text, "title": title}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to fetch from Crossref API: {exc}")

    raise HTTPException(
        status_code=400,
        detail="Could not detect a valid arXiv ID or DOI from the provided URL. Please paste a direct arXiv link or DOI.",
    )


@app.post("/api/verify", response_model=VerifyResponse)
def verify_document(
    payload: VerifyRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
) -> VerifyResponse:
    """Extract inline citations from document text, retrieve supporting source passages,

    and verify each claim using LLM Judge with deterministic fallback.
    If user is authenticated, saves analysis to database automatically.
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

    analysis_id: Optional[int] = None
    if current_user:
        # Determine title from payload or first non-empty line of document
        lines = [line.strip() for line in doc_text.splitlines() if line.strip()]
        title = payload.paper_title or (lines[0][:100] if lines else "Verified Research Document")
        analysis_id = save_analysis(
            user_id=current_user["id"],
            paper_title=title,
            document_text=doc_text,
            summary=summary.model_dump(),
            results=[r.model_dump() for r in results],
        )

    return VerifyResponse(summary=summary, results=results, analysis_id=analysis_id)


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
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
