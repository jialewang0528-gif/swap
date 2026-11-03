"""Sync the founder's real data into the app.

Pulls the linked card from Plaid (the same saved link pull.py uses), and writes
app/private/live.js, which the app loads before data.js. The "You" profile then shows
real charges, real weekly history and real usual numbers instead of sample data.

app/private/ is gitignored: this file only ships inside the founder's own phone build.

  python3 sync.py                # uses person p00
  python3 sync.py --person p00
"""

import argparse
import json
import os
import re
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta

import ledger
import pull

OUT = os.path.join(pull.HERE, "app", "private", "live.js")
TRAVEL_RIDE = 60          # rides over $60 are airport/out-of-town trips, not getting around town
FOOD = ("dining", "drinks", "quick", "delivery")
MOVE = ("ride", "transit")
CHAINS = ["Chipotle", "Raising Cane's", "Panda Express", "McDonald's", "Chick-fil-A", "Popeyes",
          "Domino's", "Wingstop", "Shake Shack", "Sweetgreen", "Cava", "Starbucks"]


LOGO_DIR = os.path.join(pull.HERE, "app", "private", "logos")
RIDEAPP_ICON = "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/43/c0/18/43c01862-6589-0a4a-d475-6dcd7b79cd0b/AppIconPassenger-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg"


def slugify(name):
    return "".join(ch for ch in name.lower() if ch.isalnum())[:40] or "x"


def fetch_logo(url, slug):
    """Download a logo once into app/private/logos as a 192px PNG. Returns the app-relative path or None."""
    import subprocess, urllib.request
    path = os.path.join(LOGO_DIR, slug + ".png")
    if os.path.exists(path):
        return "private/logos/" + slug + ".png"
    os.makedirs(LOGO_DIR, exist_ok=True)
    tmp = path + ".src"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r, open(tmp, "wb") as f:
            f.write(r.read())
        subprocess.run(["sips", "-s", "format", "png", "-Z", "192", tmp, "--out", path], capture_output=True)
        os.remove(tmp)
        # skip tiny or failed images (a 16px favicon looks worse than a letter-mark)
        out = subprocess.run(["sips", "-g", "pixelWidth", path], capture_output=True, text=True).stdout.split()
        if not os.path.exists(path) or (out and int(out[-1]) < 48):
            if os.path.exists(path):
                os.remove(path)
            return None
        return "private/logos/" + slug + ".png"
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        return None


def merchant_logos(txns, names):
    """Logo per displayed merchant: Plaid's logo, else the merchant website's icon. Lower-fare app gets its app icon."""
    sources = {}
    for t in txns:
        cands = [(t.get("merchant_name"), t.get("logo_url"), t.get("website"))]
        cands += [(c.get("name"), c.get("logo_url"), c.get("website")) for c in t.get("counterparties") or [] if c.get("type") != "payment_terminal"]
        for name, logo, site in cands:
            if name and (logo or site) and name not in sources:
                sources[name] = (logo, site)
    logos = {}
    for name in names:
        if name in ("Lower-fare app", "Lower-fare app"):
            got = fetch_logo(RIDEAPP_ICON, "rideapp")
            if got:
                logos[name] = got
            continue
        base = name.split(" · ")[-1]
        logo, site = sources.get(name) or sources.get(base) or (None, None)
        got = None
        if logo:
            got = fetch_logo(logo, slugify(base))
        if not got and site:
            got = fetch_logo(f"https://www.google.com/s2/favicons?domain={site}&sz=128", slugify(base) + "-site")
        if got:
            logos[name] = got
            logos[base] = got
    return logos


# Whole-bank labels for everything outside food and getting around, by Plaid's top category.
BANK_LABELS = [
    ("GENERAL_MERCHANDISE", "Shopping"), ("ENTERTAINMENT", "Fun"),
    ("PERSONAL_CARE", "Personal care"), ("RENT_AND_UTILITIES", "Phone & bills"), ("MEDICAL", "Health"),
    ("TRAVEL", "Travel"), ("TRANSPORTATION", "Travel"), ("GENERAL_SERVICES", "Services"),
    ("GOVERNMENT_AND_NON_PROFIT", "Services"), ("HOME_IMPROVEMENT", "Shopping"), ("BANK_FEES", "Bank fees"),
    ("TRANSFER_OUT_WITHDRAWAL", "ATM cash"), ("LOAN_PAYMENTS", "Loan payments"), ("FOOD_AND_DRINK_GROCERIES", "Groceries"),
]
SUBSCRIPTION_PATTERN = re.compile(r"apple\.com/bill|anthropic|claude\.ai|hulu|netflix|spotify|linkedin|crunchyroll|youtube|chatgpt|openai", re.IGNORECASE)
SWAP_LABELS = {"dining": "Eating out", "drinks": "Bodega & liquor", "quick": "Coffee & snacks",
               "delivery": "Delivery", "ride": "Rides", "transit": "Subway"}


def is_night_out(t):
    """A club or bar tab, not a bodega or liquor store run."""
    text = " ".join([t.get("name") or "", t.get("merchant_name") or ""])
    pfc = (t.get("personal_finance_category") or {}).get("detailed") or ""
    if pull.is_club(text):
        return True
    return "BEER_WINE_AND_LIQUOR" in pfc and not re.search(r"wine|liquor|spirits|bodega|deli|mart", text, re.I)


def bank_name(t, kind):
    raw = t.get("name") or ""
    m = re.match(r"\s*(?:pos debit |pos credit )?zelle payment (to|from) (\S+)", raw, re.IGNORECASE)
    if m:
        return f"Zelle {m.group(1).lower()} {m.group(2).title()}"
    if re.match(r"\s*venmo", raw, re.IGNORECASE):
        return "Venmo"
    if kind or pull.CHEAP_RIDE_APP_PATTERN.search(raw):
        return display_merchant(t, kind or "ride")
    if t.get("merchant_name"):
        return t["merchant_name"]
    raw = re.sub(r"^\s*POS (DEBIT|CREDIT)\s+", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s+(\d{2}/\d{2}|PPD ID:.*|\d{6,}.*)$", "", raw)
    return raw.title()[:32]


def bank_label(t, section, kind):
    """One category per transaction for the whole-bank view."""
    c = (t.get("personal_finance_category") or {}).get("detailed") or ""
    out = t["amount"] > 0
    if kind == "drinks" and is_night_out(t):
        return "Clubs & bars"
    if kind:
        return "Travel" if kind == "ride" and t["amount"] > TRAVEL_RIDE else SWAP_LABELS[kind]
    if section == "friends":
        return "Sent to friends" if out else "From friends"
    if re.search(r"bkrg|brokerage", t.get("name") or "", re.IGNORECASE):
        return "Investing" if out else "From investing"
    if section == "investing":
        return "Investing"
    if section == "in":
        if c.startswith("INCOME_SALARY") or c.startswith("INCOME_WAGES"):
            return "Paychecks"
        if "support" in ledger.bucket(t)[1].lower():
            return "From family"
        if c.startswith("TRANSFER_IN_TRANSFER_IN_FROM_APPS"):
            return "From friends"
        return "Other money in"
    if "prediction" in ledger.bucket(t)[1].lower():
        return "Prediction markets"
    if c.startswith("TRANSFER_OUT"):
        return "Venmo & other transfers" if out else "Other money in"
    if not out:
        return "Refunds"
    if SUBSCRIPTION_PATTERN.search(" ".join([t.get("name") or "", t.get("merchant_name") or ""])):
        return "Subscriptions"
    for prefix, label in BANK_LABELS:
        if c.startswith(prefix):
            return label
    return "Other"


def whole_bank(txns, kinds, cancelled, last_week, this_monday, accounts):
    """Every dollar in and out (minus moves between his own accounts), for the recap week, the
    week so far, and weekly totals going back 12 weeks. Positive amount = money out."""
    first_wk = last_week - timedelta(weeks=11)
    weeks = defaultdict(lambda: {"out": 0.0, "in": 0.0, "invest": 0.0})
    items = []
    # Analysis over the last 10 full weeks, all money: where it goes, by category and by place.
    an_start, an_weeks = last_week - timedelta(weeks=9), 10
    cats = defaultdict(lambda: [0.0, 0])
    ins = defaultdict(float)
    places = defaultdict(lambda: [0.0, 0, ""])
    an_out = an_in = 0.0
    # The daily plan's shape for ALL spending: out by weekday over the last 8 full weeks.
    shape_start = last_week - timedelta(weeks=7)
    weekday = [0.0] * 7
    for t in txns.values():
        if not t["amount"] or t["transaction_id"] in cancelled:
            continue
        raw = t.get("name") or ""
        if t["amount"] < 0 and pull.CHEAP_RIDE_APP_PATTERN.search(raw):
            continue                      # a released ride hold; its hold was dropped above
        section, _ = ledger.bucket(t)
        if section == "internal":
            continue
        d = date.fromisoformat(t.get("authorized_date") or t["date"])
        wk = week_start(d)
        kind = kinds.get(t["transaction_id"])
        label = bank_label(t, section, kind)
        if an_start <= wk <= last_week:
            if t["amount"] > 0 and section != "investing":
                cats[label][0] += t["amount"]; cats[label][1] += 1
                p = places[bank_name(t, kind)]; p[0] += t["amount"]; p[1] += 1; p[2] = label
                an_out += t["amount"]
            elif t["amount"] < 0 and section != "investing":
                an_in -= t["amount"]
                ins[label] -= t["amount"]
        if shape_start <= wk <= last_week and t["amount"] > 0 and section != "investing":
            weekday[d.weekday()] += t["amount"]
        if wk >= first_wk:
            w = weeks[wk]
            if section == "investing":
                w["invest"] += t["amount"]
            elif t["amount"] > 0:
                w["out"] += t["amount"]
            else:
                w["in"] += -t["amount"]
        if wk >= last_week:
            when = t.get("authorized_datetime") or t.get("datetime")
            hhmm = datetime.fromisoformat(when.replace("Z", "+00:00")).astimezone(pull.NYC).strftime("%H:%M") if when else None
            items.append({"id": t["transaction_id"], "week": "last" if wk == last_week else "now",
                          "day": (d - wk).days, "time": hhmm, "name": bank_name(t, kind), "amount": round(t["amount"], 2),
                          "cat": label, "swap": bool(kind), "pending": bool(t.get("pending"))})
    items.sort(key=lambda i: (i["week"] != "last", i["day"], i["time"] or "", -i["amount"]))
    series = []
    wk = first_wk
    while wk <= this_monday:
        w = weeks.get(wk, {"out": 0, "in": 0, "invest": 0})
        series.append({"wk": wk.isoformat(), "out": round(w["out"]), "in": round(w["in"]), "invest": round(w["invest"])})
        wk += timedelta(days=7)
    balances = [{"name": a.get("official_name") or a["name"], "mask": a.get("mask"), "type": a.get("type"),
                 "current": (a.get("balances") or {}).get("current"), "available": (a.get("balances") or {}).get("available")}
                for a in accounts]
    usual8 = [w["out"] for w in series if shape_start.isoformat() <= w["wk"] <= last_week.isoformat()]
    analysis = {
        "weeks": an_weeks, "from": an_start.isoformat(), "to": (last_week + timedelta(days=6)).isoformat(),
        "outPerWeek": round(an_out / an_weeks), "inPerWeek": round(an_in / an_weeks),
        "cats": sorted(({"cat": c, "perWeek": round(v[0] / an_weeks), "total": round(v[0]), "count": v[1]} for c, v in cats.items()),
                       key=lambda x: -x["total"]),
        "ins": sorted(({"cat": c, "perWeek": round(v / an_weeks), "total": round(v)} for c, v in ins.items()), key=lambda x: -x["total"]),
        "places": sorted(({"name": n, "cat": v[2], "total": round(v[0]), "count": v[1]} for n, v in places.items()),
                         key=lambda x: -x["total"])[:15],
    }
    return {"items": items, "weekly": series, "balances": balances, "analysis": analysis,
            "usualOut": round(sum(usual8) / len(usual8)) if usual8 else 0,
            "dayWeights": [round(x / sum(weekday), 4) for x in weekday] if sum(weekday) else [round(1 / 7, 4)] * 7}


def week_start(d):
    return d - timedelta(days=d.weekday())


def display_merchant(t, kind):
    """Merchant name for the app. The lower-fare ride app is never named."""
    raw = (t.get("name") or "")
    if pull.CHEAP_RIDE_APP_PATTERN.search(raw):
        return "Lower-fare app"
    name = t.get("merchant_name") or raw[:28]
    if kind == "delivery":
        market = next((c.get("name") for c in t.get("counterparties") or [] if c.get("type") == "marketplace"), None)
        if market and market.lower() not in (name or "").lower():
            return f"{market} · {name}"
    return name


def app_kind(kind):
    return "quick" if kind == "quick_food" else kind


def swap_options(rows, txns, last_week, this_monday, gaps, ride_name):
    """Swaps built only from his own charges over the last 10 full weeks. Each has the saving per
    time ("save", in "unit"s) and how often he does that thing now ("perWeek"), so the app can
    work out how many swaps reach a weekly savings goal. Night rides are never a target."""
    start, n = last_week - timedelta(weeks=9), 10
    rs = [r for r in rows if start <= r["date"] < this_monday]
    def of(pred):
        return [r["amount"] for r in rs if pred(r)]
    raw = lambda r: (r["raw"].get("name") or "") + " " + (r["raw"].get("merchant_name") or "")
    pfc = lambda r: ((r["raw"].get("personal_finance_category") or {}).get("detailed") or "")
    out = []

    def add(id, title, detail, save, unit, kind, cat, per_week, basis):
        if save >= 4 and per_week >= 0.2:
            out.append({"id": id, "title": title, "detail": detail, "save": round(save), "unit": unit, "kind": kind,
                        "cat": cat, "perWeek": round(per_week, 1), "basis": basis, "real": True})

    rides = of(lambda r: r["kind"] == "ride")
    if rides:
        m = statistics.median(rides)
        add("subway-day", "Subway instead of a daytime ride", "Daytime only. Night rides stay as they are.",
            m - 3, "ride", "move", "Rides", len(rides) / n, f"Your {ride_name} median ${m:.0f} vs a $3 fare. {len(rides) / n:.0f} rides a week now")
    dine = of(lambda r: r["kind"] == "dining")
    fast = of(lambda r: r["kind"] == "quick" and "FAST_FOOD" in pfc(r))
    if dine and fast:
        a, b = statistics.median(dine), statistics.median(fast)
        add("counter-meal", "Counter meal instead of sit-down", "Same night out, cheaper spot.", a - b, "meal", "food",
            "Eating out", len(dine) / n, f"Your sit-down median ${a:.0f} vs counter ${b:.0f}. {len(dine) / n:.1f} sit-downs a week")
    bar = of(lambda r: r["kind"] == "drinks" and is_night_out(r["raw"]))
    if bar:
        add("bar-night", "One fewer club or bar night", "Keep the rest of the week as is.", statistics.mean(bar), "night", "food",
            "Clubs & bars", len(bar) / n, f"Your club and bar tabs average ${statistics.mean(bar):.0f}. {len(bar) / n:.1f} a week")
    bodega = of(lambda r: r["kind"] == "drinks" and not is_night_out(r["raw"]))
    if bodega:
        m = statistics.median(bodega)
        add("bodega", "One fewer bodega run", "Buy for two nights at once.", m, "run", "food", "Bodega & liquor",
            len(bodega) / n, f"Your bodega median ${m:.0f}. {len(bodega) / n:.1f} runs a week")
    snack = of(lambda r: r["kind"] == "quick" and "FAST_FOOD" not in pfc(r))
    if snack:
        m = statistics.median(snack)
        add("coffee", "Skip one café or snack run", "Keep the ones you like most.", m, "run", "food", "Coffee & snacks",
            len(snack) / n, f"Your café and snack median ${m:.0f}. {len(snack) / n:.1f} a week")
    dl = of(lambda r: r["kind"] == "delivery")
    if dl and gaps:
        gap = statistics.mean(g["delivered"] - g["pickup"] for g in gaps)
        add("pickup", "Pick up instead of delivery", "Same food. No delivery markup.", gap, "order", "food", "Delivery",
            len(dl) / n, f"{gaps[0]['place']}: delivered ${gaps[0]['delivered']} vs pickup ${gaps[0]['pickup']}")
    out.sort(key=lambda x: -x["save"] * x["perWeek"])
    return out


def build_live(token, logos=True):
    """Everything the app shows, from one Plaid link. Runs on the Mac (sync.py) and in the private
    cloud function (swap-cloud), which skips logo downloads and keeps the phone's bundled logos."""
    # Posted + pending, so the latest days are included.
    txns, cursor = {}, ""
    while True:
        page = pull.plaid("/transactions/sync", {"access_token": token, "cursor": cursor, "count": 500})
        for t in page["added"] + page["modified"]:
            txns[t["transaction_id"]] = t
        for t in page["removed"]:
            txns.pop(t["transaction_id"], None)
        cursor = page["next_cursor"]
        if not page["has_more"]:
            break

    # Merchants he asked never to show (HIDE_MERCHANTS in .env): dropped before anything else.
    hide = [h.strip().lower() for h in os.environ.get("HIDE_MERCHANTS", "").split(",") if h.strip()]
    if hide:
        txns = {i: t for i, t in txns.items()
                if not any(h in " ".join([t.get("name") or "", t.get("merchant_name") or ""]).lower() for h in hide)}

    # A released ride hold shows up as a credit for the same amount on the same day; drop the
    # matching hold so a cancelled ride doesn't count.
    released, cancelled = defaultdict(int), set()
    for t in txns.values():
        if t["amount"] < 0 and pull.CHEAP_RIDE_APP_PATTERN.search(t.get("name") or ""):
            released[(t.get("authorized_date") or t["date"], round(-t["amount"], 2))] += 1

    # Pending charges come with a cut-off name ("POS DEBIT MAIN ST. W"). Borrow the kind of
    # a posted charge whose full name starts the same way ("MAIN ST. WINE").
    posted_kinds, posted_names = {}, {}
    for t in txns.values():
        k = pull.classify(t) if not t.get("pending") else None
        if k:
            posted_kinds.setdefault((t.get("name") or "").upper(), k)
            if t.get("merchant_name"):
                posted_names.setdefault((t.get("name") or "").upper(), t["merchant_name"])

    def short_name(t):
        return re.sub(r"^POS (DEBIT|CREDIT)\s+", "", (t.get("name") or "").upper()).strip()

    def kind_of(t):
        k = pull.classify(t)
        if k or not t.get("pending"):
            return k
        short = short_name(t)
        if len(short) >= 12:
            return next((pk for name, pk in posted_kinds.items() if name.startswith(short)), None)
        return None

    rows = []
    for t in txns.values():
        kind = kind_of(t)
        if kind not in ("dining", "drinks", "quick_food", "delivery", "ride", "transit") or t["amount"] <= 0:
            continue
        key = (t.get("authorized_date") or t["date"], round(t["amount"], 2))
        if kind == "ride" and released[key]:
            released[key] -= 1
            cancelled.add(t["transaction_id"])
            continue
        kind = app_kind(kind)
        if kind == "ride" and t["amount"] > TRAVEL_RIDE:
            continue
        d = date.fromisoformat(t.get("authorized_date") or t["date"])
        when = t.get("authorized_datetime") or t.get("datetime")
        hhmm = datetime.fromisoformat(when.replace("Z", "+00:00")).astimezone(pull.NYC).strftime("%H:%M") if when else None
        merchant = display_merchant(t, kind)
        if merchant.upper().startswith("POS "):
            short = short_name(t)
            merchant = next((m for name, m in posted_names.items() if len(short) >= 12 and name.startswith(short)), short.title())
        rows.append({"date": d, "time": hhmm, "kind": kind, "amount": round(t["amount"], 2),
                     "merchant": merchant, "id": t["transaction_id"], "pending": bool(t.get("pending")),
                     "raw": t})

    today = datetime.now(pull.NYC).date()   # NYC, also when run in a UTC cloud
    this_monday = week_start(today)
    last_week = this_monday - timedelta(days=7)        # the last full Mon-Sun week (the Sunday recap week)

    # Weekly history, Mon-start, up to and including the last full week.
    ZERO = {"ride": 0, "delivery": 0, "dining": 0, "drinks": 0, "quick": 0, "transit": 0}
    weekly = defaultdict(lambda: dict(ZERO))
    for r in rows:
        wk = week_start(r["date"])
        if wk <= last_week:
            weekly[wk][r["kind"]] += r["amount"]
    first = min(weekly) if weekly else last_week
    series, wk = [], first
    while wk <= last_week:
        w = weekly.get(wk, ZERO)
        series.append({"wk": wk.isoformat(), **{k: round(v) for k, v in w.items()}})
        wk += timedelta(days=7)

    # Usual = mean of the 6 weeks before the recap week.
    prev6 = series[-7:-1] or series[-6:]
    usual_food = round(sum(sum(r[k] for k in FOOD) for r in prev6) / len(prev6))
    usual_move = round(sum(sum(r[k] for k in MOVE) for r in prev6) / len(prev6))

    # The recap week's charges.
    week_rows = sorted((r for r in rows if last_week <= r["date"] < this_monday), key=lambda r: (r["date"], r["time"] or ""))
    charges = [{"id": r["id"], "day": (r["date"] - last_week).days, "time": r["time"], "merchant": r["merchant"],
                "amount": r["amount"], "kind": r["kind"], "tag": None, "pending": r["pending"]} for r in week_rows]
    # This week so far (Mon to today), same shape, for the daily plan and the chat.
    cur_rows = sorted((r for r in rows if r["date"] >= this_monday), key=lambda r: (r["date"], r["time"] or ""))
    current = [{"id": r["id"], "day": (r["date"] - this_monday).days, "time": r["time"], "merchant": r["merchant"],
                "amount": r["amount"], "kind": r["kind"], "tag": None, "pending": r["pending"]} for r in cur_rows]
    # His usual spend by weekday (food + getting around), last 8 full weeks: the daily plan's shape.
    wd = [0.0] * 7
    for r in rows:
        if last_week - timedelta(weeks=7) <= r["date"] < this_monday:
            wd[r["date"].weekday()] += r["amount"]
    day_weights = [round(x / sum(wd), 4) for x in wd] if sum(wd) else [round(1 / 7, 4)] * 7
    week_food = round(sum(c["amount"] for c in charges if c["kind"] in FOOD), 2)
    week_move = round(sum(c["amount"] for c in charges if c["kind"] in MOVE), 2)

    # Ride prices since the move, by app.
    move_date = date(2026, 8, 20)
    by_app = defaultdict(list)
    for r in rows:
        if r["kind"] == "ride" and r["date"] >= move_date:
            by_app[r["merchant"]].append(r["amount"])
    ride_prices = sorted(({"app": a, "median": round(statistics.median(v), 2), "count": len(v)} for a, v in by_app.items() if len(v) >= 2),
                         key=lambda x: x["median"])

    # Same chain, in person vs delivered (median tickets).
    gaps = []
    for chain in CHAINS:
        key = chain.lower()
        inp = [t["amount"] for t in txns.values() if t["amount"] > 0 and key in (t.get("merchant_name") or "").lower() and pull.classify(t) in ("dining", "drinks", "quick_food")]
        dl = [t["amount"] for t in txns.values() if t["amount"] > 0 and key in (t.get("merchant_name") or "").lower() and pull.classify(t) == "delivery"]
        if inp and dl:
            gaps.append({"place": chain, "pickup": round(statistics.median(inp)), "delivered": round(statistics.median(dl)), "n": len(inp) + len(dl)})
    gaps.sort(key=lambda g: -(g["delivered"] - g["pickup"]))

    # Subway, last 6 weeks.
    transit6 = sum(r["transit"] for r in prev6) / len(prev6)
    weeks_since_move = [r for r in series if r["wk"] >= move_date.isoformat()]
    after_avg = round(sum(r["ride"] for r in weeks_since_move) / max(1, len(weeks_since_move)))
    deliveries_per_week = sum(1 for r in rows if r["kind"] == "delivery" and r["date"] >= move_date) / max(1, len(weeks_since_move))

    live = {
        "generatedAt": datetime.now(pull.NYC).replace(tzinfo=None).isoformat(timespec="minutes"),
        "today": today.isoformat(),
        "weekStart": last_week.isoformat(),
        "weekLabel": f"{last_week.strftime('%b')} {last_week.day} – {(last_week + timedelta(days=6)).strftime('%b')} {(last_week + timedelta(days=6)).day}",
        "usual": {"food": usual_food, "move": usual_move, "total": usual_food + usual_move},
        "thisWeek": {"food": week_food, "move": week_move, "total": round(week_food + week_move, 2)},
        "weekly": series,
        "charges": charges,
        "current": {"weekStart": this_monday.isoformat(), "charges": current,
                    "food": round(sum(c["amount"] for c in current if c["kind"] in FOOD), 2),
                    "move": round(sum(c["amount"] for c in current if c["kind"] in MOVE), 2)},
        "dayWeights": day_weights,
        "ridePrices": ride_prices[:3],
        "priceGaps": gaps[:3],
        "subway": {"fare": 3, "weeklyCap": 35, "tapsPerWeek": round(transit6 / 3, 1), "perWeek": round(transit6)},
        "move": {"date": move_date.isoformat(), "rideSpendAfter": after_avg},
        "deliveriesPerWeek": round(deliveries_per_week, 1),
        # Off by default. In your own .env: RIDE_APP_NAME shows the lower-fare ride app by name,
        # RECOMMEND_RIDE_APP=1 lets the app suggest it over Uber/Lyft (your call, not the default).
        "rideAppName": os.environ.get("RIDE_APP_NAME") or None,
        "recommendRideApp": os.environ.get("RECOMMEND_RIDE_APP") == "1",
    }
    # Logos for every merchant the app shows (this week's charges, top places, ride apps).
    shown = {c["merchant"] for c in charges} | {r["app"] for r in ride_prices} | {g["place"] for g in gaps}
    top = defaultdict(float)
    for r in rows:
        if r["date"] >= move_date:
            top[r["merchant"]] += r["amount"]
    shown |= {m for m, _ in sorted(top.items(), key=lambda kv: -kv[1])[:30]}
    live["swapOptions"] = swap_options(rows, txns, last_week, this_monday, gaps, live["rideAppName"] or "ride app")
    live["logos"] = merchant_logos(list(txns.values()), sorted(shown)) if logos else {}

    # Whole bank (private build only): every dollar in and out, not just food and getting around.
    kinds = {r["id"]: r["kind"] for r in rows}
    accounts = pull.plaid("/accounts/get", {"access_token": token})["accounts"]
    live["bank"] = whole_bank(txns, kinds, cancelled, last_week, this_monday, accounts)
    # When Plaid last checked the bank (it does this 1-4 times a day on its own), in NYC time.
    try:
        st = (pull.plaid("/item/get", {"access_token": token}).get("status") or {}).get("transactions") or {}
        when = st.get("last_successful_update")
        live["bankCheckedAt"] = datetime.fromisoformat(when.replace("Z", "+00:00")).astimezone(pull.NYC).replace(tzinfo=None).isoformat(timespec="minutes") if when else None
    except SystemExit:
        live["bankCheckedAt"] = None
    return live


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--person", default="p00")
    args = parser.parse_args()
    pull.load_env()
    live = build_live(pull.saved_token(args.person))
    charges, series = live["charges"], live["weekly"]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("/* PRIVATE: generated by sync.py from the founder's Plaid data. Gitignored; only ships in his phone build. */\n")
        f.write("window.SwapLive = " + json.dumps(live, indent=1) + ";\n")
    print(f"Wrote {os.path.relpath(OUT, pull.HERE)}: week {live['weekLabel']} ${live['thisWeek']['total']:.0f} "
          f"({len(charges)} charges), usual ${live['usual']['total']}, {len(series)} weeks of history")


if __name__ == "__main__":
    main()
