# citeguard-ai
CiteGuard AI — Claim-to-Source Citation Verifier
  An intelligent academic auditing workspace designed to inspect research text, verify inline citations against source evidence, and classify them into rigorous reliability tiers.
  
Live Demo & Deployment
  Live Web App: Render Deployment (Deployed live as a unified FastAPI service)
  
Overview 
  Researchers, students, and reviewers often struggle with academic integrity: a bibliography entry can exist while the cited source still fails to support or even contradicts the sentence that refers to it. CiteGuard AI solves this by automating document inspection, matching claims against source PDFs and metadata APIs, and categorizing citation accuracy into four distinct tiers: Supported, Weakly Supported, Mismatched, and Unverifiable.
  
Upstream Open-Source Extensions
  This project meaningfully extends and integrates powerful open-source libraries:
    1. PyMuPDF (pymupdf/PyMuPDF): Used for lightning-fast PDF text extraction and structural parsing.
    2. rank-bm25 (dorianbrown/rank_bm25): Implements lexical BM25 evidence retrieval over chunked             documents.
    3. FastAPI & Tailwind CSS: Powering a high-performance, single-service web application framework.
    
Architecture & System Workflow

 [ Research Document / PDF ] 
             │
             ▼
   [ Claim Extractor ] ──► (Parses inline markers & bibliography)
             │
             ▼
   [ Hybrid Retriever ] ──► (BM25 local chunk search OR Crossref/arXiv API)
             │
             ▼
   [ LLM Verdict Engine ] ──► (Gemma / Llama open-weight model via strict JSON schema)
             │
             ▼
   [ Split-Screen UI Dashboard ] ──► (Interactive Inspector, KPIs, & Benchmarks)

Repository Structure

  citeguard-ai/
  ├── .gitignore
  ├── README.md
  ├── requirements.txt
  ├── render.yaml
  ├── app/
  │   ├── __init__.py
  │   ├── main.py              # FastAPI endpoints & static file mounting
  │   ├── extractor.py         # PDF text parsing & citation marker mapping
  │   ├── retriever.py         # BM25 local retrieval & Crossref/arXiv fetcher
  │   ├── verifier.py          # Open-weight LLM judge (4-class classification)
  │   └── benchmark_data.json  # Golden test dataset for evaluation
  ├── static/
  │   ├── index.html           # Tailwind CSS academic audit dashboard UI
  │   └── app.js               # Frontend fetch handlers, state, & UI renderers
  └── tests/
      └── test_verifier.py     # Pytest automated test suite

Local Setup & Installation
  1. Clone the Repository
     git clone https://github.com/sigmasajan/citeguard-ai.git
     cd citeguard-ai

  2. Create & Activate Virtual Environment
     python3 -m venv venv
     source venv/bin/activate  # On Windows: venv\Scripts\activate

  3. Install Dependencies
     pip install -r requirements.txt

4. Configure Environment Variables
  Create a .env file in the root directory and add your API key (Google Gemini or Groq):
    GEMINI_API_KEY=your_api_key_here
    # OR
    GROQ_API_KEY=your_api_key_here

5. Run the Local Server
  uvicorn app.main:app --reload --port 8000

  Open your browser and navigate to http://localhost:8000.
  Running Automated Tests
  To run the test suite and verify core parsing and classification components:
    pytest -v
