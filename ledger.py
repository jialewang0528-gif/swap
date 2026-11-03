"""Full money ledger for one linked person: every dollar in and out, sorted into buckets.

Prints only. Nothing is saved, because this covers ALL transactions, not just
delivery and rides. Use only on your own data (or a friend who opted in).

  python3 ledger.py --person p00 [--start 2025-10-01 --end 2026-10-31]
"""

import argparse
import collections
import os
import re
from datetime import date

import pull


def support_senders():
    """Zelle senders whose money is support (family), not friends paying back.

    Set in .env (kept out of git) as SUPPORT_SENDERS=firstname1,firstname2, matched on
    the sender's first name, lowercased.
    """
    return {s.strip().lower() for s in os.environ.get("SUPPORT_SENDERS", "").split(",") if s.strip()}


def category(t):
    return (t.get("personal_finance_category") or {}).get("detailed") or ""


def zelle_party(t):
    m = re.match(r"zelle payment (?:to|from) (\S+)", t.get("name") or "", re.IGNORECASE)
    return m.group(1).lower() if m else None


def bucket(t):
    """Return (section, bucket) for one posted transaction. Every transaction gets exactly one."""
    c = category(t)
    name = (t.get("name") or "").lower()
    text = " ".join([t.get("merchant_name") or "", name]).lower()
    out = t["amount"] > 0

    # Chase "Pay in 4": the debit purchase is already counted at full price, then Chase deposits
    # it back and collects 4 installments. That's financing, not new spending.
    if "pay in 4" in name:
        return ("internal", "Pay in 4 financing (installments still owed)")
    # Money moving between my own accounts: counted once, never as spending.
    if c == "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT":
        return ("internal", "Credit card payment")
    if c.startswith("TRANSFER_OUT_ACCOUNT_TRANSFER") or c.startswith("TRANSFER_IN_ACCOUNT_TRANSFER"):
        return ("internal", "Own-account transfer")

    if name.startswith("zelle payment"):
        if out:
            return ("friends", "Zelle sent")
        party = zelle_party(t) or ""
        return ("in", "Zelle support received") if party in support_senders() else ("friends", "Zelle received from friends")
    if "kalshi" in text or "polymarket" in text:
        return ("spend", "Prediction markets (net)")
    if c == "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS":
        return ("investing", "Brokerage transfers")

    if not out:
        if c.startswith("INCOME"):
            return ("in", "Paychecks")
        if c.startswith("TRANSFER_IN"):
            return ("in", "Other deposits and app transfers in")
        return ("spend", "Refunds and credits")  # merchant refunds reduce spending

    kind = pull.classify(t)
    if kind == "ride":
        return ("spend", "Rides (everyday)" if t["amount"] <= 60 else "Rides (travel)")
    if kind in ("delivery", "membership"):
        return ("spend", "Delivery")
    if c in ("FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"):
        return ("spend", "Restaurants & bars")
    if c.startswith("FOOD_AND_DRINK"):
        return ("spend", "Quick food, coffee & snacks")
    if c == "TRANSPORTATION_PUBLIC_TRANSIT":
        # Amtrak, NJ Transit and intercity buses are trips, not getting around town.
        return ("spend", "Travel" if pull.INTERCITY_PATTERN.search(text) else "Subway & transit")
    if c.startswith("GENERAL_MERCHANDISE"):
        return ("spend", "Shopping")
    if c.startswith("ENTERTAINMENT"):
        return ("spend", "Entertainment & subscriptions")
    if c.startswith("TRAVEL"):
        return ("spend", "Travel")
    if c.startswith("TRANSFER_OUT_WITHDRAWAL"):
        return ("spend", "ATM cash")
    if c.startswith("TRANSFER_OUT"):
        return ("spend", "Other transfers out (Venmo, wires)")
    if c.startswith("BANK_FEES"):
        return ("spend", "Bank fees")
    return ("spend", "Services, health & other")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--person", required=True)
    parser.add_argument("--start", default="0000-01-01")
    parser.add_argument("--end", default="9999-12-31")
    args = parser.parse_args()
    pull.load_env()
    token = pull.saved_token(args.person)
    txns = [t for t in pull.fetch_all_transactions(token) if args.start <= t["date"] <= args.end]
    accounts = pull.plaid("/accounts/get", {"access_token": token})["accounts"]

    first, last = min(t["date"] for t in txns), max(t["date"] for t in txns)
    months = (date.fromisoformat(last) - date.fromisoformat(first)).days / 30.44
    totals = collections.defaultdict(float)
    counts = collections.Counter()
    for t in txns:
        key = bucket(t)
        totals[key] += t["amount"]  # positive = out, negative = in
        counts[key] += 1

    def section(name, sign=1):
        rows = sorted(((b, v) for (s, b), v in totals.items() if s == name), key=lambda kv: -sign * kv[1])
        return rows, sum(v for _, v in rows)

    print(f"Ledger for {args.person}: {first} to {last} ({months:.1f} months), {len(txns)} posted transactions\n")

    spend, spend_total = section("spend")
    print("REAL SPENDING (purchases minus refunds, plus net friends and net prediction markets)")
    for b, v in spend:
        print(f"  {b:38} ${v:10,.0f}  ${v / months:7,.0f}/mo  ({counts[('spend', b)]})")
    friends, friends_net = section("friends")
    for b, v in friends:
        print(f"    {b:36} ${v:10,.0f}")
    print(f"  {'Friends via Zelle (net)':38} ${friends_net:10,.0f}  ${friends_net / months:7,.0f}/mo")
    real = spend_total + friends_net
    print(f"  {'TOTAL REAL SPENDING':38} ${real:10,.0f}  ${real / months:7,.0f}/mo\n")

    inv, inv_total = section("investing")
    print(f"INVESTING (still my money): ${inv_total:,.0f}  (${inv_total / months:,.0f}/mo)\n")

    income, income_total = section("in", -1)
    print("MONEY IN")
    for b, v in income:
        print(f"  {b:38} ${-v:10,.0f}  ${-v / months:7,.0f}/mo  ({counts[('in', b)]})")
    print(f"  {'TOTAL IN':38} ${-income_total:10,.0f}\n")

    internal, internal_total = section("internal")
    print("INTERNAL (between my own accounts, counted once, not spending)")
    for b, v in internal:
        print(f"  {b:38} net ${v:10,.0f}  ({counts[('internal', b)]} legs)")

    print("\nCHECKS")
    print(f"  Every transaction sorted: {sum(counts.values())} of {len(txns)}")
    gross_out = sum(t["amount"] for t in txns if t["amount"] > 0 and bucket(t)[0] != "internal")
    print(f"  Money out, Chase-style (all outflows except internal): ${gross_out:,.0f} = ${gross_out / months:,.0f}/mo")
    net_flow = -sum(t["amount"] for t in txns)
    print(f"  In minus out over the period: ${net_flow:,.0f}")
    for a in accounts:
        print(f"  Current balance {a['name']} ...{a['mask']}: ${a['balances'].get('current') or 0:,.2f}")


if __name__ == "__main__":
    main()
