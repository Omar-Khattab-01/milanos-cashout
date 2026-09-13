import { describe, it, expect } from "vitest";
import {
  cents,
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
  it("calculates overnight hours, wages, and every entry", () => {
    validateShift(shift);
    expect(totals(shift)).toEqual({
      minutes: 510,
      wages: 11050,
      deliveries: 2250,
      tips: 600,
      total: 13900,
    });
  });
  it("rounds wages once at the end, to the nearest cent", () =>
    expect(totals({ ...shift, end: shift.start + 60000 }).wages).toBe(22));
  it("rejects zero, reversed, oversized, invalid, and future shifts", () => {
    for (const end of [
      shift.start,
      shift.start - 60000,
      shift.start + 25 * 3600000,
      NaN,
      Date.now() + 86400000,
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
