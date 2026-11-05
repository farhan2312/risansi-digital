# Complaint migration — reconciliation

Run on 1 Nov 2026 against the live sales database and
`Complaint_Migration_Template_26OCT26.xlsx`, sheet **Complaints Year-2026**.
Matched on the sheet's own "Old complaint no." against `complaints.legacy_ref`.

> **Resolved 1 Nov 2026.** All three missing complaints are in as CMP-0405 to
> CMP-0407 — against UDUP01S561, the record this customer already had, not a
> new BELG01M220. The old number is now a column on the complaints table and
> sits beside the number on the detail page. The two complaints holding a
> sub-category their category does not have are corrected. What follows is the
> reconciliation as it stood before those changes.

## The short answer

373 rows in the sheet, 370 of them in the portal. **Three never imported**, all
of them MASH MAKES (SPV One) under client code `BELG01M220` — that client still
does not exist in the portal, and a complaint cannot be raised against a client
that is not there. Create the client and those three can go in.

The portal's 403 is 370 imported plus 33 raised in the portal since the import.
Nothing in the portal is missing from the sheet.

## About the numbering

Three different numbers are in play and none of them is meant to equal another.

- **CMP-0377** is the portal's own sequence, assigned in the order complaints
  arrive.
- **415** in the URL is the database row id. Ids start at 408, so id minus 407
  roughly tracks the CMP number — close enough to look broken, never exact.
- The **old number** from the sheet lives in `legacy_ref`.

CMP-0377 in particular carries no `legacy_ref` at all: it was raised in the
portal after the import, not migrated, so it has no old number to match.

Only `legacy_ref` ties a portal complaint back to the sheet, and every imported
row carries one. At the time of this reconciliation it was not shown anywhere in
the UI; it since became an “Old no.” column on the complaints table and a line on
the detail page.

## Dates are fine

A first pass appeared to show all 370 dates one day out. That was my reader, not
the data: the spreadsheet library hands back a Date built in UTC, and reading it
with local getters in IST moves every date back a day. Read from the raw Excel
serial, 369 of 370 agree.

## Four old numbers were used twice in the sheet

134, 225, 236, 237. Both rows of each pair were imported and hold different
data, so nothing was lost — but two portal complaints share one `legacy_ref`,
which makes those four impossible to match back one-to-one.

## What is left, in full

    COUNTS
      sheet rows                        373
      distinct old complaint numbers    369   (4 number(s) used twice: 134, 225, 236, 237)
      portal complaints, total          403
      …imported (carry a legacy ref)    370
      …raised in the portal since       33
    
    IN THE SHEET, NOT IN THE PORTAL — 3
      sheet row 15  no.14     BELG01M220   MASH MAKES (SPV One)                 Damage / Rubber Part
      sheet row 22  no.21     BELG01M220   MASH MAKES (SPV One)                 Supply Related / wrong
      sheet row 75  no.62     BELG01M220   MASH MAKES (SPV One)                 Damage / External
    
    IN THE PORTAL, NOT IN THE SHEET — 0
    
    MATCHED ROWS THAT DISAGREE, BY FIELD
      client           3
          CMP-0012 (no.12): portal “MOHL01S130” vs sheet “SOLN01S085”
          CMP-0134 (no.116): portal “MOHL01S130” vs sheet “SOLN01S085”
          CMP-0150 (no.122): portal “KOLH01S183” vs sheet “WARA01S192”
      date             1
          CMP-0344 (no.247): portal “2026-09-22” vs sheet “2026-09-21”
      category         3
          CMP-0188 (no.153-B): portal “damage” vs sheet “external”
          CMP-0344 (no.247): portal “damage” vs sheet “boi issue”
          CMP-0357 (no.258): portal “client related” vs sheet “supply related”
      sub-category    25
          CMP-0012 (no.12): portal “other” vs sheet “motor tripping”
          CMP-0014 (no.15): portal “—” vs sheet “leakage”
          CMP-0042 (no.37): portal “—” vs sheet “wrong supply”
          CMP-0045 (no.38): portal “wrong” vs sheet “wrong supply”
          CMP-0061 (no.49): portal “wrong” vs sheet “wrong supply”
          CMP-0074 (no.63): portal “other” vs sheet “motor bunnred”
          CMP-0075 (no.64): portal “other” vs sheet “motor tripping”
          CMP-0077 (no.66): portal “wrong” vs sheet “wrong supply”
          CMP-0029 (no.68): portal “other” vs sheet “prv”
          CMP-0097 (no.85): portal “—” vs sheet “transit damage”
          CMP-0132 (no.114): portal “—” vs sheet “external”
          CMP-0150 (no.122): portal “—” vs sheet “others”
          CMP-0160 (no.123): portal “—” vs sheet “others”
          CMP-0166 (no.132): portal “leakage” vs sheet “leakge”
          CMP-0211 (no.151): portal “—” vs sheet “others”
          CMP-0188 (no.153-B): portal “external” vs sheet “gland”
          CMP-0237 (no.173): portal “other” vs sheet “gearbox”
          CMP-0265 (no.193-A): portal “—” vs sheet “wrong”
          CMP-0266 (no.193-B): portal “—” vs sheet “wrong”
          CMP-0267 (no.193-C): portal “—” vs sheet “wrong”
          CMP-0299 (no.214-B): portal “—” vs sheet “wrong”
          CMP-0344 (no.247): portal “transit damage” vs sheet “motor”
          CMP-0354 (no.256): portal “—” vs sheet “external”
          CMP-0357 (no.258): portal “wrong order” vs sheet “wrong”
          CMP-0365 (no.265): portal “—” vs sheet “external”
      SO no.           0

## Reading the tail of that list

- **client, 3** — real. Two of them are the same swap twice over.
- **date, 1** — real. CMP-0344 is a day later in the portal.
- **category, 3** — real.
- **sub-category, 25** — mostly vocabulary rather than error. The portal holds a
  fixed list per category and the sheet is free text, so "wrong supply" landed as
  "Wrong", "leakge" as "Leakage", and anything with no home landed as "Other" or
  blank. Worth a pass if the sub-category is being reported on.
- **SO no., 0**.
