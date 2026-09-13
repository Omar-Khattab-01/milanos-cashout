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
  employeeId: "alex",
  employeeName: "Alex",
  start,
  end,
  rateCents: 1300,
  deliveries: { e000: 1000, e001: 500, e002: 750 },
  tips: { e000: 250 },
  createdBy: "kiosk",
  createdAt: now,
};
const correction = {
  employeeId: "alex",
  employeeName: "Alex",
  start,
  end,
  rateCents: 1300,
  deliveries: { e000: 1000 },
  tips: { e000: 500 },
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
    it("protects history and settings from drivers", async () => {
      await assertFails(get(ref(db("kiosk"), "cashouts")));
      await assertFails(set(ref(db("kiosk"), "settings/rateCents"), 900));
      await assertFails(set(ref(db("kiosk"), "admins/kiosk"), true));
      await assertSucceeds(get(ref(db("admin"), "cashouts")));
    });
    it("rejects altered rates and every malformed money entry", async () => {
      await assertFails(
        set(ref(db("kiosk"), "cashouts/shift"), { ...record, rateCents: 2000 }),
      );
      for (const amount of [-1, 0, 1.2, "100", 100001])
        await assertFails(
          set(ref(db("kiosk"), "cashouts/shift"), {
            ...record,
            tips: { e000: amount },
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
    it("preserves original records and allows only append-only admin corrections", async () => {
      await assertSucceeds(set(ref(db("kiosk"), "cashouts/shift"), record));
      await assertFails(
        update(ref(db("admin"), "cashouts/shift"), { end: end + 60000 }),
      );
      await assertFails(remove(ref(db("admin"), "cashouts/shift")));
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
        (await get(ref(db("admin"), "cashouts/shift/tips/e000"))).val(),
      ).toBe(250);
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
  },
);
