export type Employee = { name: string; active: boolean };
export type BillEntry = { amountCents: number; billNumber: string };
export type Entry = number | BillEntry; // Historic records predate bill numbers.
export type EntryList = Record<string, Entry>;
export type CashDelivery = {
  billNumber: string;
  billTotalCents: number;
  cashCollectedCents: number;
  changeGivenCents: number;
};
export type Shift = {
  schemaVersion?: 2;
  employeeId: string;
  employeeName: string;
  start: number;
  end: number;
  rateCents: number;
  deliveries?: EntryList;
  tips?: EntryList;
  onlineTips?: EntryList;
  startingCashCents?: number;
  cashDeliveries?: Record<string, CashDelivery>;
};
export type Correction = Shift & {
  reason: string;
  editedBy: string;
  editedAt: number;
};
export type Cashout = Shift & {
  id: string;
  createdBy: string;
  createdAt: number;
  corrections?: Record<string, Correction>;
};
export const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );
export function cents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a dollar amount with up to two decimal places.");
  const n = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 100000)
    throw new Error("Enter an amount between $0.01 and $1,000.00.");
  return n;
}
export const amountOf = (entry: Entry) =>
  typeof entry === "number" ? entry : entry.amountCents;
export const billOf = (entry: Entry) =>
  typeof entry === "number" ? "Not recorded (legacy)" : entry.billNumber;
export const total = (items: EntryList = {}) =>
  Object.values(items).reduce<number>((sum, entry) => sum + amountOf(entry), 0);
export function billNumber(value: string) {
  const bill = value.trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(bill))
    throw new Error(
      "Enter a bill number using letters, numbers, or hyphens (up to 40 characters).",
    );
  return bill;
}
export const cashCents = (value: string) =>
  /^0(?:\.0{1,2})?$/.test(value.trim()) ? 0 : cents(value);
export function cashTotals(s: Shift) {
  const entries = Object.values(s.cashDeliveries || {});
  const startingCash = s.startingCashCents || 0;
  const billTotals = entries.reduce((n, e) => n + e.billTotalCents, 0);
  const received = entries.reduce((n, e) => n + e.cashCollectedCents, 0);
  const change = entries.reduce((n, e) => n + e.changeGivenCents, 0);
  const collected = received - change;
  const tips = entries.reduce(
    (n, e) => n + e.cashCollectedCents - e.changeGivenCents - e.billTotalCents,
    0,
  );
  return {
    startingCash,
    billTotals,
    received,
    change,
    collected,
    tips,
    owed: startingCash + collected,
  };
}
export function totals(s: Shift) {
  const minutes = (s.end - s.start) / 60000;
  const wages = Math.round((minutes * s.rateCents) / 60);
  const deliveries = total(s.deliveries),
    tips = total(s.tips),
    onlineTips = total(s.onlineTips);
  const cashTips = cashTotals(s).tips;
  return {
    minutes,
    wages,
    deliveries,
    tips,
    onlineTips,
    cashTips,
    total: wages + deliveries + tips + onlineTips + cashTips,
  };
}
export function validateShift(s: Shift) {
  if (!s.employeeId || !s.employeeName.trim())
    throw new Error("Select your name.");
  if (
    !Number.isFinite(s.start) ||
    !Number.isFinite(s.end) ||
    s.start % 60000 ||
    s.end % 60000 ||
    s.end <= s.start ||
    s.end - s.start > 24 * 3600000
  )
    throw new Error(
      "Enter a shift longer than zero and no longer than 24 hours. Check the end date for overnight shifts.",
    );

  if (s.start > Date.now())
    throw new Error("The shift start cannot be in the future.");
  if (!Number.isInteger(s.rateCents) || s.rateCents < 1 || s.rateCents > 100000)
    throw new Error("The hourly rate is invalid.");
  for (const list of [s.deliveries, s.tips, s.onlineTips]) {
    if (Object.keys(list || {}).length > 200)
      throw new Error("A maximum of 200 entries is supported per section.");
    if (
      Object.values(list || {}).some(
        (entry) =>
          !Number.isInteger(amountOf(entry)) ||
          amountOf(entry) < 1 ||
          amountOf(entry) > 100000,
      )
    )
      throw new Error("An entry amount is invalid.");
    for (const entry of Object.values(list || {}))
      if (typeof entry !== "number") billNumber(entry.billNumber);
  }
  if (
    !Number.isInteger(s.startingCashCents ?? 0) ||
    (s.startingCashCents ?? 0) < 0 ||
    (s.startingCashCents ?? 0) > 100000
  )
    throw new Error("Starting cash must be between $0.00 and $1,000.00.");
  const cashEntries = Object.values(s.cashDeliveries || {});
  if (cashEntries.length > 200)
    throw new Error("Maximum 200 cash deliveries per shift.");
  for (const e of cashEntries) {
    billNumber(e.billNumber);
    if (
      !Number.isInteger(e.billTotalCents) ||
      e.billTotalCents <= 0 ||
      e.billTotalCents > 100000 ||
      !Number.isInteger(e.cashCollectedCents) ||
      e.cashCollectedCents < 0 ||
      e.cashCollectedCents > 100000 ||
      !Number.isInteger(e.changeGivenCents) ||
      e.changeGivenCents < 0 ||
      e.changeGivenCents > 100000
    )
      throw new Error("Cash-delivery totals are invalid.");
    if (e.cashCollectedCents - e.changeGivenCents < e.billTotalCents)
      throw new Error("Cash received minus change must cover the bill total.");
  }
  const cashBills = new Set(cashEntries.map((e) => e.billNumber.toLowerCase()));
  for (const e of Object.values(s.tips || {}))
    if (typeof e !== "number" && cashBills.has(e.billNumber.toLowerCase()))
      throw new Error(
        "Cash-delivery tips are automatic. Remove the separate tip for that bill.",
      );
  if (
    new Set(cashEntries.map((e) => e.billNumber.toLowerCase())).size !==
    cashEntries.length
  )
    throw new Error("A bill can only be entered once in Cash deliveries.");
}
export function current(c: Cashout): Shift {
  const corrections = Object.values(c.corrections || {}).sort(
    (a, b) => b.editedAt - a.editedAt,
  );
  return corrections[0] || c;
}
export function localInput(time: number) {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export const hours = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
