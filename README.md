# Milano’s Cash Out

I built Milano’s Cash Out to bring employee shift records, driver earnings, and store cash reconciliation into one place. A driver's pay and the cash they return to the store are different calculations, and I wanted the cash-out process to make that distinction clear.

The web app supports driver, cook, and cashier shifts, with a shared employee desk and separate management views.

## What it does

- Record shift times, including work that crosses midnight.
- Calculate hourly wages using the rate saved with each shift.
- Track delivery fees, cash tips, and online tips with bill references.
- Record cash-paid deliveries, cash received, and change given.
- Calculate driver earnings separately from cash owed to the store.
- Save shift records and provide receipts for review and printing.
- Let administrators inspect history, record corrections, review payments, and reprint receipts.
- Manage employees, their roles, and hourly rates.
- Track store cash, daily sales, supplier expenses, and operating costs.
- Plan and publish weekly staff schedules.

## Main workflows

- **Employee cash-out:** Record a shift and the earnings or cash entries relevant to the employee's role.
- **Cash reconciliation:** Review starting cash, receipts, change, and cash movements without confusing them with wages or tips owed.
- **Management review:** Find past shifts, inspect bill-level entries and correction history, and record payment review status.
- **Store planning:** Review monthly costs and sales alongside employee scheduling.

## Accounting approach

I kept money calculations in integer cents and retained the source entries behind the totals. Each shift stores its hourly rate so later rate changes do not alter historical pay.

Cash tips contribute to driver earnings, while cash owed to the store is calculated from starting cash, cash received, and change given. Receipts show the resulting totals, and management views provide the underlying detail.

Amounts are in Canadian dollars. Printing uses the browser's print interface; saving a record and physically printing a receipt are separate actions.
