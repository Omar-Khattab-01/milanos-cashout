import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ref, set, get, update, remove } from "firebase/database";
let env: RulesTestEnvironment;
const db = (uid: string) => env.authenticatedContext(uid).database();
const now = Date.now(),
  start = Math.floor((now - 8 * 3600000) / 60000) * 60000,
  end = start + 7 * 3600000;
const record = {
  id: "shift",
  schemaVersion: 3,
  employeeId: "alex",
  employeeName: "Alex",
  start,
  end,
  rateCents: 1300,
  deliveries: {
    e000: { amountCents: 1000, billNumber: "101" },
    e001: { amountCents: 500, billNumber: "102" },
    e002: { amountCents: 750, billNumber: "103" },
  },
  tips: { e000: { amountCents: 250, billNumber: "104" } },
  createdBy: "kiosk",
  createdAt: now,
};
const correction = {
  employeeId: "alex",
  employeeName: "Alex",
  start,
  end,
  rateCents: 1300,
  deliveries: { e000: { amountCents: 1000, billNumber: "101" } },
  tips: { e000: { amountCents: 500, billNumber: "104" } },
  reason: "Correct tip",
  editedBy: "admin",
  editedAt: now,
};
describe.skipIf(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)(
  "database access boundaries",
  () => {
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-milanos",
        database: { rules: readFileSync("database.rules.json", "utf8") },
      });
    });
    beforeEach(async () => {
      await env.clearDatabase();
      await env.withSecurityRulesDisabled(async (c) => {
        await set(ref(c.database()), {
          admins: { admin: true },
          devices: { kiosk: true },
          employees: { alex: { name: "Alex", active: true } },
          settings: { rateCents: 1300 },
        });
      });
    });
    afterAll(async () => {
      await env.cleanup();
    });
    it("allows the paired PC to submit and denies the public", async () => {
      await assertSucceeds(set(ref(db("kiosk"), "cashouts/shift"), record));
      await assertFails(
        set(ref(db("stranger"), "cashouts/another"), {
          ...record,
          id: "another",
          createdBy: "stranger",
        }),
      );
      await assertFails(get(ref(db("stranger"), "employees")));
    });
    it("lets an admin authorize a new store computer once", async () => {
      await assertFails(get(ref(db("new-computer"), "employees")));
      await assertSucceeds(
        set(ref(db("admin"), "devices/new-computer"), true),
      );
      await assertSucceeds(get(ref(db("new-computer"), "employees")));
      await assertFails(
        set(ref(db("new-computer"), "devices/another-computer"), true),
      );
    });
    it("protects history and settings from drivers", async () => {
      await assertFails(get(ref(db("kiosk"), "cashouts")));
      await assertFails(set(ref(db("kiosk"), "settings/rateCents"), 900));
      await assertFails(set(ref(db("kiosk"), "admins/kiosk"), true));
      await assertSucceeds(get(ref(db("admin"), "cashouts")));
    });
    it("allows only admins to update valid cash-out review states", async () => {
      await set(ref(db("kiosk"), "cashouts/shift"), record);
      const reviewed = {
        status: "reviewed",
        updatedAt: Date.now(),
        updatedBy: "admin",
      };
      await assertFails(
        set(ref(db("kiosk"), "cashoutReviews/shift"), {
          ...reviewed,
          updatedBy: "kiosk",
        }),
      );
      await assertSucceeds(
        set(ref(db("admin"), "cashoutReviews/shift"), reviewed),
      );
      await assertSucceeds(
        set(ref(db("admin"), "cashoutReviews/shift"), {
          ...reviewed,
          status: "under_review",
        }),
      );
      await assertFails(
        set(ref(db("admin"), "cashoutReviews/shift"), {
          ...reviewed,
          status: "unpaid",
        }),
      );
      await assertFails(get(ref(db("kiosk"), "cashoutReviews")));
    });
    it("rejects altered rates and every malformed money entry", async () => {
      await assertFails(
        set(ref(db("kiosk"), "cashouts/shift"), { ...record, rateCents: 2000 }),
      );
      for (const amount of [-1, 0, 1.2, "100", 100001])
        await assertFails(
          set(ref(db("kiosk"), "cashouts/shift"), {
            ...record,
            tips: { e000: { amountCents: amount, billNumber: "104" } },
          }),
        );
    });
    it("rejects name spoofing, invalid durations and injected corrections", async () => {
      await assertFails(
        set(ref(db("kiosk"), "cashouts/shift"), {
          ...record,
          employeeName: "Other",
        }),
      );
      await assertFails(
        set(ref(db("kiosk"), "cashouts/shift"), { ...record, end: start }),
      );
      await assertFails(
        set(ref(db("kiosk"), "cashouts/shift"), {
          ...record,
          corrections: { x: correction },
        }),
      );
    });
    it("preserves original records, allows corrections, and lets admins delete shifts", async () => {
      await assertSucceeds(set(ref(db("kiosk"), "cashouts/shift"), record));
      await assertFails(
        update(ref(db("admin"), "cashouts/shift"), { end: end + 60000 }),
      );
      await assertFails(
        set(ref(db("kiosk"), "cashouts/shift/corrections/x"), correction),
      );
      await assertSucceeds(
        set(ref(db("admin"), "cashouts/shift/corrections/x"), correction),
      );
      await assertFails(
        update(ref(db("admin"), "cashouts/shift/corrections/x"), {
          reason: "Overwritten",
        }),
      );
      await assertFails(
        remove(ref(db("admin"), "cashouts/shift/corrections/x")),
      );
      expect(
        (
          await get(ref(db("admin"), "cashouts/shift/tips/e000/amountCents"))
        ).val(),
      ).toBe(250);
      await set(ref(db("admin"), "cashoutReviews/shift"), {
        status: "reviewed",
        updatedAt: Date.now(),
        updatedBy: "admin",
      });
      await assertSucceeds(
        update(ref(db("admin")), {
          "cashouts/shift": null,
          "cashoutReviews/shift": null,
        }),
      );
    });
    it("validates online tips and cash-delivery fields server-side", async () => {
      const cash = {
        billNumber: "005",
        billTotalCents: 4200,
      };
      await assertSucceeds(
        set(ref(db("kiosk"), "cashouts/shift"), {
          ...record,
          onlineTips: { e000: { amountCents: 350, billNumber: "006" } },
          startingCashCents: 5000,
          cashDeliveries: { e000: cash },
        }),
      );
      for (const payload of [
        { ...record, id: "bad", onlineTips: { e000: { amountCents: 350 } } },
        {
          ...record,
          id: "bad",
          cashDeliveries: { e000: { ...cash, unexpected: 900 } },
        },
        { ...record, id: "bad", startingCashCents: -1 },
        { ...record, id: "bad", tips: { e000: 200 } },
      ])
        await assertFails(set(ref(db("kiosk"), "cashouts/bad"), payload));
    });
    it("allows a future end and keeps legacy records readable and correctable", async () => {
      const start = Math.floor((Date.now() - 3600000) / 60000) * 60000;
      await assertSucceeds(
        set(ref(db("kiosk"), "cashouts/shift"), {
          ...record,
          start,
          end: start + 2 * 3600000,
        }),
      );
      await env.withSecurityRulesDisabled(async (c) =>
        set(ref(c.database(), "cashouts/legacy"), {
          ...record,
          id: "legacy",
          schemaVersion: null,
          tips: { e000: 250 },
          deliveries: { e000: 1000 },
        }),
      );
      await assertSucceeds(
        set(ref(db("admin"), "cashouts/legacy/corrections/x"), {
          ...correction,
          tips: { e000: 250 },
          deliveries: { e000: 1000 },
        }),
      );
    });
    it("retains rate snapshot during correction and after settings change", async () => {
      await set(ref(db("kiosk"), "cashouts/shift"), record);
      await set(ref(db("admin"), "settings/rateCents"), 1500);
      await assertSucceeds(
        set(ref(db("admin"), "cashouts/shift/corrections/x"), correction),
      );
      await assertFails(
        set(ref(db("admin"), "cashouts/shift/corrections/y"), {
          ...correction,
          rateCents: 1500,
        }),
      );
    });
    it("allows admin employee deletion and protects company expenses", async () => {
      await assertSucceeds(
        set(ref(db("admin"), "employees/alex"), {
          name: "Alex Morgan",
          phone: "416-555-0101",
        }),
      );
      expect((await get(ref(db("admin"), "employees/alex/phone"))).val()).toBe(
        "416-555-0101",
      );
      await assertSucceeds(remove(ref(db("admin"), "employees/alex")));
      await assertFails(set(ref(db("kiosk"), "companies/supplier"), { name: "Supplier" }));
      await assertSucceeds(set(ref(db("admin"), "companies/supplier"), { name: "Supplier" }));
      await assertSucceeds(
        set(ref(db("admin"), "expenses/order"), {
          id: "order",
          companyId: "supplier",
          companyName: "Supplier",
          date: "2026-09-17",
          amountCents: 12500,
          createdAt: Date.now(),
          createdBy: "admin",
        }),
      );
      await assertFails(get(ref(db("kiosk"), "expenses")));
      await assertSucceeds(remove(ref(db("admin"), "expenses/order")));
    });
  },
);
