"""Convert your existing PAYMENTS sheet into payments-template.csv.
direction must be 'in' (from client) or 'out' (to writer/vendor).
EDIT `MAPPING`. python convert_payments.py your_payments.csv payments.out.csv
"""
from _lib import run

HEADERS = ["direction", "counterpartyName", "amount", "paidAt", "medium", "trxId", "note"]
MAPPING = {
    "direction": "Direction",       # values should be in/out (map yours if different)
    "counterpartyName": "Name",
    "amount": "Amount",
    "paidAt": "Date",               # YYYY-MM-DD
    "medium": "Method",
    "trxId": "Txn",
    "note": "Note",
}

if __name__ == "__main__":
    run(HEADERS, MAPPING)
