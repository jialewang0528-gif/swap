"""Offline tests: no Plaid keys needed. Run with `python3 -m unittest test_pull`."""

import csv
import os
import tempfile
import unittest
from unittest import mock

import pull
import sync

# The lower-fare ride app's real name lives only in .env; tests use a made-up one.
RIDE_ENV = {"RIDE_APP_NAME": "Faircab", "RIDE_APP_PATTERN": ""}


def txn(tid, name, amount=12.5, merchant=None, category="", counterparties=None, day="2026-10-20", pending=False):
    return {
        "transaction_id": tid, "name": name, "merchant_name": merchant, "amount": amount,
        "date": day, "authorized_date": day, "authorized_datetime": f"{day}T23:15:00Z",
        "personal_finance_category": {"detailed": category}, "counterparties": counterparties or [],
        "pending": pending, "account_id": "SECRET-ACCOUNT", "location": {"city": "New York"},
    }


class ClassifyTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, RIDE_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_uber_ride_from_category(self):
        t = txn("1", "Uber 063015 SF**POOL**", category="TRANSPORTATION_TAXIS_AND_RIDE_SHARES")
        self.assertEqual(pull.classify(t), "ride")

    def test_uber_eats_is_delivery_not_ride(self):
        t = txn("2", "UBER *EATS PENDING", merchant="Uber Eats", category="FOOD_AND_DRINK_FAST_FOOD")
        self.assertEqual(pull.classify(t), "delivery")

    def test_doordash_via_marketplace_counterparty(self):
        t = txn("3", "Joe's Pizza", merchant="Joe's Pizza", category="FOOD_AND_DRINK_RESTAURANT",
                counterparties=[{"name": "DoorDash", "type": "marketplace"}, {"name": "Joe's Pizza", "type": "merchant"}])
        self.assertEqual(pull.classify(t), "delivery")

    def test_grubhub_and_seamless(self):
        self.assertEqual(pull.classify(txn("4", "GRUBHUB*SWEETGREEN")), "delivery")
        self.assertEqual(pull.classify(txn("5", "SEAMLSS* HALAL GUYS", merchant="Seamless")), "delivery")

    def test_lyft_and_v2_category(self):
        self.assertEqual(pull.classify(txn("6", "LYFT *RIDE TUE 11PM")), "ride")
        self.assertEqual(pull.classify(txn("7", "Yellow cab", category="TAXIS_AND_RIDE_SHARES")), "ride")

    def test_dashpass_is_membership(self):
        t = txn("11", "DD *DOORDASHDASHPASS", merchant="DoorDash", counterparties=[{"name": "DoorDash", "type": "marketplace"}])
        self.assertEqual(pull.classify(t), "membership")

    def test_zelle_to_someone_named_uber_is_not_a_ride(self):
        t = txn("12", "Zelle payment to Uber 00000000000", merchant="Uber", category="TRANSFER_OUT_TRANSFER_OUT_FROM_APPS",
                counterparties=[{"name": "Uber", "type": "merchant"}, {"name": "Zelle", "type": "payment_app"}])
        self.assertIsNone(pull.classify(t))

    def test_cheap_ride_app_despite_cash_advance_category(self):
        t = txn("13", "FAIRCAB* JANE DOE DRIVEFAIRCAB. VA 10/29", merchant="Faircab",
                category="LOAN_PAYMENTS_CASH_ADVANCES")
        self.assertEqual(pull.classify(t), "ride")

    def test_ride_app_name_only_from_env(self):
        t = txn("13b", "FAIRCAB* JANE DOE DRIVEFAIRCAB. VA 10/29", category="LOAN_PAYMENTS_CASH_ADVANCES")
        with mock.patch.dict(os.environ, {"RIDE_APP_NAME": "", "RIDE_APP_PATTERN": ""}):
            self.assertIsNone(pull.classify(t))
        with mock.patch.dict(os.environ, {"RIDE_APP_NAME": "", "RIDE_APP_PATTERN": r"janedoe|drivefaircab"}):
            self.assertEqual(pull.classify(t), "ride")

    def test_cash_advance_app_and_zelle_are_not_rides(self):
        self.assertIsNone(pull.classify(txn("14", "FAIRCAB FINANCE INC", merchant="Faircab",
                                            category="LOAN_PAYMENTS_CASH_ADVANCES")))
        self.assertIsNone(pull.classify(txn("15", "Zelle payment to Faircab JPM00EXAMPLE", merchant="Faircab",
                                            category="LOAN_PAYMENTS_CASH_ADVANCES")))

    def test_other_food_and_getting_around_kinds(self):
        self.assertEqual(pull.classify(txn("8", "Starbucks", merchant="Starbucks", category="FOOD_AND_DRINK_COFFEE")), "quick_food")
        self.assertEqual(pull.classify(txn("9", "Trader Joe's", category="FOOD_AND_DRINK_GROCERIES")), "groceries")
        self.assertEqual(pull.classify(txn("10", "MTA*NYCT PAYGO", category="TRANSPORTATION_PUBLIC_TRANSIT")), "transit")
        self.assertEqual(pull.classify(txn("16", "Cava", category="FOOD_AND_DRINK_RESTAURANT")), "dining")
        self.assertEqual(pull.classify(txn("17", "Corner Bar", category="FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR")), "drinks")
        self.assertEqual(pull.classify(txn("22", "POS DEBIT CORNER MINI MARKET AND D", category="GENERAL_MERCHANDISE_CONVENIENCE_STORES")), "drinks")
        self.assertEqual(pull.classify(txn("23", "POS DEBIT MAIN ST. WINE", category="GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE")), "drinks")
        self.assertEqual(pull.classify(txn("24", "POS DEBIT FAIRCAB* HOLDFORDRIVER +1831", merchant="Faircab", category="LOAN_PAYMENTS_CASH_ADVANCES")), "ride")

    def test_intercity_trains_dropped(self):
        self.assertIsNone(pull.classify(txn("21", "Amtrak", merchant="Amtrak", category="TRANSPORTATION_PUBLIC_TRANSIT")))

    def test_everything_else_dropped(self):
        self.assertIsNone(pull.classify(txn("18", "Grailed", category="GENERAL_MERCHANDISE_ONLINE_MARKETPLACES")))
        self.assertIsNone(pull.classify(txn("19", "Payroll", amount=-900, category="INCOME_SALARY")))
        self.assertIsNone(pull.classify(txn("20", "Rent", category="RENT_AND_UTILITIES_RENT")))


class PlaidErrorsTest(unittest.TestCase):
    def test_timeout_is_a_clean_exit(self):
        env = {"PLAID_CLIENT_ID": "id", "PLAID_SECRET": "s", "PLAID_ENV": "sandbox", "PLAID_TIMEOUT": "2"}
        with mock.patch.dict(os.environ, env), \
                mock.patch.object(pull.urllib.request, "urlopen", side_effect=TimeoutError("timed out")) as u:
            with self.assertRaises(SystemExit) as e:
                pull.plaid("/transactions/sync", {})
        self.assertIn("unreachable", str(e.exception))
        self.assertEqual(u.call_args.kwargs["timeout"], 2.0)


class PullAndSaveTest(unittest.TestCase):
    def test_only_food_and_getting_around_rows_are_written(self):
        pages = [
            {"added": [txn("a", "Uber 063015 SF**POOL**", category="TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
                       txn("b", "Starbucks", merchant="Starbucks", category="FOOD_AND_DRINK_COFFEE"),
                       txn("e", "Apple Store", category="GENERAL_MERCHANDISE_ELECTRONICS"),
                       txn("c", "DOORDASH*CHIPOTLE", amount=24.1),
                       txn("d", "DOORDASH*CHIPOTLE", amount=24.1, pending=True)],
             "modified": [], "removed": [], "next_cursor": "x", "has_more": True},
            {"added": [], "modified": [], "removed": [], "next_cursor": "y", "has_more": False,
             "transactions_update_status": "HISTORICAL_UPDATE_COMPLETE"},
            {"added": [], "modified": [], "removed": [], "next_cursor": "z", "has_more": False,
             "transactions_update_status": "HISTORICAL_UPDATE_COMPLETE"},
        ]
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(pull, "DATA_DIR", tmp), \
                mock.patch.object(pull, "plaid", side_effect=pages):
            pull.pull_and_save("test", "access-token")
            with open(os.path.join(tmp, "test.csv")) as f:
                raw = f.read()
            rows = list(csv.DictReader(raw.splitlines()))

        self.assertEqual(sorted(r["transaction_id"] for r in rows), ["a", "b", "c"])  # Apple Store + pending dropped
        self.assertEqual({r["kind"] for r in rows}, {"ride", "delivery", "quick_food"})
        self.assertEqual(rows[0]["hour_ny"], "19")  # 23:15 UTC = 7:15pm in New York (EDT)
        self.assertNotIn("SECRET-ACCOUNT", raw)
        self.assertNotIn("New York", raw)

    def test_keeps_syncing_after_history_completes(self):
        # Plaid reports the history is done before the older transactions arrive.
        pages = [
            {"added": [txn("new", "LYFT *RIDE", day="2026-10-20")], "modified": [], "removed": [],
             "next_cursor": "1", "has_more": False, "transactions_update_status": "INITIAL_UPDATE_COMPLETE"},
            {"added": [], "modified": [], "removed": [], "next_cursor": "2", "has_more": False,
             "transactions_update_status": "HISTORICAL_UPDATE_COMPLETE"},
            {"added": [txn("old", "LYFT *RIDE", day="2025-11-03")], "modified": [], "removed": [],
             "next_cursor": "3", "has_more": False, "transactions_update_status": "HISTORICAL_UPDATE_COMPLETE"},
        ]
        with mock.patch.object(pull, "plaid", side_effect=pages), mock.patch.object(pull.time, "sleep"):
            ids = sorted(t["transaction_id"] for t in pull.fetch_all_transactions("access-token"))
        self.assertEqual(ids, ["new", "old"])


class InviteTest(unittest.TestCase):
    def test_finds_public_token_nested_in_session_results(self):
        sessions = [{"link_session_id": "s1", "results": {"item_add_results": [{"public_token": "public-xyz", "accounts": []}]}}]
        self.assertEqual(pull._find_public_token(sessions), "public-xyz")
        self.assertIsNone(pull._find_public_token([{"link_session_id": "s2", "exit": {"status": "requires_credentials"}}]))


class SummaryTest(unittest.TestCase):
    def test_baseline_only_counts_weeks_the_data_covers(self):
        rows = [{"date": "2026-10-14", "kind": "delivery", "amount": 40.0, "merchant": "DoorDash"}]
        with mock.patch("builtins.print") as printed:
            # Data starts Wed Oct 7, so only 2 full weeks (Oct 12-25) exist, not 6.
            pull.print_summary(rows, pull.date(2026, 10, 7), pull.date(2026, 10, 28))
        output = " ".join(str(c.args[0]) for c in printed.call_args_list)
        self.assertIn("2026-10-12 to 2026-10-25 (2 weeks)", output)
        self.assertIn("$20.00", output)


MON, LAST = pull.date(2026, 11, 2), pull.date(2026, 10, 26)


def row(day, kind, amount, pending=False, time=None, raw=None):
    return {"date": day, "time": time, "kind": kind, "amount": amount, "pending": pending, "hold": False,
            "raw": raw or {}, "merchant": "x", "id": f"{day}-{amount}"}


class SyncSwapsTest(unittest.TestCase):
    def test_plan_times(self):
        self.assertEqual(sync.plan_times(12.2), (6, False))
        self.assertEqual(sync.plan_times(2.9), (1, False))
        self.assertEqual(sync.plan_times(1.1), (0.5, True))
        self.assertEqual(sync.plan_times(0.6), (None, False))

    def test_untimed_rides_never_count_weekends_and_are_an_estimate(self):
        rows = []
        for w in range(10):
            monday = LAST - pull.timedelta(weeks=w)
            for d in range(4):                         # Mon to Thu, $10 each
                rows.append(row(monday + pull.timedelta(days=d), "ride", 10.0))
            for _ in range(3):                         # Saturday, $30 each (likely nights)
                rows.append(row(monday + pull.timedelta(days=5), "ride", 30.0))
        rows.append(row(LAST, "ride", 99.0, pending=True))   # a pending hold: counted, never priced
        swaps = {s["id"]: s for s in sync.swap_options(rows, {}, LAST, MON, [])}
        sub = swaps["subway-day"]
        self.assertTrue(sub["estimate"])
        self.assertFalse(sub["ridesTimed"])
        self.assertEqual(sub["save"], 7)               # $10 weekday median - $3, weekend and hold left out
        self.assertAlmostEqual(sub["perWeek"], 2.0)    # half of 4.1 Mon to Thu rides a week
        self.assertEqual(sub["timesPerWeek"], 1)
        self.assertEqual(sub["pendingRides"], 1)
        self.assertIn("estimated", sub["basis"])
        self.assertTrue(sub["when"].endswith("daytime"))
        self.assertTrue(all(d <= 3 for d in sub["days"]))

    def test_timed_rides_drop_night_hours(self):
        rows = []
        for w in range(10):
            monday = LAST - pull.timedelta(weeks=w)
            rows += [row(monday, "ride", 12.0, time="14:00"), row(monday + pull.timedelta(days=1), "ride", 12.0, time="09:30"),
                     row(monday + pull.timedelta(days=5), "ride", 40.0, time="01:30")]
        sub = {s["id"]: s for s in sync.swap_options(rows, {}, LAST, MON, [])}["subway-day"]
        self.assertFalse(sub["estimate"])
        self.assertEqual(sub["perWeek"], 2.0)
        self.assertEqual(sub["save"], 9)
        self.assertEqual(sub["when"], "Monday daytime")   # planned once a week: one day

    def test_bar_night_when_is_the_evening_before(self):
        tab = {"name": "ROOFTOP LOUNGE", "personal_finance_category": {"detailed": "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"}}
        rows = [row(LAST - pull.timedelta(weeks=w) + pull.timedelta(days=6), "drinks", 50.0, raw=tab) for w in range(10)]
        bar = {s["id"]: s for s in sync.swap_options(rows, {}, LAST, MON, [])}["bar-night"]
        self.assertEqual(bar["when"], "Before Saturday night")   # Sunday-dated tabs, no time: Saturday night
        self.assertTrue(bar["everyOtherWeek"])

    def test_pickup_saving_matches_its_basis(self):
        rows = [row(LAST - pull.timedelta(days=d), "delivery", 30.0) for d in range(0, 70, 5)]
        gaps = [{"place": "Chain A", "pickup": 17, "delivered": 50, "n": 4}, {"place": "Chain B", "pickup": 16, "delivered": 40, "n": 3},
                {"place": "Chain C", "pickup": 10, "delivered": 33, "n": 3}, {"place": "Chain D", "pickup": 10, "delivered": 12, "n": 2}]
        p = {s["id"]: s for s in sync.swap_options(rows, {}, LAST, MON, gaps)}["pickup"]
        self.assertEqual(p["save"], 27)                # mean of the 3 shown gaps, not all 4
        self.assertIn("$27", p["basis"])
        self.assertTrue(p["everyOtherWeek"])
        self.assertEqual(p["timesPerWeek"], 0.5)


class SyncBankTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, RIDE_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_names_and_labels(self):
        posted = {"EAST MAIN ST. WINE": "East Main St. Wine"}
        self.assertEqual(sync.clean_name("POS DEBIT EAST MAIN ST. W", posted), "East Main St. Wine")
        self.assertEqual(sync.clean_name("POS DEBIT CORNER DELI 10/31", {}), "Corner Deli")
        merged = sync.merge_names(["Corner Mini Market And D", "Corner Mini Market And Del", "Zelle to Jonathan", "Zelle to Jonathanson"])
        self.assertEqual(merged["Corner Mini Market And D"], "Corner Mini Market And Del")
        self.assertEqual(merged.get("Zelle to Jonathan", "Zelle to Jonathan"), "Zelle to Jonathan")
        far = txn("r1", "FAIRCAB* JOHN DOE DRIVEFAIRCAB", amount=75, category="LOAN_PAYMENTS_CASH_ADVANCES")
        self.assertEqual(sync.bank_label(far, "spend", None), "Travel")
        self.assertEqual(sync.bank_label(dict(far, amount=20), "spend", None), "Rides")
        with mock.patch.dict(os.environ, {"CATEGORY_OVERRIDES": "golf place=Fun;odd app=Subscriptions=Odd App"}):
            odd = txn("o", "ODD APP INC", amount=9, category="GENERAL_SERVICES_OTHER_GENERAL_SERVICES")
            self.assertEqual(sync.bank_label(odd, "spend", None), "Subscriptions")
            self.assertEqual(sync.bank_name(odd, None), "Odd App")

    def test_whole_bank_window_fixed_flex_ids_and_holds(self):
        txns = {}
        def put(t):
            txns[t["transaction_id"]] = t
        for w in range(10):
            d = (LAST - pull.timedelta(weeks=w)).isoformat()
            put(txn(f"c{w}", "Corner Cafe", amount=10, merchant="Corner Cafe", category="FOOD_AND_DRINK_COFFEE", day=d))
            put(txn(f"b{w}", "PHONE CO", amount=50, merchant="Phone Co", category="RENT_AND_UTILITIES_TELEPHONE", day=d))
        put(txn("old", "Corner Cafe", amount=500, merchant="Corner Cafe", category="FOOD_AND_DRINK_COFFEE",
                day=(LAST - pull.timedelta(weeks=10)).isoformat()))          # 11 weeks ago: outside the window
        put(txn("s1", "POS DEBIT CORNER MINI MARKET AND D", amount=5, category="GENERAL_MERCHANDISE_CONVENIENCE_STORES", day=LAST.isoformat()))
        put(txn("s2", "CORNER MINI MARKET AND DEL", amount=6, category="GENERAL_MERCHANDISE_CONVENIENCE_STORES", day=LAST.isoformat()))
        put(dict(txn("posted-1", "Corner Cafe", amount=11, merchant="Corner Cafe", category="FOOD_AND_DRINK_COFFEE", day=MON.isoformat()),
                 pending_transaction_id="pend-1"))
        put(txn("h1", "FAIRCAB* HOLDFORDRIVER", amount=25, category="LOAN_PAYMENTS_CASH_ADVANCES", day=MON.isoformat(), pending=True))
        put(txn("z1", "Zelle payment to Pat 123", amount=40, category="TRANSFER_OUT_TRANSFER_OUT_FROM_APPS", day=LAST.isoformat()))
        put(txn("z2", "Zelle payment from Pat 456", amount=-30, category="TRANSFER_IN_TRANSFER_IN_FROM_APPS", day=LAST.isoformat()))
        b = sync.whole_bank(txns, {}, set(), LAST, MON, [])
        A = b["analysis"]
        self.assertEqual(b["usualOut"], A["outPerWeek"])
        self.assertEqual(A["outPerWeek"], 65)                     # (100 + 500 bills + 11 store + 40 Zelle) / 10
        self.assertEqual(b["flex"]["fixedUsual"], 50)
        self.assertEqual(b["flex"]["usual"], 15)
        self.assertEqual(len(b["flex"]["dayWeights"]), 7)
        self.assertEqual(A["friendsNet"], 1)
        self.assertEqual(next(c for c in A["cats"] if c["cat"] == "Sent to friends")["net"], 1)
        ids = {i["id"]: i for i in b["items"]}
        self.assertIn("pend-1", ids)                              # posted charge keeps its pending id
        self.assertNotIn("posted-1", ids)
        self.assertTrue(ids["h1"]["hold"])
        self.assertFalse(ids["pend-1"]["hold"])
        self.assertTrue(all(i["fixed"] == (i["cat"] == "Phone & bills") for i in b["items"]))
        places = {p["name"]: p for p in A["places"]}
        self.assertEqual(places["Corner Mini Market And Del"]["count"], 2)
        self.assertNotIn("Corner Mini Market And D", places)
        self.assertFalse(any(h["name"].upper().startswith("POS ") for h in b["history"]))


if __name__ == "__main__":
    unittest.main()
