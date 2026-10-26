"""Tests for email authentication, credential uniqueness, and validation security features."""

import sys
import uuid
from pathlib import Path

# Ensure root directory is on python path for test execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app.main import app
import app.database as db

client = TestClient(app)


def random_suffix() -> str:
    return uuid.uuid4().hex[:8]


def test_unique_username_case_insensitive():
    suffix = random_suffix()
    username = f"DrSmith_{suffix}"
    email = f"drsmith_{suffix}@oxford.ac.uk"

    # First registration must succeed
    res = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": "SecurePassword123!"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "verification_code" in data
    assert len(data["verification_code"]) == 6
    assert data["user"]["is_verified"] is False

    # Second registration with exact same username must fail
    res_exact = client.post(
        "/api/register",
        json={"username": username, "email": f"other_{suffix}@oxford.ac.uk", "password": "SecurePassword123!"},
    )
    assert res_exact.status_code == 400
    assert "already taken" in res_exact.json()["detail"].lower()

    # Third registration with different casing (lowercase) must ALSO fail
    res_case = client.post(
        "/api/register",
        json={"username": username.lower(), "email": f"diff_{suffix}@oxford.ac.uk", "password": "SecurePassword123!"},
    )
    assert res_case.status_code == 400
    assert "already taken" in res_case.json()["detail"].lower()


def test_unique_email_case_insensitive():
    suffix = random_suffix()
    username = f"ProfBrown_{suffix}"
    email = f"Brown_{suffix}@cambridge.edu"

    # First registration
    res = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": "SecurePassword123!"},
    )
    assert res.status_code == 200

    # Registration with exact same email must fail
    res_exact = client.post(
        "/api/register",
        json={"username": f"OtherUser_{suffix}", "email": email, "password": "SecurePassword123!"},
    )
    assert res_exact.status_code == 400
    assert "already registered" in res_exact.json()["detail"].lower()

    # Registration with uppercase email must also fail
    res_case = client.post(
        "/api/register",
        json={"username": f"ThirdUser_{suffix}", "email": email.upper(), "password": "SecurePassword123!"},
    )
    assert res_case.status_code == 400
    assert "already registered" in res_case.json()["detail"].lower()


def test_input_validation_rules():
    suffix = random_suffix()

    # Invalid username with spaces
    res = client.post(
        "/api/register",
        json={"username": "invalid user", "email": f"u_{suffix}@test.com", "password": "SecurePassword123!"},
    )
    assert res.status_code == 400
    assert "username must" in res.json()["detail"].lower()

    # Invalid username starting with symbol
    res = client.post(
        "/api/register",
        json={"username": "-invalid", "email": f"u_{suffix}@test.com", "password": "SecurePassword123!"},
    )
    assert res.status_code == 400

    # Invalid email without @ or domain
    res = client.post(
        "/api/register",
        json={"username": f"valid_{suffix}", "email": "notanemail", "password": "SecurePassword123!"},
    )
    assert res.status_code == 400
    assert "valid email" in res.json()["detail"].lower()

    # Short password (<8 chars)
    res = client.post(
        "/api/register",
        json={"username": f"valid_{suffix}", "email": f"u_{suffix}@test.com", "password": "short"},
    )
    assert res.status_code == 400
    assert "at least 8 characters" in res.json()["detail"].lower()


def test_check_availability_endpoint():
    suffix = random_suffix()
    username = f"Curie_{suffix}"
    email = f"curie_{suffix}@sorbonne.fr"

    # Check non-existent user
    res = client.get(f"/api/check-availability?username={username}&email={email}")
    assert res.status_code == 200
    data = res.json()
    assert data["username"]["available"] is True
    assert data["username"]["valid"] is True
    assert data["email"]["available"] is True
    assert data["email"]["valid"] is True

    # Register user
    client.post(
        "/api/register",
        json={"username": username, "email": email, "password": "SecurePassword123!"},
    )

    # Check again - should now report unavailable
    res2 = client.get(f"/api/check-availability?username={username.lower()}&email={email.upper()}")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["username"]["available"] is False
    assert data2["email"]["available"] is False


def test_email_verification_flow():
    suffix = random_suffix()
    username = f"Researcher_{suffix}"
    email = f"res_{suffix}@mit.edu"

    reg_res = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": "SecurePassword123!"},
    )
    assert reg_res.status_code == 200
    reg_data = reg_res.json()
    token = reg_data["token"]
    code = reg_data["verification_code"]
    assert code and len(code) == 6

    # Verify profile initially shows is_verified = False
    me_res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["user"]["is_verified"] is False

    # Attempt verification with wrong code
    wrong_res = client.post(
        "/api/verify-email",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": "000000"},
    )
    assert wrong_res.status_code == 400
    assert "invalid verification code" in wrong_res.json()["detail"].lower()

    # Verify with correct code
    good_res = client.post(
        "/api/verify-email",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": code},
    )
    assert good_res.status_code == 200
    good_data = good_res.json()
    assert good_data["success"] is True
    assert good_data["user"]["is_verified"] is True

    # Profile now reflects is_verified = True
    me_res2 = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res2.status_code == 200
    assert me_res2.json()["user"]["is_verified"] is True


def test_resend_verification_code():
    suffix = random_suffix()
    username = f"Franklin_{suffix}"
    email = f"franklin_{suffix}@kcl.ac.uk"

    reg_res = client.post(
        "/api/register",
        json={"username": username, "email": email, "password": "SecurePassword123!"},
    )
    token = reg_res.json()["token"]
    initial_code = reg_res.json()["verification_code"]

    # Request new code
    resend_res = client.post(
        "/api/resend-verification",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert resend_res.status_code == 200
    new_code = resend_res.json()["verification_code"]
    assert len(new_code) == 6

    # Verify with new code succeeds
    verify_res = client.post(
        "/api/verify-email",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": new_code},
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["user"]["is_verified"] is True
