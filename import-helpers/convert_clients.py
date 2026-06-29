"""Convert your existing CLIENTS sheet into clients-template.csv.

EDIT `MAPPING` so each target header points at YOUR source column name
(left = template header, right = your sheet's column). Leave "" to skip.
Then: python convert_clients.py your_clients.xlsx clients.out.csv
"""
from _lib import run

HEADERS = ["displayName", "partyType", "externalRef", "universityName",
           "programme", "contactEmail", "contactPhone", "referredByName"]

# target_header -> YOUR source column name (example values shown — edit these)
MAPPING = {
    "displayName": "Student Name",
    "externalRef": "Student ID",
    "universityName": "University",
    "programme": "Program",
    "contactEmail": "Email",
    "contactPhone": "Phone",
    "referredByName": "Referred By",
}
CONSTANTS = {"partyType": "client"}  # every row is a client unless your sheet says otherwise

if __name__ == "__main__":
    run(HEADERS, MAPPING, CONSTANTS)
