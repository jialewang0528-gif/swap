"""Swap's private data link: the phone asks, this pulls fresh data from Plaid and answers.

GET /api/live with "Authorization: Bearer <SWAP_APP_TOKEN>" returns the same JSON the Mac's
sync.py writes to app/private/live.js (minus logos; the phone keeps its bundled ones).
Everything secret lives in this Vercel project's environment variables, never in code:
PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, PLAID_ACCESS_TOKEN, SWAP_APP_TOKEN,
HIDE_MERCHANTS, SUPPORT_SENDERS.
"""

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_lib"))
import sync  # noqa: E402  (pull.py, ledger.py, sync.py copied from the Swap repo by deploy.sh)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "600",
}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body=b"", kind="application/json"):
        self.send_response(status)
        for k, v in CORS.items():
            self.send_header(k, v)
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
