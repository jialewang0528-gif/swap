"""Swap's private data link: the phone asks, this pulls fresh data from Plaid and answers.

GET /api/live with "Authorization: Bearer <SWAP_APP_TOKEN>" returns the same JSON the Mac's
sync.py writes to app/private/live.js (minus logos; the phone keeps its bundled ones).
POST /api/live (same key) asks Plaid to check the bank now (/transactions/refresh). Plaid does
that in the background, usually within a minute or two; the app then polls GET until
bankCheckedAt moves. Plaid bills refresh per call on paid plans (included on the Trial plan).
Everything secret lives in this Vercel project's environment variables, never in code:
PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, PLAID_ACCESS_TOKEN, SWAP_APP_TOKEN, plus the non-secret
options cloud/sync_env.py keeps in step with .env (HIDE_MERCHANTS, CLUB_MERCHANTS, RIDE_APP_NAME,
RECOMMEND_RIDE_APP, SUPPORT_SENDERS, CATEGORY_OVERRIDES).
"""

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_lib"))
import sync  # noqa: E402  (pull.py, ledger.py, sync.py copied from the Swap repo by deploy.sh)

# Each Plaid call gives up well inside the function's 30 s limit (vercel.json), so a slow bank ends
# as a clean 502 instead of a platform timeout.
os.environ.setdefault("PLAID_TIMEOUT", "20")

# Only the app itself may read this cross-origin: the iPhone web view loads from file://, which
# sends Origin "null", and the local preview server runs on port 8744. URLSession sends no Origin.
ALLOWED_ORIGINS = {"null", "http://localhost:8744", "http://127.0.0.1:8744"}
CORS = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "600",
}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body=b"", kind="application/json"):
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            for k, v in CORS.items():
                self.send_header(k, v)
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        if body:
            self.send_header("Content-Type", kind)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        expected = os.environ.get("SWAP_APP_TOKEN", "")
        given = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        if not expected or not hmac.compare_digest(given, expected):
            self._send(401, b'{"error":"unauthorized"}')
            return
        try:
            live = sync.build_live(os.environ["PLAID_ACCESS_TOKEN"], logos=False)
        except SystemExit as e:          # pull.plaid exits on Plaid errors
            self._send(502, json.dumps({"error": str(e)[:300]}).encode())
            return
        except Exception as e:
            self._send(500, json.dumps({"error": type(e).__name__}).encode())
            return
        self._send(200, json.dumps(live).encode())

    def do_POST(self):
        expected = os.environ.get("SWAP_APP_TOKEN", "")
        given = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        if not expected or not hmac.compare_digest(given, expected):
            self._send(401, b'{"error":"unauthorized"}')
            return
        try:
            sync.pull.plaid("/transactions/refresh", {"access_token": os.environ["PLAID_ACCESS_TOKEN"]})
        except SystemExit as e:
            self._send(502, json.dumps({"error": str(e)[:300]}).encode())
            return
        except Exception as e:
            self._send(500, json.dumps({"error": type(e).__name__}).encode())
            return
        self._send(200, b'{"ok":true}')
