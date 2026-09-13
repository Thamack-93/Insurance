# PDF evaluation set

PDF-assisted financial and quote workflows require a sanitized, human-reviewed
fixture catalog before they are enabled for an organization.

Each fixture records insurer, document type, text/scanned status, page count,
expected normalized fields, expected row count and totals, and source-page
references. Keep statements and auto quote PDFs separate because their
accuracy criteria differ.

Required measures:

- field completeness and source-page coverage;
- policy/receipt identity match precision;
- currency and amount accuracy, including cents;
- statement row and total preservation;
- quote vehicle, coverage period, limit, deductible, exclusion, and validity accuracy.

Mocked extraction tests prove review and rejection behavior. Controlled runs
against the configured extraction/AI provider are separate evidence and must
never silently approve uncertain financial or coverage values.
