"""One-off Plaid pull for the Swap pilot.

Pulls a person's card history once, keeps ONLY food, drink and getting-around charges
(delivery, restaurants and bars, quick food and coffee, groceries, rides, subway, bikes,
plus DashPass-style memberships), and writes them to data/<person>.csv. Everything else
(rent, shopping, transfers, paychecks) is dropped in memory and never saved.

Commands:
  python3 pull.py link    --person p01   # friend links their card in the browser, then pull
  python3 pull.py invite  --person p01   # remote: print a Plaid-hosted link to text the friend
  python3 pull.py collect --person p01   # remote: after they finish, save the link and pull
  python3 pull.py sandbox --person test  # fake Sandbox bank, no browser, for testing
  python3 pull.py pull    --person p01   # pull again with the saved link (end of test week)
  python3 pull.py remove  --person p01   # disconnect the bank link when the pilot ends

Only uses the Python standard library.
"""

import argparse
import csv
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
TOKENS_FILE = os.path.join(DATA_DIR, "tokens.json")

# Ask Plaid for 400 days so the baseline includes the same weeks last year.
# This only works at the FIRST link; it can't be raised later without re-linking.
DAYS_REQUESTED = 400
LINK_PORT = 8765
NYC = ZoneInfo("America/New_York")

PLAID_HOSTS = {
    "sandbox": "https://sandbox.plaid.com",
    "production": "https://production.plaid.com",
}

# --- Deciding what counts as food or getting around --------------------------

# Plaid has no "food delivery" category: a DoorDash order is filed under the
# restaurant's food category. So delivery is detected by name.
DELIVERY_PATTERN = re.compile(
    r"doordash|uber\s*\*?\s*eats|ubereats|grubhub|seamless|caviar|postmates",
    re.IGNORECASE,
)
RIDE_PATTERN = re.compile(r"\buber\b|\blyft\b|\bcurb\b", re.IGNORECASE)


class _RideAppPattern:
    """Some lower-fare ride apps put the driver's name in the bank text and Plaid files them as
    LOAN_PAYMENTS_CASH_ADVANCES, so they're matched on the app's billing tag instead of the category:
    "<APP>* <driver> DRIVE<APP>" when posted, "<APP>* HOLDFORDRIVER" while pending.

    The app's name is personal, so it only comes from .env: RIDE_APP_NAME (the tag is built from it),
    or RIDE_APP_PATTERN (a full regex) for an app that bills differently. Unset = matches nothing.
    Read on every call, so it works after pull.load_env() and in the cloud function's environment."""

    _cache = (None, None)

    def _compiled(self):
        key = (os.environ.get("RIDE_APP_PATTERN", "").strip(), os.environ.get("RIDE_APP_NAME", "").strip())
        if self._cache[0] != key:
            pattern, name = key
            if not pattern and name:
                n = re.escape(re.sub(r"\s+", "", name.lower()))
                pattern = rf"drive{n}|{n}\*\s*holdfordriver"
            self._cache = (key, re.compile(pattern, re.IGNORECASE) if pattern else None)
        return self._cache[1]

    def search(self, text):
        p = self._compiled()
        return p.search(text or "") if p else None


CHEAP_RIDE_APP_PATTERN = _RideAppPattern()
# Alcohol: bars and liquor stores, plus delis, bodegas and convenience stores (where the beer is).
# Card networks file a pending liquor-store charge as general merchandise, so names count too.
# Clubs and lounges: nights out, even when the card network files them as a restaurant. Add your
# own spots in .env as CLUB_MERCHANTS=place one,place two (kept out of git).
CLUB_PATTERN = re.compile(r"night\s*club|\blounge\b|\bhookah\b", re.IGNORECASE)


def is_club(text):
    own = [c.strip().lower() for c in os.environ.get("CLUB_MERCHANTS", "").split(",") if c.strip()]
    low = text.lower()
    return bool(CLUB_PATTERN.search(text)) or any(c in low for c in own)


DRINKS_PATTERN = re.compile(r"\bwine\b|liquor|spirits|\bbeer\b|bodega|\bdeli\b|mini\s*mar(ke)?t|go\s*mart|7-?eleven", re.IGNORECASE)
# Monthly passes like DashPass are a fixed cost, not an order, so they're counted separately.
MEMBERSHIP_PATTERN = re.compile(r"dashpass|uber\s*one|grubhub\s*\+|grubhub\s*plus|lyft\s*pink", re.IGNORECASE)


INTERCITY_PATTERN = re.compile(r"amtrak|nj\s*transit|flix|greyhound|megabus|peter\s*pan|lirr|metro-?north", re.IGNORECASE)
# Plaid category -> kind, for food and getting around that isn't delivery or a ride.
CATEGORY_KINDS = {
    "FOOD_AND_DRINK_RESTAURANT": "dining",
    "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR": "drinks",
    "GENERAL_MERCHANDISE_CONVENIENCE_STORES": "drinks",
    "FOOD_AND_DRINK_GROCERIES": "groceries",
    "TRANSPORTATION_PUBLIC_TRANSIT": "transit",
    "TRANSPORTATION_BIKES_AND_SCOOTERS": "transit",
}


def classify(txn):
    """Return the kind of food or getting-around charge, or None to drop it.

    Kinds: membership, delivery, ride, dining (restaurants), drinks (bars, liquor stores, delis and
    bodegas), quick_food (fast food, coffee, snacks, vending), groceries, transit (subway, bus, bikes).
    """
    category = (txn.get("personal_finance_category") or {}).get("detailed") or ""
    counterparties = txn.get("counterparties") or []
    # A Zelle/Venmo payment to someone named "Uber" is not a ride.
    if (category.startswith("TRANSFER") or any(c.get("type") == "payment_app" for c in counterparties)
            or re.match(r"\s*(zelle|venmo)", txn.get("name") or "", re.IGNORECASE)):
        return None
    if CHEAP_RIDE_APP_PATTERN.search(txn.get("name") or ""):
        return "ride"

    counterparty_names = " ".join(c.get("name") or "" for c in counterparties)
    text = " ".join([txn.get("merchant_name") or "", txn.get("name") or "", counterparty_names])

    if MEMBERSHIP_PATTERN.search(text):
        return "membership"
    # Check delivery before rides: "Uber Eats" also matches the plain "Uber" ride pattern.
    if DELIVERY_PATTERN.search(text):
        return "delivery"

    # Old and new Plaid category lists both contain this phrase.
    if "TAXIS_AND_RIDE_SHARES" in category or RIDE_PATTERN.search(text):
        return "ride"
    if is_club(text):
        return "drinks"
    if DRINKS_PATTERN.search(text) and not category.startswith("FOOD_AND_DRINK_RESTAURANT"):
        return "drinks"
    if category in CATEGORY_KINDS:
        # Trains and buses out of the city are trips, not getting around day to day.
        if CATEGORY_KINDS[category] == "transit" and INTERCITY_PATTERN.search(text):
            return None
        return CATEGORY_KINDS[category]
    if category.startswith("FOOD_AND_DRINK"):
        return "quick_food"
    return None


FIELDS = ["person", "date", "weekday", "hour_ny", "kind", "merchant", "amount", "plaid_category", "transaction_id"]


def to_row(person, txn, kind):
    """Keep only the fields the pilot needs. No account numbers, no locations."""
    # Many banks don't send a time of day; then hour_ny is left blank.
    when = txn.get("authorized_datetime") or txn.get("datetime")
    hour = parse_time(when).astimezone(NYC).hour if when else ""
    day = date.fromisoformat(txn.get("authorized_date") or txn["date"])
    return {
        "person": person,
        "date": day.isoformat(),
        "weekday": day.strftime("%a"),
        "hour_ny": hour,
        "kind": kind,
        # merchant_name, not the raw bank text: some ride charges include the driver's name.
        "merchant": txn.get("merchant_name") or txn.get("name"),
        # Plaid: positive = money out, negative = refund.
        "amount": txn["amount"],
        "plaid_category": (txn.get("personal_finance_category") or {}).get("detailed", ""),
        "transaction_id": txn["transaction_id"],
    }


# --- Talking to Plaid ---------------------------------------------------------

def load_env():
    path = os.path.join(HERE, ".env")
    if not os.path.exists(path):
        sys.exit("Missing .env. Copy .env.example to .env and add your Plaid keys.")
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
    env = os.environ.get("PLAID_ENV", "sandbox")
    if env not in PLAID_HOSTS:
        sys.exit(f"PLAID_ENV must be one of {list(PLAID_HOSTS)}")
    if not os.environ.get("PLAID_CLIENT_ID") or not os.environ.get("PLAID_SECRET"):
        sys.exit("PLAID_CLIENT_ID and PLAID_SECRET must be set in .env")
    return env


def parse_time(s):
    """Plaid's ISO times, which may carry a fraction of a second of any length ("...36.2Z") that
    Python 3.9's fromisoformat refuses. Returns an aware datetime."""
    s = re.sub(r"\.\d+", "", s.replace("Z", "+00:00"))
    return datetime.fromisoformat(s)


def plaid(path, body):
    """POST to the Plaid API and return the JSON response."""
    payload = dict(body, client_id=os.environ["PLAID_CLIENT_ID"], secret=os.environ["PLAID_SECRET"])
    request = urllib.request.Request(
        PLAID_HOSTS[os.environ["PLAID_ENV"]] + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    # The cloud function sets PLAID_TIMEOUT below its own time limit, so a slow page ends as a
    # clean error instead of the platform killing the function.
    timeout = float(os.environ.get("PLAID_TIMEOUT") or 60)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        error = json.load(e)
        sys.exit(f"Plaid error on {path}: {error.get('error_code')} - {error.get('error_message')}")
    except (urllib.error.URLError, TimeoutError) as e:
        sys.exit(f"Plaid unreachable on {path}: {getattr(e, 'reason', e)}")


def fetch_all_transactions(access_token):
    """Use /transactions/sync from the start until Plaid says history is complete."""
    transactions = {}
    cursor = ""
    deadline = time.time() + 180
    history_done = False
    while True:
        page = plaid("/transactions/sync", {"access_token": access_token, "cursor": cursor, "count": 500})
        for txn in page["added"] + page["modified"]:
            transactions[txn["transaction_id"]] = txn
        for txn in page["removed"]:
            transactions.pop(txn["transaction_id"], None)
        cursor = page["next_cursor"]
        if page["has_more"]:
            continue
        if history_done:
            break
        # Right after linking, Plaid is still loading older history in the background.
        # When it reports done, the older transactions only arrive on the NEXT sync,
        # so loop once more before stopping (the first real pull missed 12 months without this).
        if page.get("transactions_update_status") == "HISTORICAL_UPDATE_COMPLETE":
            history_done = True
            continue
        if time.time() > deadline:
            print("Warning: Plaid hadn't finished loading full history after 3 minutes. "
                  "Run `pull` again later to get the rest.")
            break
        print("  Plaid is still loading history, waiting 10s...")
        time.sleep(10)
    # Pending charges reappear as posted ones, so skip them to avoid double counting.
    return [t for t in transactions.values() if not t.get("pending")]


# --- Saving tokens and rows ---------------------------------------------------

def load_tokens():
    if not os.path.exists(TOKENS_FILE):
        return {}
    with open(TOKENS_FILE) as f:
        return json.load(f)


def save_token(person, access_token, item_id):
    tokens = load_tokens()
    tokens[person] = {"access_token": access_token, "item_id": item_id, "env": os.environ["PLAID_ENV"],
                      "linked_at": datetime.now().isoformat(timespec="seconds")}
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TOKENS_FILE, "w") as f:
        json.dump(tokens, f, indent=2)
    os.chmod(TOKENS_FILE, 0o600)


def pull_and_save(person, access_token):
    print(f"Pulling transactions for {person}...")
    all_txns = fetch_all_transactions(access_token)
    rows = []
    for txn in all_txns:
        kind = classify(txn)
        if kind:
            rows.append(to_row(person, txn, kind))
    rows.sort(key=lambda r: r["date"])

    os.makedirs(DATA_DIR, exist_ok=True)
    out = os.path.join(DATA_DIR, f"{person}.csv")
    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    dates = sorted(t["date"] for t in all_txns)
    print(f"Saw {len(all_txns)} transactions ({dates[0] if dates else '-'} to {dates[-1] if dates else '-'}), "
          f"kept {len(rows)} food + getting-around rows -> {os.path.relpath(out, HERE)}")
    if dates:
        print_summary(rows, date.fromisoformat(dates[0]), date.fromisoformat(dates[-1]))


def print_summary(rows, first, last, weeks=6):
    """Quick baseline: average weekly spend over the last `weeks` full weeks the data covers."""
    # Full Monday-Sunday weeks only, and never before the first transaction Plaid returned.
    week_end = last - timedelta(days=(last.weekday() + 1) % 7)
    first_monday = first + timedelta(days=(7 - first.weekday()) % 7)
    weeks = min(weeks, (week_end - first_monday).days // 7 + 1)
    if weeks < 1:
        print("Less than one full week of history, so no baseline yet.")
        return
    week_start = week_end - timedelta(weeks=weeks) + timedelta(days=1)
    recent = [r for r in rows if week_start <= date.fromisoformat(r["date"]) <= week_end]

    by_kind = defaultdict(float)
    for r in recent:
        by_kind[r["kind"]] += r["amount"]
    total = sum(v for k, v in by_kind.items() if k != "membership")
    print(f"\nBaseline, {week_start} to {week_end} ({weeks} weeks):")
    print(f"  Food + getting around per week: ${total / weeks:,.2f}")
    for kind in ("dining", "quick_food", "delivery", "groceries", "ride", "transit"):
        print(f"    {kind:11} ${by_kind[kind] / weeks:8,.2f}")
    if by_kind["membership"]:
        print(f"  Plus memberships (DashPass etc.): ${by_kind['membership']:,.2f} over these weeks")
    top = Counter()
    for r in recent:
        if r["kind"] != "membership":
            top[r["merchant"]] += r["amount"]
    for merchant, amount in top.most_common(3):
        print(f"  {merchant}: ${amount:,.2f}")


# --- Commands -----------------------------------------------------------------

def link_token_request(person):
    return {
        "user": {"client_user_id": person},
        "client_name": "Swap pilot",
        "products": ["transactions"],
        "transactions": {"days_requested": DAYS_REQUESTED},
        "country_codes": ["US"],
        "language": "en",
    }


LINK_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Swap pilot: link your card</title>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script></head>
<body style="font-family:system-ui;max-width:480px;margin:60px auto;line-height:1.5">
<h2>Swap pilot</h2>
<p>Link the one card you use for food delivery and rides. Only delivery and ride charges are kept.
Everything else is dropped and never saved.</p>
<button id="go" style="font-size:18px;padding:10px 18px">Link my card</button>
<p id="status"></p>
<script>
const handler = Plaid.create({
  token: "%s",
  onSuccess: (public_token) => {
    document.getElementById("status").textContent = "Linked. You can close this tab.";
    fetch("/exchange", {method: "POST", body: public_token});
  },
  onExit: (err) => {
    document.getElementById("status").textContent = err ? "Error: " + err.display_message : "Cancelled.";
    fetch("/exchange", {method: "POST", body: ""});
  },
});
document.getElementById("go").onclick = () => handler.open();
</script></body></html>"""


def cmd_link(person):
    """Serve a one-page Plaid Link site on localhost and wait for the friend to link."""
    if person in load_tokens():
        sys.exit(f"{person} is already linked. Use `pull` instead (re-linking burns a Trial slot).")
    link_token = plaid("/link/token/create", link_token_request(person))["link_token"]
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write((LINK_PAGE % link_token).encode())

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            result["public_token"] = self.rfile.read(length).decode()
            self.send_response(204)
            self.end_headers()
            threading.Thread(target=server.shutdown).start()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", LINK_PORT), Handler)
    url = f"http://localhost:{LINK_PORT}"
    print(f"Opening {url} ... (Ctrl+C to cancel)")
    webbrowser.open(url)
    server.serve_forever()

    if not result.get("public_token"):
        sys.exit("Link was cancelled. Nothing saved.")
    exchange = plaid("/item/public_token/exchange", {"public_token": result["public_token"]})
    save_token(person, exchange["access_token"], exchange["item_id"])
    pull_and_save(person, exchange["access_token"])


def cmd_sandbox(person):
    """Link a fake Sandbox bank without a browser, to test the whole flow."""
    if os.environ["PLAID_ENV"] != "sandbox":
        sys.exit("`sandbox` only works with PLAID_ENV=sandbox.")
    public_token = plaid("/sandbox/public_token/create", {
        "institution_id": "ins_109508",  # Plaid's fake "First Platypus Bank"
        "initial_products": ["transactions"],
        "options": {"transactions": {"days_requested": DAYS_REQUESTED}},
    })["public_token"]
    exchange = plaid("/item/public_token/exchange", {"public_token": public_token})
    save_token(person, exchange["access_token"], exchange["item_id"])
    pull_and_save(person, exchange["access_token"])


INVITES_FILE = os.path.join(DATA_DIR, "invites.json")
INVITE_LIFETIME_SECONDS = 48 * 3600


def cmd_invite(person):
    """Remote linking: make a Plaid-hosted link page the friend opens on their own device."""
    if person in load_tokens():
        sys.exit(f"{person} is already linked. Use `pull` instead (re-linking burns a Trial slot).")
    request = dict(link_token_request(person), hosted_link={"url_lifetime_seconds": INVITE_LIFETIME_SECONDS})
    response = plaid("/link/token/create", request)
    invites = _load_json(INVITES_FILE)
    invites[person] = {"link_token": response["link_token"], "env": os.environ["PLAID_ENV"],
                       "created": datetime.now().isoformat(timespec="seconds")}
    _save_json(INVITES_FILE, invites)
    print(f"Text this to {person} (works for 48 hours, one card only):\n\n  {response['hosted_link_url']}\n")
    print(f"When they say they're done, run: python3 pull.py collect --person {person}")


def _find_public_token(value):
    """/link/token/get nests the public token inside the session results; find it wherever it is."""
    if isinstance(value, dict):
        if isinstance(value.get("public_token"), str):
            return value["public_token"]
        value = list(value.values())
    if isinstance(value, list):
        for item in value:
            found = _find_public_token(item)
            if found:
                return found
    return None


def cmd_collect(person):
    """After a friend finishes the hosted link page, swap it for a saved link and pull."""
    invite = _load_json(INVITES_FILE).get(person)
    if not invite:
        sys.exit(f"No invite for {person}. Run `invite` first.")
    if person in load_tokens():
        sys.exit(f"{person} is already collected. Use `pull` instead.")
    session = plaid("/link/token/get", {"link_token": invite["link_token"]})
    public_token = _find_public_token(session.get("link_sessions") or [])
    if not public_token:
        sys.exit(f"{person} hasn't finished linking yet (or exited). Try again after they say they're done.")
    exchange = plaid("/item/public_token/exchange", {"public_token": public_token})
    save_token(person, exchange["access_token"], exchange["item_id"])
    pull_and_save(person, exchange["access_token"])


def _load_json(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def _save_json(path, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(path, 0o600)


def saved_token(person):
    tokens = load_tokens()
    if person not in tokens:
        sys.exit(f"No saved link for {person}. Run `link` first.")
    if tokens[person]["env"] != os.environ["PLAID_ENV"]:
        sys.exit(f"{person} was linked in {tokens[person]['env']}, but PLAID_ENV is {os.environ['PLAID_ENV']}.")
    return tokens[person]["access_token"]


def cmd_pull(person):
    pull_and_save(person, saved_token(person))


def cmd_remove(person):
    plaid("/item/remove", {"access_token": saved_token(person)})
    tokens = load_tokens()
    del tokens[person]
    with open(TOKENS_FILE, "w") as f:
        json.dump(tokens, f, indent=2)
    print(f"Disconnected {person}'s bank link. Delete data/{person}.csv when you're done with the write-up.")


def main():
    parser = argparse.ArgumentParser(description="One-off Plaid pull for the Swap pilot.")
    parser.add_argument("command", choices=["link", "invite", "collect", "sandbox", "pull", "remove"])
    parser.add_argument("--person", required=True, help="pseudonymous ID like p01 (never a real name)")
    args = parser.parse_args()
    load_env()
    commands = {"link": cmd_link, "invite": cmd_invite, "collect": cmd_collect,
                "sandbox": cmd_sandbox, "pull": cmd_pull, "remove": cmd_remove}
    commands[args.command](args.person)


if __name__ == "__main__":
    main()
