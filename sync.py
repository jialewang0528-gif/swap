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
# Bills and other fixed costs: shown as their own line, never part of the daily plan.
FIXED_CATS = ("Subscriptions", "Phone & bills", "Rent", "Loan payments", "Bank fees")
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def stable_id(t):
    """One id per charge from pending to posted: a posted charge points back at its pending
    record through pending_transaction_id, so it keeps the pending id."""
    return t.get("pending_transaction_id") or t["transaction_id"]


def is_ride_hold(t):
    """A pending charge from the lower-fare ride app: an estimate, not the final fare."""
    return bool(t.get("pending")) and t.get("amount", 0) > 0 and bool(pull.CHEAP_RIDE_APP_PATTERN.search(t.get("name") or ""))


def slugify(name):
    return "".join(ch for ch in name.lower() if ch.isalnum())[:40] or "x"


def fetch_logo(url, slug):
    """Download a logo once into app/private/logos as a 192px PNG. Returns the app-relative path or None."""
    import subprocess, urllib.request
    path = os.path.join(LOGO_DIR, slug + ".png")
    if os.path.exists(path):
        return "private/logos/" + slug + ".png"
    if not url:
        return None
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
    """Logo per displayed merchant: Plaid's logo, else the merchant website's icon. The lower-fare
    ride app gets its app icon (RIDE_APP_ICON in .env, or a logo already saved under its name)."""
    sources = {}
    for t in txns:
        cands = [(t.get("merchant_name"), t.get("logo_url"), t.get("website"))]
        cands += [(c.get("name"), c.get("logo_url"), c.get("website")) for c in t.get("counterparties") or [] if c.get("type") != "payment_terminal"]
        for name, logo, site in cands:
            if name and (logo or site) and name not in sources:
                sources[name] = (logo, site)
    logos = {}
    ride_app = os.environ.get("RIDE_APP_NAME") or ""
    for name in names:
        if name == "Lower-fare app" or (ride_app and name == ride_app):
            got = fetch_logo(os.environ.get("RIDE_APP_ICON"), slugify(ride_app or "rideapp"))
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
    ("PERSONAL_CARE", "Personal care"), ("RENT_AND_UTILITIES_RENT", "Rent"), ("RENT_AND_UTILITIES", "Phone & bills"),
    ("MEDICAL", "Health"),
    ("TRAVEL", "Travel"), ("TRANSPORTATION", "Travel"), ("GENERAL_SERVICES", "Services"),
    ("GOVERNMENT_AND_NON_PROFIT", "Services"), ("HOME_IMPROVEMENT", "Shopping"), ("BANK_FEES", "Bank fees"),
    ("TRANSFER_OUT_WITHDRAWAL", "ATM cash"), ("LOAN_PAYMENTS", "Loan payments"), ("FOOD_AND_DRINK_GROCERIES", "Groceries"),
]
SUBSCRIPTION_PATTERN = re.compile(r"apple\.com/bill|anthropic|claude\.ai|hulu|netflix|spotify|linkedin|crunchyroll|youtube|chatgpt|openai", re.IGNORECASE)
# Sports and games Plaid files as personal care or services.
FUN_PATTERN = re.compile(r"climbing|boulder|golf|bowling|karaoke|billiards", re.IGNORECASE)
SWAP_LABELS = {"dining": "Eating out", "drinks": "Bodega & liquor", "quick": "Coffee & snacks",
               "delivery": "Delivery", "ride": "Rides", "transit": "Subway"}


def is_night_out(t):
    """A club or bar tab, not a bodega or liquor store run."""
    text = " ".join([t.get("name") or "", t.get("merchant_name") or ""])
    pfc = (t.get("personal_finance_category") or {}).get("detailed") or ""
    if pull.is_club(text):
        return True
    return "BEER_WINE_AND_LIQUOR" in pfc and not re.search(r"wine|liquor|spirits|bodega|deli|mart", text, re.I)


def category_overrides():
    """Merchants Plaid files under the wrong category, fixed in your own .env (kept out of git):
    CATEGORY_OVERRIDES=match=Label;other match=Label=Clean name
    "match" is any part of the bank text (case doesn't matter); the optional third part renames it."""
    out = []
    for part in os.environ.get("CATEGORY_OVERRIDES", "").split(";"):
        bits = [b.strip() for b in part.split("=")]
        if len(bits) >= 2 and bits[0] and bits[1]:
            out.append((bits[0].lower(), bits[1], bits[2] if len(bits) > 2 and bits[2] else None))
    return out


def override_for(t):
    text = " ".join([t.get("name") or "", t.get("merchant_name") or ""]).lower()
    return next(((label, name) for match, label, name in category_overrides() if match in text), None)


def tidy(raw):
    """Bank text as a short readable name: no POS prefix, no trailing dates or reference numbers."""
    raw = re.sub(r"^\s*POS (DEBIT|CREDIT)\s+", "", raw or "", flags=re.IGNORECASE)
    raw = re.sub(r"\s+(\d{2}/\d{2}|PPD ID:.*|\d{6,}.*)$", "", raw.strip())
    return raw.title()[:32]


def short_name(t):
    """Upper-case bank text without the POS prefix: the key shared by pending and posted charges."""
    return re.sub(r"^\s*POS (DEBIT|CREDIT)\s+", "", (t.get("name") or "").upper()).strip()


def clean_name(name, posted=None):
    """Never show raw bank text ("POS DEBIT MAIN ST. W"). A cut-off pending name borrows the name
    of a posted charge whose text starts the same way ("Main St. Wine"), else it is tidied."""
    if not name or not re.match(r"\s*POS (DEBIT|CREDIT)\s", name, re.IGNORECASE):
        return name
    short = re.sub(r"^\s*POS (DEBIT|CREDIT)\s+", "", name, flags=re.IGNORECASE).strip().upper()
    if posted and len(short) >= 12:
        hit = next((m for k, m in posted.items() if k.startswith(short)), None)
        if hit:
            return hit
    return tidy(short)


def bank_name(t, kind, posted=None):
    raw = t.get("name") or ""
    m = re.match(r"\s*(?:pos debit |pos credit )?zelle payment (to|from) (\S+)", raw, re.IGNORECASE)
    if m:
        return f"Zelle {m.group(1).lower()} {m.group(2).title()}"
    if re.match(r"\s*venmo", raw, re.IGNORECASE):
        return "Venmo"
    over = override_for(t)
    if over and over[1]:
        return over[1]
    if kind or pull.CHEAP_RIDE_APP_PATTERN.search(raw):
        return clean_name(display_merchant(t, kind or "ride"), posted)
    if t.get("merchant_name"):
        return clean_name(t["merchant_name"], posted)
    return clean_name(raw, posted) if re.match(r"\s*POS ", raw, re.IGNORECASE) else tidy(raw)


RECURRING = set()   # (merchant, amount) pairs that bill monthly; filled by find_recurring()


def merchant_key(t):
    return re.sub(r"[^a-z]", "", (t.get("merchant_name") or t.get("name") or "").lower())[:24]


def find_recurring(txns):
    """A charge is a subscription bill when the same merchant also charged in a different month on
    about the same day of the month (4 days either way) at about the same price (within 20%, so a
    price rise still counts). One-off top-ups, upgrades and same-day doubles don't match."""
    by = defaultdict(list)
    for t in txns.values():
        if t["amount"] > 0:
            by[merchant_key(t)].append((date.fromisoformat(t.get("authorized_date") or t["date"]), round(t["amount"], 2), t))
    RECURRING.clear()
    for key, rows in by.items():
        for d, a, t in rows:
            for d2, a2, _ in rows:
                if (d2.year, d2.month) != (d.year, d.month) and abs(d2.day - d.day) <= 4 and abs(a2 - a) <= 0.2 * max(a, a2):
                    RECURRING.add((key, a, d))
                    break


def is_recurring(t):
    d = date.fromisoformat(t.get("authorized_date") or t["date"])
    return (merchant_key(t), round(t["amount"], 2), d) in RECURRING


def bank_label(t, section, kind):
    """One category per transaction for the whole-bank view."""
    c = (t.get("personal_finance_category") or {}).get("detailed") or ""
    out = t["amount"] > 0
    if kind == "drinks" and is_night_out(t):
        return "Clubs & bars"
    if section == "friends":
        return "Sent to friends" if out else "From friends"
    over = override_for(t)
    if over and section not in ("in", "internal"):
        return over[0]
    if kind:
        return "Travel" if kind == "ride" and t["amount"] > TRAVEL_RIDE else SWAP_LABELS[kind]
    if out and pull.classify(t) == "ride":
        # Rides over $60 are left out of the food-and-rides rows; they are trips, never "Loan payments"
        # (one lower-fare app's charges carry a cash-advance category).
        return "Travel" if t["amount"] > TRAVEL_RIDE else "Rides"
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
    text = " ".join([t.get("name") or "", t.get("merchant_name") or ""])
    if SUBSCRIPTION_PATTERN.search(text):
        # App Store bills bundle many subscriptions, so they always count. Anything else is a
        # subscription only when the same amount repeats on about the same day each month; a
        # one-off top-up (API tokens, an upgrade) is spending until it repeats.
        if re.search(r"apple\.com/bill|\bsub\b|subscription|membership", text, re.I) or is_recurring(t):
            return "Subscriptions"
        return "Services"
    if FUN_PATTERN.search(" ".join([t.get("name") or "", t.get("merchant_name") or ""])):
        return "Fun"
    for prefix, label in BANK_LABELS:
        if c.startswith(prefix):
            return label
    return "Other"


def merge_names(names):
    """One name per store. Banks cut names off at different lengths ("Corner Mini Market And D" and
    "...And Del"), so a name whose plain form starts another one's (12+ characters) joins the
    longest one. Zelle and Venmo names are people, never merged."""
    def key(n):
        k = re.sub(r"^\s*pos (debit|credit)\s+", "", n.lower())
        return re.sub(r"\s+", " ", k).strip().rstrip(".,*-#/ ")
    names = [n for n in set(names) if n]
    keys = {n: key(n) for n in names if not re.match(r"(zelle|venmo)\b", n, re.IGNORECASE)}
    uniq = sorted(set(keys.values()), key=len, reverse=True)
    target = {}
    for k in uniq:
        longer = [u for u in uniq if len(u) > len(k) and u.startswith(k)] if len(k) >= 12 else []
        target[k] = max(longer, key=len) if longer else k
    display = {}
    for n in sorted(names, key=lambda n: (n.isupper(), n)):   # prefer "Main St Wine" over "MAIN ST WINE"
        if n in keys and keys[n] == target[keys[n]]:
            display.setdefault(keys[n], n if not n.isupper() else n.title())
    return {n: display.get(target[keys[n]], n) for n in keys}


def whole_bank(txns, kinds, cancelled, last_week, this_monday, accounts, posted=None):
    """Every dollar in and out (minus moves between his own accounts), for the recap week, the
    week so far, and weekly totals going back 12 weeks. Positive amount = money out.

    "Usual" is ONE window everywhere: the last 10 full weeks. usualOut == analysis.outPerWeek, and
    dayWeights, flex and the category averages all come from the same weeks. Fixed costs (bills,
    subscriptions, loan payments, bank fees) are split out: flex is what the daily plan budgets."""
    first_wk = last_week - timedelta(weeks=11)
    weeks = defaultdict(lambda: {"out": 0.0, "in": 0.0, "invest": 0.0})
    items = []
    an_start, an_weeks = last_week - timedelta(weeks=9), 10
    cats = defaultdict(lambda: [0.0, 0])
    ins = defaultdict(float)
    places = defaultdict(lambda: [0.0, 0, ""])
    an_out = an_in = fixed_out = flex_out = 0.0
    history = []
    weekday = [0.0] * 7          # all money out by weekday (10 weeks)
    flex_weekday = [0.0] * 7     # flexible money out by weekday (10 weeks): the daily plan's shape
    find_recurring(txns)
    for t in txns.values():
        sid = stable_id(t)
        if not t["amount"] or sid in cancelled:
            continue
        raw = t.get("name") or ""
        if t["amount"] < 0 and pull.CHEAP_RIDE_APP_PATTERN.search(raw):
            continue                      # a released ride hold; its hold was dropped above
        section, _ = ledger.bucket(t)
        if section == "internal":
            continue
        d = date.fromisoformat(t.get("authorized_date") or t["date"])
        wk = week_start(d)
        kind = kinds.get(sid)
        label = bank_label(t, section, kind)
        if label == "Investing":          # e.g. a CATEGORY_OVERRIDES entry for a crypto on-ramp: not spending
            section = "investing"
        name = bank_name(t, kind, posted)
        fixed = label in FIXED_CATS
        hold = is_ride_hold(t)
        if wk >= an_start:   # every charge behind the analysis (and this week), so a category can open
            history.append({"d": d.isoformat(), "name": name, "amount": round(t["amount"], 2), "cat": label,
                            "pending": bool(t.get("pending")), "fixed": fixed, "hold": hold})
        if an_start <= wk <= last_week:
            if t["amount"] > 0 and section != "investing":
                cats[label][0] += t["amount"]; cats[label][1] += 1
                p = places[name]; p[0] += t["amount"]; p[1] += 1; p[2] = label
                an_out += t["amount"]
                weekday[d.weekday()] += t["amount"]
                if fixed:
                    fixed_out += t["amount"]
                elif label != "Investing":
                    flex_out += t["amount"]
                    flex_weekday[d.weekday()] += t["amount"]
            elif t["amount"] < 0 and section != "investing":
                an_in -= t["amount"]
                ins[label] -= t["amount"]
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
            hhmm = pull.parse_time(when).astimezone(pull.NYC).strftime("%H:%M") if when else None
            items.append({"id": sid, "week": "last" if wk == last_week else "now",
                          "day": (d - wk).days, "time": hhmm, "name": name, "amount": round(t["amount"], 2),
                          "cat": label, "swap": bool(kind), "pending": bool(t.get("pending")),
                          "fixed": fixed, "hold": hold})
    items.sort(key=lambda i: (i["week"] != "last", i["day"], i["time"] or "", -i["amount"]))

    # One name per store across the lists (bank cut-offs split one store into two names).
    canon = merge_names([h["name"] for h in history] + [i["name"] for i in items] + list(places))
    for row in history + items:
        row["name"] = canon.get(row["name"], row["name"])
    merged = defaultdict(lambda: [0.0, 0, ""])
    for n, v in sorted(places.items(), key=lambda kv: -kv[1][0]):   # label from the biggest part
        m = merged[canon.get(n, n)]
        m[0] += v[0]; m[1] += v[1]; m[2] = m[2] or v[2]
    places = merged

    series = []
    wk = first_wk
    while wk <= this_monday:
        w = weeks.get(wk, {"out": 0, "in": 0, "invest": 0})
        series.append({"wk": wk.isoformat(), "out": round(w["out"]), "in": round(w["in"]), "invest": round(w["invest"])})
        wk += timedelta(days=7)
    balances = [{"name": a.get("official_name") or a["name"], "mask": a.get("mask"), "type": a.get("type"),
                 "current": (a.get("balances") or {}).get("current"), "available": (a.get("balances") or {}).get("available")}
                for a in accounts]
    sent = cats.get("Sent to friends", [0.0, 0])[0]
    got = ins.get("From friends", 0.0)
    friends_net = round((sent - got) / an_weeks)
    cat_rows = []
    for c, v in cats.items():
        row = {"cat": c, "perWeek": round(v[0] / an_weeks), "total": round(v[0]), "count": v[1], "fixed": c in FIXED_CATS}
        if c == "Sent to friends":
            row["net"] = friends_net      # sent minus what friends sent back, a week
        cat_rows.append(row)
    analysis = {
        "weeks": an_weeks, "from": an_start.isoformat(), "to": (last_week + timedelta(days=6)).isoformat(),
        "outPerWeek": round(an_out / an_weeks), "inPerWeek": round(an_in / an_weeks),
        "friendsNet": friends_net,
        "cats": sorted(cat_rows, key=lambda x: -x["total"]),
        "ins": sorted(({"cat": c, "perWeek": round(v / an_weeks), "total": round(v)} for c, v in ins.items()), key=lambda x: -x["total"]),
        "places": sorted(({"name": n, "cat": v[2], "total": round(v[0]), "count": v[1]} for n, v in places.items()),
                         key=lambda x: -x["total"])[:15],
    }
    history.sort(key=lambda h: (h["d"], -abs(h["amount"])), reverse=True)

    def weights(xs):
        return [round(x / sum(xs), 4) for x in xs] if sum(xs) else [round(1 / 7, 4)] * 7
    return {"items": items, "weekly": series, "balances": balances, "analysis": analysis, "history": history,
            "usualOut": analysis["outPerWeek"], "usualWeeks": an_weeks,
            "dayWeights": weights(weekday),
            "flex": {"usual": round(flex_out / an_weeks), "dayWeights": weights(flex_weekday),
                     "fixedCats": list(FIXED_CATS), "fixedUsual": round(fixed_out / an_weeks), "weeks": an_weeks}}


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


def plan_times(per_week):
    """How often to plan a swap: at most half as often as he does it now, at least once a week if he
    does it 2+ times a week; 1 to 2 times a week becomes every other week. None = too rare to plan."""
    if per_week >= 2:
        return max(1, int(per_week // 2)), False
    if per_week >= 1:
        return 0.5, True
    return None, False


def night_of(r):
    """The night a club or bar tab belongs to. Tabs close at the end of the night, so one after
    midnight (or with no time, as most banks send) counts for the evening before."""
    late = r["time"] is None or int(r["time"][:2]) < 6
    return (r["date"] - timedelta(days=1 if late else 0)).weekday()


def busiest_days(rows, k, day_of=None):
    """The k weekdays (Mon=0) with the most of these charges, in week order."""
    counts = defaultdict(int)
    for r in rows:
        counts[day_of(r) if day_of else r["date"].weekday()] += 1
    top = sorted(counts, key=lambda d: (-counts[d], d))[:k]
    return sorted(top)


def say_days(days):
    return DAYS_FULL[days[0]] if len(days) == 1 else " and ".join(DAYS[d] for d in days)


def swap_options(rows, txns, last_week, this_monday, gaps, ride_name=None):
    """Swaps built only from his own charges over the last 10 full weeks. Each has the saving per
    time ("save", in "unit"s), how often he does that thing now ("perWeek"), how often to plan it
    ("timesPerWeek", at most half of perWeek; "everyOtherWeek" when that is 0.5) and when ("when",
    "days": his own busiest weekdays for it). Prices come from posted charges only (pending ones are
    estimates). Night rides are never a target."""
    start, n = last_week - timedelta(weeks=9), 10
    rs = [r for r in rows if start <= r["date"] < this_monday]
    def of(pred):
        return [r for r in rs if pred(r)]
    def amounts(sel):
        posted = [r["amount"] for r in sel if not r["pending"]]
        return posted or [r["amount"] for r in sel]
    pfc = lambda r: ((r["raw"].get("personal_finance_category") or {}).get("detailed") or "")
    out = []

    def add(id, title, detail, save, unit, kind, cat, sel, per_week, basis, when, day_of=None, **extra):
        times, every_other = plan_times(per_week)
        if save < 4 or times is None:
            return
        days = busiest_days(sel, 1 if times <= 1 else 2, day_of)
        out.append({"id": id, "title": title, "detail": detail, "save": round(save), "unit": unit, "kind": kind,
                    "cat": cat, "perWeek": round(per_week, 1), "timesPerWeek": times, "everyOtherWeek": every_other,
                    "days": days, "when": when.format(days=say_days(days)) if days else "",
                    "basis": basis, "real": True, **extra})

    # Subway for daytime rides. Night rides (11 PM to 6 AM) are never swappable. Most banks send no
    # time for ride charges, so with too few timed rides the daytime count is a stated estimate:
    # weekend rides (Fri to Sun) are left out, and only half of the Mon to Thu rides count.
    rides = of(lambda r: r["kind"] == "ride")
    if rides:
        timed = [r for r in rides if r["time"]]
        if len(timed) >= max(5, len(rides) / 2):
            day = [r for r in timed if 6 <= int(r["time"][:2]) <= 22]
            per_week = len(day) / n * len(rides) / len(timed)
            estimate, how = len(timed) < len(rides), "daytime rides a week"
        else:
            day = [r for r in rides if r["date"].weekday() <= 3]
            per_week = 0.5 * len(day) / n
            estimate, how = True, "daytime rides a week, estimated from half your Mon to Thu rides (bank sends no ride times)"
        if day:
            m = statistics.median(amounts(day))
            add("subway-day", "Subway instead of a daytime ride", "Daytime only. Night rides stay as they are.",
                m - 3, "ride", "move", "Rides", day, per_week,
                f"Daytime ride median ${m:.0f} vs a $3 fare. About {per_week:.0f} {how}. Night rides never count",
                "{days} daytime", estimate=estimate, ridesTimed=not estimate,
                pendingRides=sum(1 for r in day if r["pending"]))
    dine = of(lambda r: r["kind"] == "dining")
    fast = of(lambda r: r["kind"] == "quick" and "FAST_FOOD" in pfc(r))
    if dine and fast:
        a, b = statistics.median(amounts(dine)), statistics.median(amounts(fast))
        add("counter-meal", "Counter meal instead of sit-down", "Same night out, cheaper spot.", a - b, "meal", "food",
            "Eating out", dine, len(dine) / n, f"Your sit-down median ${a:.0f} vs counter ${b:.0f}. {len(dine) / n:.1f} sit-downs a week",
            "On {days}")
    bar = of(lambda r: r["kind"] == "drinks" and is_night_out(r["raw"]))
    if bar:
        avg = statistics.mean(amounts(bar))
        add("bar-night", "One fewer club or bar night", "Keep the rest of the week as is.", avg, "night", "food",
            "Clubs & bars", bar, len(bar) / n, f"Your club and bar tabs average ${avg:.0f}. {len(bar) / n:.1f} a week",
            "Before {days} night", day_of=night_of)
    bodega = of(lambda r: r["kind"] == "drinks" and not is_night_out(r["raw"]))
    if bodega:
        m = statistics.median(amounts(bodega))
        add("bodega", "One fewer bodega run", "Buy for two nights at once.", m, "run", "food", "Bodega & liquor",
            bodega, len(bodega) / n, f"Your bodega median ${m:.0f}. {len(bodega) / n:.1f} runs a week", "On {days}")
    snack = of(lambda r: r["kind"] == "quick" and "FAST_FOOD" not in pfc(r))
    if snack:
        m = statistics.median(amounts(snack))
        add("coffee", "Skip one café or snack run", "Keep the ones you like most.", m, "run", "food", "Coffee & snacks",
            snack, len(snack) / n, f"Your café and snack median ${m:.0f}. {len(snack) / n:.1f} a week", "On {days}")
    dl = of(lambda r: r["kind"] == "delivery")
    shown = gaps[:3]          # the same places the app shows as priceGaps
    if dl and shown:
        g0 = shown[0]
        if len(shown) == 1:
            gap = g0["delivered"] - g0["pickup"]
            basis = f"{g0['place']}: delivered ${g0['delivered']} vs pickup ${g0['pickup']}"
        else:
            gap = round(statistics.mean(g["delivered"] - g["pickup"] for g in shown))
            basis = f"Average gap at {len(shown)} places ${gap}. {g0['place']}: delivered ${g0['delivered']} vs pickup ${g0['pickup']}"
        add("pickup", "Pick up instead of delivery", "Same food. No delivery markup.", gap, "order", "food", "Delivery",
            dl, len(dl) / n, basis, "On {days}")
    out.sort(key=lambda x: -x["save"] * x["timesPerWeek"])
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

    # Pending charges come with a cut-off name ("POS DEBIT MAIN ST. W"). Borrow the kind and the
    # name of a posted charge whose text (without the POS prefix) starts the same way ("MAIN ST. WINE").
    posted_kinds, posted_names = {}, {}
    for t in txns.values():
        if t.get("pending") or not short_name(t):
            continue
        k = pull.classify(t)
        if k:
            posted_kinds.setdefault(short_name(t), k)
        posted_names.setdefault(short_name(t), t.get("merchant_name") or tidy(short_name(t)))

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
            cancelled.add(stable_id(t))
            continue
        kind = app_kind(kind)
        if kind == "ride" and t["amount"] > TRAVEL_RIDE:
            continue
        d = date.fromisoformat(t.get("authorized_date") or t["date"])
        when = t.get("authorized_datetime") or t.get("datetime")
        hhmm = pull.parse_time(when).astimezone(pull.NYC).strftime("%H:%M") if when else None
        merchant = clean_name(display_merchant(t, kind), posted_names)
        rows.append({"date": d, "time": hhmm, "kind": kind, "amount": round(t["amount"], 2),
                     "merchant": merchant, "id": stable_id(t), "pending": bool(t.get("pending")),
                     "hold": is_ride_hold(t), "raw": t})

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
                "amount": r["amount"], "kind": r["kind"], "tag": None, "pending": r["pending"], "hold": r["hold"]}
               for r in week_rows]
    # This week so far (Mon to today), same shape, for the daily plan and the chat.
    cur_rows = sorted((r for r in rows if r["date"] >= this_monday), key=lambda r: (r["date"], r["time"] or ""))
    current = [{"id": r["id"], "day": (r["date"] - this_monday).days, "time": r["time"], "merchant": r["merchant"],
                "amount": r["amount"], "kind": r["kind"], "tag": None, "pending": r["pending"], "hold": r["hold"]}
               for r in cur_rows]
    # His usual spend by weekday (food + getting around), last 10 full weeks (the one "usual" window).
    wd = [0.0] * 7
    for r in rows:
        if last_week - timedelta(weeks=9) <= r["date"] < this_monday:
            wd[r["date"].weekday()] += r["amount"]
    day_weights = [round(x / sum(wd), 4) for x in wd] if sum(wd) else [round(1 / 7, 4)] * 7
    week_food = round(sum(c["amount"] for c in charges if c["kind"] in FOOD), 2)
    week_move = round(sum(c["amount"] for c in charges if c["kind"] in MOVE), 2)

    # Ride prices since the move, by app. Posted rides only: a pending hold is an estimate.
    move_date = date(2026, 8, 20)
    by_app = defaultdict(list)
    for r in rows:
        if r["kind"] == "ride" and r["date"] >= move_date and not r["pending"]:
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

    def holds(cs):
        """Pending ride holds still counted in a total (estimates until the final fare posts)."""
        hs = [c["amount"] for c in cs if c["hold"]]
        return {"count": len(hs), "amount": round(sum(hs), 2)}

    live = {
        "generatedAt": datetime.now(pull.NYC).replace(tzinfo=None).isoformat(timespec="minutes"),
        "today": today.isoformat(),
        "weekStart": last_week.isoformat(),
        "weekLabel": f"{last_week.strftime('%b')} {last_week.day} – {(last_week + timedelta(days=6)).strftime('%b')} {(last_week + timedelta(days=6)).day}",
        "usual": {"food": usual_food, "move": usual_move, "total": usual_food + usual_move},
        "thisWeek": {"food": week_food, "move": week_move, "total": round(week_food + week_move, 2),
                     "pendingHolds": holds(charges)},
        "weekly": series,
        "charges": charges,
        "current": {"weekStart": this_monday.isoformat(), "charges": current,
                    "food": round(sum(c["amount"] for c in current if c["kind"] in FOOD), 2),
                    "move": round(sum(c["amount"] for c in current if c["kind"] in MOVE), 2),
                    "pendingHolds": holds(current)},
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
    live["swapOptions"] = swap_options(rows, txns, last_week, this_monday, gaps)
    live["logos"] = merchant_logos(list(txns.values()), sorted(shown)) if logos else {}

    # Whole bank (private build only): every dollar in and out, not just food and getting around.
    kinds = {r["id"]: r["kind"] for r in rows}
    accounts = pull.plaid("/accounts/get", {"access_token": token})["accounts"]
    live["bank"] = whole_bank(txns, kinds, cancelled, last_week, this_monday, accounts, posted_names)
    # When Plaid last checked the bank (it does this 1-4 times a day on its own), in NYC time.
    try:
        st = (pull.plaid("/item/get", {"access_token": token}).get("status") or {}).get("transactions") or {}
        when = st.get("last_successful_update")
        live["bankCheckedAt"] = pull.parse_time(when).astimezone(pull.NYC).replace(tzinfo=None).isoformat(timespec="minutes") if when else None
    except SystemExit:
        live["bankCheckedAt"] = None
    return live


def ask_bank(token, wait=120):
    """Ask Plaid to check the bank now (/transactions/refresh), then wait until its last check time
    moves or `wait` seconds pass. Included on Plaid's Trial plan; billed per call on paid plans."""
    import time
    def checked():
        st = (pull.plaid("/item/get", {"access_token": token}).get("status") or {}).get("transactions") or {}
        return st.get("last_successful_update") or ""
    before = checked()
    try:
        pull.plaid("/transactions/refresh", {"access_token": token})
    except SystemExit as e:
        print(f"refresh not available: {e}")
        return
    end = time.time() + wait
    while time.time() < end:
        time.sleep(15)
        if checked() > before:
            print("bank checked")
            return
    print("bank not checked yet; using what Plaid has")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--person", default="p00")
    parser.add_argument("--refresh", action="store_true",
                        help="ask Plaid to check the bank first, then wait for it (up to 2 minutes)")
    args = parser.parse_args()
    pull.load_env()
    token = pull.saved_token(args.person)
    if args.refresh:
        ask_bank(token)
    live = build_live(token)
    charges, series = live["charges"], live["weekly"]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("/* PRIVATE: generated by sync.py from the founder's Plaid data. Gitignored; only ships in his phone build. */\n")
        f.write("window.SwapLive = " + json.dumps(live, indent=1) + ";\n")
    print(f"Wrote {os.path.relpath(OUT, pull.HERE)}: week {live['weekLabel']} ${live['thisWeek']['total']:.0f} "
          f"({len(charges)} charges), usual ${live['usual']['total']}, {len(series)} weeks of history")


if __name__ == "__main__":
    main()
