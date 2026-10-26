# CiteGuard AI — Claim-to-Source Citation Verifier

> INFINITY AI FORGE Hackathon 2026 entry built for the Claim-to-Source Citation Verifier challenge. An intelligent academic auditing workspace designed to inspect research text, verify inline citations against source evidence, and classify them into rigorous reliability tiers.

---

## Live Demo & Deployment
* Live Web App: Render Deployment (https://citeguard-ai.onrender.com) (Deployed live as a unified FastAPI service)

---

## Overview & Problem Statement
Researchers, students, and reviewers often struggle with academic integrity: a bibliography entry can exist while the cited source still fails to support or even contradicts the sentence that refers to it. CiteGuard AI solves this by automating document inspection, matching claims against source PDFs and metadata APIs, and categorizing citation accuracy into four distinct tiers: Supported, Weakly Supported, Mismatched, and Unverifiable.

---

## Upstream Open-Source Extensions
Per Hacktoberfest rules, this project meaningfully extends and integrates powerful open-source libraries:
* PyMuPDF (pymupdf/PyMuPDF): Used for lightning-fast PDF text extraction and structural parsing.
* rank-bm25 (dorianbrown/rank_bm25): Implements lexical BM25 evidence retrieval over chunked documents.
* FastAPI & Tailwind CSS: Powering a high-performance, single-service web application framework.

---

## Architecture & System Workflow

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

---

## Repository Structure

```text
citeguard-ai/
├── .gitignore
├── README.md
├── requirements.txt
├── render.yaml
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI endpoints & static file mounting
│   ├── database.py          # SQLite persistence, PBKDF2 auth & email verification OTPs
│   ├── extractor.py         # PDF text parsing & citation marker mapping
│   ├── retriever.py         # BM25 local retrieval & Crossref/arXiv fetcher
│   ├── verifier.py          # Open-weight LLM judge (4-class classification)
│   └── benchmark_data.json  # Golden test dataset for evaluation
├── static/
│   ├── index.html           # Tailwind CSS academic audit dashboard UI
│   ├── app.js               # Frontend fetch handlers, state, & UI renderers
│   └── style.css            # Custom CSS styling, glassmorphism, & animations
└── tests/
    ├── test_verifier.py     # Core claim extraction & verifier test suite
    └── test_auth_security.py # Authentication, email OTP, & uniqueness test suite
```

---

## Security & Authentication Features

CiteGuard AI includes a built-in, zero-external-dependency authentication and security subsystem powered by SQLite and PBKDF2-HMAC-SHA256:

* **Strict Credential Uniqueness**: Username and email address uniqueness is strictly enforced at both the application level and the database level with case-insensitive unique indexes (`LOWER(username)`, `LOWER(email)`).
* **Format & Strength Validation**:
  * Usernames must be 3–30 characters long, alphanumeric with hyphens and underscores (`^[a-zA-Z0-9][a-zA-Z0-9_-]{2,29}$`).
  * Emails are validated against standard RFC specifications.
  * Passwords enforce a minimum of 8 characters with a real-time 3-stage visual strength meter (Weak / Medium / Strong).
* **Real-Time Availability Feedback**: Form inputs feature a 320ms debounced live availability check (`/api/check-availability`) providing instant validation indicators before form submission.
* **Email Authentication & OTP Verification**:
  * Each newly registered researcher account generates a cryptographically secure 6-digit OTP code (`secrets.randbelow(900000) + 100000`) with a 15-minute expiration timestamp.
  * Interactive email verification step with dev auto-fill chip and a 30-second resend countdown timer.
  * Verified accounts display a green `Verified` badge in the header profile pill.
* **Persistent Audit History**: Signed-in users have their past document inspections automatically saved to SQLite, accessible via the Sessions drawer and History tab.

---

## API Endpoints

### Verification & Core Engine
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health status check |
| `GET` | `/api/sample` | Pre-built demonstration paper with all 4 citation verdicts |
| `POST` | `/api/extract-pdf` | PyMuPDF structural text extraction from uploaded PDF |
| `POST` | `/api/fetch-url` | Query Crossref & arXiv APIs for external publication metadata |
| `POST` | `/api/verify` | Full claim extraction, BM25 retrieval, and verification judge |
| `GET` | `/api/benchmark` | 12-case benchmark evaluation with precision, recall, & F1 metrics |

### Authentication & Account Security
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/check-availability` | Check username or email availability in real-time |
| `POST` | `/api/register` | Register user account with PBKDF2 hash & generate 6-digit email OTP |
| `POST` | `/api/login` | Authenticate credentials and return session bearer token |
| `GET` | `/api/me` | Fetch active user profile including email verification status |
| `POST` | `/api/verify-email` | Validate 6-digit OTP code and activate researcher account |
| `POST` | `/api/resend-verification` | Generate and dispatch a fresh 6-digit OTP code |
| `POST` | `/api/logout` | Invalidate and purge active session token |
| `GET` | `/api/history` | List user's saved verification audit sessions |
| `GET` | `/api/history/{id}` | Load specific past audit report into Inspector |
| `DELETE` | `/api/history/{id}` | Delete a saved audit record |

---

## Local Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/sigmasajan/citeguard-ai.git
cd citeguard-ai
```

### 2. Create & Activate Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables
Create a `.env` file in the root directory and add your API key:
```env
GEMINI_API_KEY=your_api_key_here
# OR
GROQ_API_KEY=your_api_key_here
```

### 5. Run the Local Server
```bash
uvicorn app.main:app --reload --port 8000
```
Open your browser and navigate to `http://localhost:8000`.

---

## Running Automated Tests

To run the complete test suite (both verifier logic and authentication security):
```bash
pytest -v
```
