# Import helpers — getting your data into Business OS

There are **three ways** to create records. Pick whichever fits the data you have.

| Path | Best for | How |
|---|---|---|
| **1. Manual template** | A handful of records, or a clean source | In the app: **Data → Import**, pick an entity, **download the template**, fill it, upload → preview → commit. |
| **2. Script preprocess** | Bulk data in your own existing sheet layout | Run a helper script here to convert your sheet into the template CSV, then upload that in the app (path 1). |
| **3. AI capture** | Messy/unstructured notes, WhatsApp, a photo, a voice note | In the app: **AI capture** → it proposes drafts → you accept. |

All three end the same way: **records are proposed/staged and only created when you confirm**, through the normal validation + governance, marked with their provenance ("added by import" / "added by AI").

## The templates (the format spec)

`templates/` holds the canonical CSV templates — exact headers + one filled sample row. They are also served live by the app (Data → Import → Download template). Headers are **human-friendly**: you write names and codes, not internal IDs.

- `clients.csv` — `displayName, partyType, externalRef, universityName, programme, contactEmail, contactPhone, referredByName`
- `jobs.csv` — `title, clientName, courseCode, assignmentType, doerName, details, notes`
- `payments.csv` — `direction, counterpartyName, amount, paidAt, medium, trxId, note`
- `settlement_opening.csv` — `fromPartyName, toPartyName, amount, asOfDate, note`

**Canonicalisation:** every `universityName` / `courseCode` / `assignmentType` is routed through the reference resolver on commit, so "ICT 701", "ICT701" and "701" all map to the **same** canonical entity — no duplicates. Clients/counterparties are matched by name; an unknown one is **created** (you'll see "will create new client X" in the preview).

## Recommended order

Import **clients first**, then **jobs**, then **payments** — so jobs/payments can match the clients you already created. (Unknown clients are still auto-created, but importing clients first keeps names clean.)

## Policy: 2025 vs 2026

- **2025 is settlement-only.** The source lacks exact writer/timeline data, so do **not** fabricate job-by-job detail. Import only the **opening Emon↔Momin settlement position** via `settlement_opening.csv` (an opening balance dated at the 2025→2026 boundary). Put the actual 2025 spreadsheet in the **Archive** (Data → Archive) for the record.
- **2026 onward is full records** (clients, jobs, payments).

## Using the scripts

Each `convert_*.py` reads your existing sheet (CSV, or Excel with `pip install openpyxl`) and writes the matching template CSV. **Edit the `MAPPING` at the top of each script** to point your source column names at the target headers, then run:

```
python convert_clients.py  your_clients_sheet.xlsx  clients.out.csv
python convert_jobs.py     your_jobs_sheet.csv      jobs.out.csv
python convert_payments.py your_payments.csv        payments.out.csv
```

Then upload the `*.out.csv` in **Data → Import**. Review the preview, fix anything flagged, and commit. These scripts are **examples** — they ship with sample mappings you adapt to your real column headers; they never talk to the app or the database.
