"""Offline tests: no Plaid keys needed. Run with `python3 -m unittest test_pull`."""

import csv
import os
import tempfile
import unittest
from unittest import mock

import pull


def txn(tid, name, amount=12.5, merchant=None, category="", counterparties=None, day="2026-10-20", pending=False):
    return {
        "transaction_id": tid, "name": name, "merchant_name": merchant, "amount": amount,
        "date": day, "authorized_date": day, "authorized_datetime": f"{day}T23:15:00Z",
        "personal_finance_category": {"detailed": category}, "counterparties": counterparties or [],
        "pending": pending, "account_id": "SECRET-ACCOUNT", "location": {"city": "New York"},
    }


class ClassifyTest(unittest.TestCase):
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
        t = txn("13", "RIDEAPP* JANE DOE DRIVERIDEAPP. VA 10/29", merchant="Lower-fare app",
                category="LOAN_PAYMENTS_CASH_ADVANCES")
        self.assertEqual(pull.classify(t), "ride")

    def test_cash_advance_app_and_zelle_are_not_rides(self):
        self.assertIsNone(pull.classify(txn("14", "RIDEAPP FINANCE INC", merchant="Lower-fare app",
                                            category="LOAN_PAYMENTS_CASH_ADVANCES")))
        self.assertIsNone(pull.classify(txn("15", "Zelle payment to Lower-fare app JPM00EXAMPLE", merchant="Lower-fare app",
                                            category="LOAN_PAYMENTS_CASH_ADVANCES")))

    def test_other_food_and_getting_around_kinds(self):
        self.assertEqual(pull.classify(txn("8", "Starbucks", merchant="Starbucks", category="FOOD_AND_DRINK_COFFEE")), "quick_food")
        self.assertEqual(pull.classify(txn("9", "Trader Joe's", category="FOOD_AND_DRINK_GROCERIES")), "groceries")
        self.assertEqual(pull.classify(txn("10", "MTA*NYCT PAYGO", category="TRANSPORTATION_PUBLIC_TRANSIT")), "transit")
        self.assertEqual(pull.classify(txn("16", "Cava", category="FOOD_AND_DRINK_RESTAURANT")), "dining")
        self.assertEqual(pull.classify(txn("17", "Corner Bar", category="FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR")), "drinks")
        self.assertEqual(pull.classify(txn("22", "POS DEBIT CORNER MINI MARKET AND D", category="GENERAL_MERCHANDISE_CONVENIENCE_STORES")), "drinks")
        self.assertEqual(pull.classify(txn("23", "POS DEBIT MAIN ST. WINE", category="GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE")), "drinks")
        self.assertEqual(pull.classify(txn("24", "POS DEBIT RIDEAPP* HOLDFORDRIVER +1831", merchant="Lower-fare app", category="LOAN_PAYMENTS_CASH_ADVANCES")), "ride")

    def test_intercity_trains_dropped(self):
        self.assertIsNone(pull.classify(txn("21", "Amtrak", merchant="Amtrak", category="TRANSPORTATION_PUBLIC_TRANSIT")))

    def test_everything_else_dropped(self):
        self.assertIsNone(pull.classify(txn("18", "Grailed", category="GENERAL_MERCHANDISE_ONLINE_MARKETPLACES")))
        self.assertIsNone(pull.classify(txn("19", "Payroll", amount=-900, category="INCOME_SALARY")))
        self.assertIsNone(pull.classify(txn("20", "Rent", category="RENT_AND_UTILITIES_RENT")))


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


if __name__ == "__main__":
    unittest.main()
