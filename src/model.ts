export type Employee = { name: string; active: boolean };
export type Shift = {
  employeeId: string;
  employeeName: string;
  start: number;
  end: number;
  rateCents: number;
  deliveries?: Record<string, number>;
  tips?: Record<string, number>;
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
export const total = (items: Record<string, number> = {}) =>
  Object.values(items).reduce((sum, n) => sum + n, 0);
export function totals(s: Shift) {
  const minutes = (s.end - s.start) / 60000;
  const wages = Math.round((minutes * s.rateCents) / 60);
  const deliveries = total(s.deliveries),
    tips = total(s.tips);
  return { minutes, wages, deliveries, tips, total: wages + deliveries + tips };
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
  if (s.end > Date.now() + 60000)
    throw new Error("Your shift cannot end in the future.");
  if (!Number.isInteger(s.rateCents) || s.rateCents < 1 || s.rateCents > 100000)
    throw new Error("The hourly rate is invalid.");
  for (const list of [s.deliveries, s.tips]) {
    if (Object.keys(list || {}).length > 200)
      throw new Error("A maximum of 200 entries is supported per section.");
    if (
      Object.values(list || {}).some(
        (n) => !Number.isInteger(n) || n < 1 || n > 100000,
      )
    )
      throw new Error("An entry amount is invalid.");
  }
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
