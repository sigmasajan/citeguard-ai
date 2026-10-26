"""Comprehensive test suite for CiteGuard AI backend.

Validates:
1. Claim and bibliography extraction (extractor.py).
2. BM25 evidence retrieval and ranking (retriever.py).
3. Unverifiable source and hallucination detection.
4. Numerical contradiction and negation detection (Mismatched).
5. Full FastAPI endpoints (/api/sample, /api/verify, /api/benchmark, /api/health).
6. Benchmark accuracy threshold (>= 75%).
7. PDF extraction with PyMuPDF (fitz) and /api/extract-pdf endpoint.
"""

import io
import sys
from pathlib import Path

# Ensure root directory is on python path for test execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from app.main import app
from app.extractor import extract_claims_and_bib, extract_text_from_pdf
from app.retriever import retrieve_evidence_bm25, fetch_external_source
from app.verifier import verify_claim


client = TestClient(app)


# --- 1. Test Claim and Bibliography Extraction ---

def test_claim_and_bib_extraction():
    """Verify that body text and references are cleanly separated and citations are mapped."""
    sample_doc = (
        "Neural machine translation has advanced significantly with attention mechanisms [1]. "
        "Recent benchmarks demonstrate that sparse mixture-of-experts models reduce training compute by 40% [2]. "
        "Furthermore, instruction tuning aligns models effectively (Brown et al., 2020).\n\n"
        "References\n"
        "[1] Vaswani, A., et al. (2017). Attention is All You Need. NeurIPS.\n"
        "[2] Fedus, W., et al. (2022). Switch Transformers: Scaling to Trillion Parameter Models. JMLR.\n"
        "[3] Brown, T., et al. (2020). Language Models are Few-Shot Learners. NeurIPS."
    )

    data = extract_claims_and_bib(sample_doc)
    claims = data["claims"]
    bib = data["bibliography"]

    assert len(claims) >= 2
    assert "[1]" in bib
    assert "Vaswani" in bib["[1]"]

    # Validate first claim mapping
    claim_1 = next(c for c in claims if c["citation_marker"] == "[1]")
    assert "attention mechanisms" in claim_1["claim_text"]
    assert "Vaswani" in claim_1["cited_reference"]

    # Validate bracket comma expansion e.g. [1, 2]
    multi_cite_doc = (
        "Modern deep architectures benefit from residual connections [1, 2].\n\n"
        "References\n"
        "[1] He, K., et al. Deep Residual Learning. CVPR 2016.\n"
        "[2] Huang, G., et al. Densely Connected Convolutional Networks. CVPR 2017."
    )
    multi_data = extract_claims_and_bib(multi_cite_doc)
    markers = [c["citation_marker"] for c in multi_data["claims"]]
    assert "[1]" in markers
    assert "[2]" in markers


# --- 2. Test BM25 Evidence Ranking ---

def test_bm25_evidence_ranking():
    """Ensure BM25Okapi accurately ranks and retrieves the most relevant passage."""
    source_corpus = (
        "Paragraph A: Deep learning models are computationally expensive and require specialized GPU clusters to train.\n\n"
        "Paragraph B: Our empirical benchmarks demonstrate that 8-bit quantization reduces memory bandwidth consumption by 65% on tensor cores.\n\n"
        "Paragraph C: High-level language modeling datasets were curated from public web crawl repositories."
    )

    query = "Quantization reduces memory bandwidth on tensor cores."
    evidence = retrieve_evidence_bm25(query, source_corpus, top_k=1)

    assert "Paragraph B" in evidence
    assert "quantization" in evidence.lower()
    assert "bandwidth" in evidence.lower()

    # Empty corpus handling
    assert retrieve_evidence_bm25(query, "") == ""


# --- 3. Test Unverifiable Source Detection ---

def test_unverifiable_source_detection():
    """Ensure missing evidence or non-existent/fabricated references yield 'Unverifiable'."""
    # When source_found is False
    res_not_found = verify_claim(
        claim_text="Quantum models converge in 1 step [1].",
        cited_reference="[1] Fictional Paper on NonExistent Topics.",
        evidence_snippet="",
        source_found=False,
    )
    assert res_not_found["verdict"] == "Unverifiable"
    assert res_not_found["confidence"] >= 0.90

    # When evidence is empty string
    res_empty_evid = verify_claim(
        claim_text="Some plausible claim [2].",
        cited_reference="[2] Real Author (2020). Real Paper Title.",
        evidence_snippet="   ",
        source_found=True,
    )
    assert res_empty_evid["verdict"] == "Unverifiable"

    # Fabrication detection in retriever
    fab_check = fetch_external_source("Fabricated Paper by NonExistent Author (2024)")
    assert fab_check["source_found"] is False


# --- 4. Test Contradiction and Numerical Mismatch (Mismatched) ---

def test_contradiction_and_numerical_mismatch():
    """Ensure conflicting percentages, facts, and negations trigger 'Mismatched'."""
    # Test numerical conflict
    claim_num = "The new algorithm improved inference throughput by 85% on standard benchmarks [1]."
    evid_conflict = "Our evaluations show that the algorithm improved inference throughput by only 15% on standard benchmarks."
    res_num = verify_claim(claim_num, "[1] Ref", evid_conflict, source_found=True)
    assert res_num["verdict"] == "Mismatched"
    assert "contradiction" in res_num["explanation"].lower() or "conflict" in res_num["explanation"].lower() or "mismatch" in res_num["explanation"].lower()

    # Test direct negation / failure
    claim_neg = "The drug successfully eliminated systemic inflammation in diabetic mice [2]."
    evid_neg = "In our laboratory trials, the drug failed to eliminate systemic inflammation in diabetic mice, showing no significant difference."
    res_neg = verify_claim(claim_neg, "[2] Ref", evid_neg, source_found=True)
    assert res_neg["verdict"] == "Mismatched"

    # Test complete topical irrelevance
    claim_irrelevant = "The transformer model achieved state-of-the-art BLEU score on WMT14 [3]."
    evid_irrelevant = "Global ocean acidification has accelerated coral bleaching in tropical reefs over the last decade."
    res_irrel = verify_claim(claim_irrelevant, "[3] Ref", evid_irrelevant, source_found=True)
    assert res_irrel["verdict"] == "Mismatched"


# --- 5. Test Benchmark Endpoint and Accuracy Threshold (>= 75%) ---

def test_benchmark_endpoint_accuracy():
    """Verify that /api/benchmark runs the 12 golden test cases with >= 75% accuracy and valid schema."""
    response = client.get("/api/benchmark")
    assert response.status_code == 200
    data = response.json()

    assert "total_cases" in data
    assert "correct_predictions" in data
    assert "overall_accuracy" in data
    assert "per_class_metrics" in data
    assert "cases" in data

    assert data["total_cases"] == 12
    # Verify rubric requirement: >= 75% accuracy
    assert data["overall_accuracy"] >= 0.75

    for c in ["Supported", "Weakly Supported", "Mismatched", "Unverifiable"]:
        assert c in data["per_class_metrics"]
        metrics = data["per_class_metrics"][c]
        assert "precision" in metrics
        assert "recall" in metrics
        assert "f1" in metrics
        assert metrics["support"] == 3


# --- 6. Test Full Verify Pipeline with Sample Paper ---

def test_verify_endpoint_full_pipeline():
    """Verify POST /api/verify correctly handles the 4 citation categories in sample paper."""
    sample_resp = client.get("/api/sample")
    assert sample_resp.status_code == 200
    sample_data = sample_resp.json()

    verify_resp = client.post(
        "/api/verify",
        json={
            "document_text": sample_data["document_text"],
            "source_texts": sample_data["source_texts"],
            "fetch_external": False,
        },
    )
    assert verify_resp.status_code == 200
    v_data = verify_resp.json()

    summary = v_data["summary"]
    assert summary["total_claims"] == 4
    assert summary["supported"] == 1
    assert summary["weakly_supported"] == 1
    assert summary["mismatched"] == 1
    assert summary["unverifiable"] == 1

    # Check individual results
    results = v_data["results"]
    verdict_map = {r["citation_marker"]: r["verdict"] for r in results}
    assert verdict_map.get("[1]") == "Supported"
    assert verdict_map.get("[2]") == "Weakly Supported"
    assert verdict_map.get("[3]") == "Mismatched"
    assert verdict_map.get("[4]") == "Unverifiable"


# --- 7. Test PDF Extraction and /api/extract-pdf Endpoint ---

def test_pdf_extraction_endpoint():
    """Generate a synthetic in-memory PDF and verify text extraction endpoint."""
    pdf_doc = fitz.open()
    page = pdf_doc.new_page()
    test_text = (
        "Attention Is All You Need in Modern Deep Learning [1].\n\n"
        "References\n"
        "[1] Vaswani, A., et al. (2017). Attention is All You Need. NeurIPS."
    )
    page.insert_text((50, 72), test_text, fontsize=11)
    pdf_bytes = pdf_doc.tobytes()
    pdf_doc.close()

    # Direct function test
    extracted = extract_text_from_pdf(pdf_bytes)
    assert "Attention Is All You Need" in extracted
    assert "[1]" in extracted

    # API endpoint test
    files = {"file": ("test_paper.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    resp = client.post("/api/extract-pdf", files=files)
    assert resp.status_code == 200
    assert "document_text" in resp.json()
    assert "Attention Is All You Need" in resp.json()["document_text"]


# --- 8. Test Authentication (Register, Login, Me, Logout) ---

def test_user_registration_and_login():
    """Verify user registration, login, profile check, and logout lifecycle."""
    import secrets
    unique_suffix = secrets.token_hex(4)
    username = f"user_{unique_suffix}"
    email = f"{username}@mit.edu"
    password = "SecurePassword123"

    # Register
    reg_resp = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": password},
    )
    assert reg_resp.status_code == 200
    reg_data = reg_resp.json()
    assert reg_data["success"] is True
    assert "token" in reg_data
    token = reg_data["token"]

    # Check profile
    me_resp = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["user"]["username"] == username

    # Duplicate registration should be rejected
    dup_resp = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": password},
    )
    assert dup_resp.status_code == 400

    # Login
    login_resp = client.post(
        "/api/login",
        json={"username_or_email": username, "password": password},
    )
    assert login_resp.status_code == 200
    login_token = login_resp.json()["token"]

    # Logout
    logout_resp = client.post("/api/logout", headers={"Authorization": f"Bearer {login_token}"})
    assert logout_resp.status_code == 200

    # Profile after logout should fail
    me_after = client.get("/api/me", headers={"Authorization": f"Bearer {login_token}"})
    assert me_after.status_code == 401


# --- 9. Test Authenticated Verification & History Workflow ---

def test_authenticated_verification_and_history_workflow():
    """Verify that when a logged-in user verifies a document, it is automatically archived in History."""
    import secrets
    unique_suffix = secrets.token_hex(4)
    username = f"analyst_{unique_suffix}"
    email = f"{username}@research.org"
    password = "ResearchPassword123"

    # Register
    reg_resp = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": password},
    )
    token = reg_resp.json()["token"]

    # Verify a document with user token
    sample_resp = client.get("/api/sample")
    sample_data = sample_resp.json()

    verify_resp = client.post(
        "/api/verify",
        json={
            "document_text": sample_data["document_text"],
            "paper_title": "Efficiency in Retrieval Transformers",
            "source_texts": sample_data["source_texts"],
            "fetch_external": False,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert verify_resp.status_code == 200
    v_data = verify_resp.json()
    assert "analysis_id" in v_data
    analysis_id = v_data["analysis_id"]
    assert analysis_id is not None

    # Retrieve history list
    hist_resp = client.get("/api/history", headers={"Authorization": f"Bearer {token}"})
    assert hist_resp.status_code == 200
    history = hist_resp.json()["history"]
    assert len(history) >= 1
    assert any(item["id"] == analysis_id for item in history)

    # Retrieve individual analysis detail
    detail_resp = client.get(f"/api/history/{analysis_id}", headers={"Authorization": f"Bearer {token}"})
    assert detail_resp.status_code == 200
    detail_data = detail_resp.json()
    assert detail_data["paper_title"] == "Efficiency in Retrieval Transformers"
    assert len(detail_data["results"]) == 4
    assert detail_data["summary"]["total_claims"] == 4

    # Delete analysis
    del_resp = client.delete(f"/api/history/{analysis_id}", headers={"Authorization": f"Bearer {token}"})
    assert del_resp.status_code == 200

    # Retrieve after delete should return 404
    detail_deleted = client.get(f"/api/history/{analysis_id}", headers={"Authorization": f"Bearer {token}"})
    assert detail_deleted.status_code == 404


# --- 10. Test Unauthenticated Access to History is Blocked ---

def test_unauthenticated_history_access_rejected():
    """Verify that history endpoints enforce authentication."""
    resp = client.get("/api/history")
    assert resp.status_code == 401

    resp_detail = client.get("/api/history/999")
    assert resp_detail.status_code == 401

