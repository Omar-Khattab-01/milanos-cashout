import { describe, it, expect } from "vitest";
import {
  cents,
  salesCents,
  storeCashAmount,
  cashTotals,
  billNumber,
  totals,
  current,
  validateShift,
  type Cashout,
  type Shift,
} from "../src/model";
const shift: Shift = {
  employeeId: "driver",
  employeeName: "Alex",
  start: Date.parse("2026-08-01T18:00:00Z"),
  end: Date.parse("2026-08-02T02:30:00Z"),
  rateCents: 1300,
  deliveries: { a: 1000, b: 500, c: 750 },
  tips: { a: 225, b: 375 },
};
describe("cash-out accounting", () => {
  it("keeps cents exact and rejects malformed input", () => {
    expect(cents("7.50")).toBe(750);
    for (const n of ["1.005", "-3", "0", "1e2", "NaN", "1001"])
      expect(() => cents(n)).toThrow();
  });
  it("accepts zero and larger daily sales amounts without losing cents", () => {
    expect(salesCents("0.00")).toBe(0);
    expect(salesCents("12345.67")).toBe(1234567);
    for (const n of ["-1", "1.005", "100000.01"])
      expect(() => salesCents(n)).toThrow();
  });
  it("uses the latest store-cash correction while retaining the original", () => {
    const entry = {
      id: "cash",
      billNumber: "1042",
      date: "2026-09-20",
      amountCents: 3000,
      createdAt: 1,
      createdBy: "kiosk",
      corrections: {
        first: { amountCents: 3200, editedAt: 2, editedBy: "kiosk" },
        latest: { amountCents: 0, editedAt: 3, editedBy: "kiosk" },
      },
    };
    expect(storeCashAmount(entry)).toBe(0);
    expect(entry.amountCents).toBe(3000);
  });
  it("calculates overnight hours, wages, and every entry", () => {
    validateShift(shift);
    expect(totals(shift)).toEqual({
      minutes: 510,
      wages: 11050,
      deliveries: 2250,
      tips: 600,
      onlineTips: 0,
      cashTips: 0,
      total: 13900,
    });
  });
  it("rounds wages once at the end, to the nearest cent", () =>
    expect(totals({ ...shift, end: shift.start + 60000 }).wages).toBe(22));
  it("adds delivery fees embedded in tip, online-tip, and cash-order entries", () => {
    const result = totals({
      ...shift,
      tips: { a: { billNumber: "10", amountCents: 200, deliveryFeeCents: 500 } },
      onlineTips: { a: { billNumber: "11", amountCents: 300, deliveryFeeCents: 250 } },
      cashDeliveries: { a: { billNumber: "12", billTotalCents: 4000, deliveryFeeCents: 100 } },
    });
    expect(result.deliveries).toBe(3100);
    expect(result.total).toBe(14650);
  });
  it("rejects zero, reversed, oversized and invalid shifts", () => {
    for (const end of [
      shift.start,
      shift.start - 60000,
      shift.start + 25 * 3600000,
      NaN,
    ])
      expect(() => validateShift({ ...shift, end })).toThrow();
  });
  it("rejects corrupted monetary entries", () =>
    expect(() => validateShift({ ...shift, tips: { a: -50 } })).toThrow());
  it("uses the newest correction without changing the original rate or entries", () => {
    const r: Cashout = {
      ...shift,
      id: "id",
      createdBy: "uid",
      createdAt: 1,
      corrections: {
        a: {
          ...shift,
          tips: { a: 700 },
          reason: "Tip missed",
          editedBy: "admin",
          editedAt: 3,
        },
        b: {
          ...shift,
          tips: { a: 800 },
          reason: "Correct amount",
          editedBy: "admin",
          editedAt: 4,
        },
      },
    };
    expect(totals(current(r)).tips).toBe(800);
    expect(totals(r).tips).toBe(600);
    expect(current(r).rateCents).toBe(1300);
  });
});

describe("bill-linked cash-out entries", () => {
  it("calculates hourly-only cook and cashier cash-outs", () => {
    const cook: Shift = {
      employeeId: "cook",
      employeeName: "Chris",
      employeeRole: "cook",
      start: shift.start,
      end: shift.start + 5 * 3600000,
      rateCents: 1500,
    };
    validateShift(cook);
    expect(totals(cook)).toMatchObject({ wages: 7500, total: 7500 });
    expect(() =>
      validateShift({ ...cook, employeeRole: "manager" as "cook" }),
    ).toThrow(/role/);
    expect(() =>
      validateShift({ ...cook, tips: { e000: 500 } }),
    ).toThrow(/worked hours/);
  });
  it("allows a future end time while preserving duration limits", () => {
    const start = Math.floor((Date.now() - 3600000) / 60000) * 60000;
    expect(() =>
      validateShift({ ...shift, start, end: start + 2 * 3600000 }),
    ).not.toThrow();
  });
  it("preserves bill leading zeroes and rejects invalid identifiers", () => {
    expect(billNumber("00123")).toBe("00123");
    expect(() => billNumber("")).toThrow();
    expect(() => billNumber("<script>")).toThrow();
  });
  it("separates online tips, calculated cash tips, and cash owed", () => {
    const s: Shift = {
      ...shift,
      deliveries: { e000: { amountCents: 750, billNumber: "001" } },
      tips: { e000: { amountCents: 300, billNumber: "002" } },
      onlineTips: { e000: { amountCents: 500, billNumber: "003" } },
      startingCashCents: 5000,
      cashDeliveries: {
        e000: {
          billNumber: "004",
          billTotalCents: 4200,
          cashCollectedCents: 5000,
          changeGivenCents: 300,
        },
        e001: {
          billNumber: "005",
          billTotalCents: 2000,
          cashCollectedCents: 2000,
          changeGivenCents: 0,
        },
      },
    };
    validateShift(s);
    expect(cashTotals(s)).toEqual({
      startingCash: 5000,
      billTotals: 6200,
      received: 7000,
      change: 300,
      collected: 6700,
      tips: 500,
      owed: 11700,
    });
    expect(totals(s)).toMatchObject({
      deliveries: 750,
      tips: 300,
      onlineTips: 500,
      cashTips: 500,
      total: 13100,
    });
  });
  it("keeps old cash records valid and allows split-payment bill numbers", () => {
    const cash = {
      billNumber: "001",
      billTotalCents: 4200,
      cashCollectedCents: 5000,
      changeGivenCents: 900,
    };
    expect(() =>
      validateShift({ ...shift, cashDeliveries: { e000: cash } }),
    ).toThrow(/cover/);
    expect(() =>
      validateShift({
        ...shift,
        schemaVersion: 3,
        cashDeliveries: {
          e000: { billNumber: "001", billTotalCents: 4200 },
        },
        tips: { e000: { amountCents: 500, billNumber: "001" } },
      }),
    ).not.toThrow();
    expect(
      cashTotals({
        ...shift,
        startingCashCents: 5000,
        cashDeliveries: {
          e000: { billNumber: "001", billTotalCents: 4200 },
        },
      }).owed,
    ).toBe(9200);
  });
});
