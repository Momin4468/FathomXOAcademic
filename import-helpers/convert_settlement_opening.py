"""Build the 2025 OPENING settlement position (Emon<->Momin) — NOT job detail.
One row: the opening balance and who owes whom at the 2025->2026 boundary.
EDIT `MAPPING`. python convert_settlement_opening.py your_2025.csv settlement_opening.out.csv
"""
from _lib import run

HEADERS = ["fromPartyName", "toPartyName", "amount", "asOfDate", "note"]
MAPPING = {
    "fromPartyName": "From",        # the partner who owes (must already exist in the app)
    "toPartyName": "To",            # the partner owed
    "amount": "OpeningBalance",
    "asOfDate": "AsOf",             # defaults to 2026-01-01 if blank
    "note": "Note",
}

if __name__ == "__main__":
    run(HEADERS, MAPPING)
