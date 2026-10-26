"""Email delivery and validation service for CiteGuard AI.

Handles:
1. Domain and deliverability validation (format check + active DNS resolution).
2. Live email dispatch via SMTP (Gmail, Outlook, SendGrid, Mailgun, Brevo, AWS SES)
   with fallback logging when SMTP credentials are not yet configured.
"""

from typing import Tuple, Optional
import os
import re
import socket
import smtplib
from email.message import EmailMessage
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


def validate_email_deliverability(email: str) -> Tuple[bool, str]:
    """Validate that the email has correct syntax and that its domain resolves to real DNS servers.

    Returns:
        Tuple of (is_valid: bool, reason: str)
    """
    clean_email = (email or "").strip().lower()
    if not clean_email:
        return False, "Email address cannot be empty."

    if len(clean_email) > 254:
        return False, "Email address is too long."

    if not EMAIL_REGEX.match(clean_email):
        return False, "Please enter a valid email address (e.g., researcher@university.edu)."

    domain = clean_email.split("@")[-1].strip()
    if "." not in domain or len(domain.split(".")[-1]) < 2:
        return False, f"Domain '@{domain}' is invalid."

    # Verify domain exists via DNS query
    try:
        # Check standard address resolution with a 3.5s timeout
        socket.setdefaulttimeout(3.5)
        socket.getaddrinfo(domain, None)
        return True, "Email domain is valid and reachable."
    except (socket.gaierror, socket.herror, TimeoutError, OSError):
        return False, f"The email domain '@{domain}' does not exist or has no active DNS records. Please use a valid email address."


def is_smtp_configured() -> bool:
    """Check whether SMTP environment variables are configured."""
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER") or os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS")
    return bool(host and user and password)


def send_verification_email(to_email: str, username: str, code: str) -> Tuple[bool, str]:
    """Send a verification email containing the 6-digit OTP code.

    Returns:
        Tuple of (success: bool, status_message: str)
    """
    clean_to = to_email.strip().lower()
    clean_name = username.strip() or "Researcher"

    # Pre-flight domain check
    valid, reason = validate_email_deliverability(clean_to)
    if not valid:
        return False, reason

    smtp_host = os.getenv("SMTP_HOST")
    smtp_port_raw = os.getenv("SMTP_PORT", "587")
    try:
        smtp_port = int(smtp_port_raw)
    except ValueError:
        smtp_port = 587

    smtp_user = os.getenv("SMTP_USER") or os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS")
    smtp_from = os.getenv("SMTP_FROM") or (f"CiteGuard AI <{smtp_user}>" if smtp_user else "CiteGuard AI <verify@citeguard.ai>")
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() in ("true", "1", "yes") or smtp_port == 465

    if not is_smtp_configured():
        msg = (
            f"[CiteGuard AI Email Service] SMTP is not yet configured. "
            f"Code '{code}' for {clean_to} was generated in Demo Mode. "
            f"To send live emails, set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD in your environment or Render dashboard."
        )
        print(msg)
        return False, "SMTP server is not configured. (Use the displayed code to test in Demo Mode, or set SMTP environment variables for live inbox delivery)."

    try:
        msg = EmailMessage()
        msg["Subject"] = f"Your CiteGuard AI Verification Code: {code}"
        msg["From"] = smtp_from
        msg["To"] = clean_to

        # Plaintext fallback
        text_content = f"""Hello {clean_name},

Thank you for registering with CiteGuard AI — the Autonomous Claim-to-Source Citation Verifier.

Your 6-digit email authentication code is:

{code}

This code will expire in 15 minutes.
If you did not request this verification code, please ignore this email.

Best regards,
The CiteGuard AI Research Team
"""
        msg.set_content(text_content)

        # Responsive Rich HTML email body
        html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CiteGuard AI Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: #131b2e; border: 1px solid #2d3748; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <!-- Header Banner -->
          <tr>
            <td style="padding: 30px 35px 20px; background: linear-gradient(135deg, rgba(79, 70, 229, 0.25) 0%, rgba(147, 51, 234, 0.2) 100%); border-bottom: 1px solid #1e293b;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                      🛡️ CiteGuard AI
                    </h1>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #a5b4fc; font-weight: 500;">
                      Claim-to-Source Citation Verification Platform
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 35px 35px 25px;">
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 700; color: #ffffff;">
                Verify Your Researcher Account
              </h2>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Hello <strong style="color: #f1f5f9;">{clean_name}</strong>, thank you for joining CiteGuard AI. To complete your registration and activate your verified researcher profile, please enter the following authentication code:
              </p>

              <!-- OTP Code Display Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 25px 0;">
                <tr>
                  <td align="center" style="background: #0f172a; border: 1.5px dashed #6366f1; border-radius: 14px; padding: 22px;">
                    <div style="font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #818cf8;">
                      {code}
                    </div>
                    <div style="margin-top: 8px; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                      Expires in 15 minutes
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: #64748b;">
                ⚠️ <strong>Security Notice:</strong> Never share this code with anyone. CiteGuard AI staff will never ask for your authentication code.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 35px 30px; border-top: 1px solid #1e293b; background-color: #0b0f19;">
              <p style="margin: 0; font-size: 11px; color: #475569; line-height: 1.5; text-align: center;">
                If you did not attempt to create an account on CiteGuard AI, you can safely disregard this email.<br>
                © 2026 CiteGuard AI — Automated Claim-to-Source Citation Verifier.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""
        msg.add_alternative(html_content, subtype="html")

        if use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10.0) as server:
                server.login(smtp_user, smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10.0) as server:
                server.starttls()
                server.login(smtp_user, smtp_password)
                server.send_message(msg)

        return True, f"Verification code successfully sent to {clean_to}."
    except smtplib.SMTPAuthenticationError as auth_err:
        err_msg = f"SMTP Authentication failed: check your SMTP username/password. {auth_err}"
        print(f"[CiteGuard AI Email Error] {err_msg}")
        return False, err_msg
    except Exception as exc:
        err_msg = f"Failed to send email to {clean_to}: {str(exc)}"
        print(f"[CiteGuard AI Email Error] {err_msg}")
        return False, err_msg
