# Milano’s driver cash-outs

A store-PC web app for driver shift cash-outs. TypeScript + Vite, Firebase Authentication and Realtime Database. Currency is CAD. Default hourly rate is $13, stored centrally and snapshotted per submission.

## Driver flow

Select a name and enter start/end times at the end of the shift. Both dates default to today, with an optional date adjustment for overnight shifts. Future end times are allowed; shifts must still have a positive duration of at most 24 hours. Add individual delivery fees, tips, and online tips with bill numbers, then choose Done in each section. Space from an amount moves to the bill-number field; Enter adds the entry and returns focus to the amount. Save & print waits for database confirmation before opening the browser print dialog. Cancelling printing does not cancel the saved record. Receipts show driver, dates/times, hours, separate pay/tip totals, starting cash, cash received, change, and cash owed to the store, without itemized bill entries. The 80 mm layout uses the store PC’s installed printer driver. Direct Epson integration is intentionally deferred.

### Cash handling

Starting cash defaults to $0.00. Each cash-paid bill records its bill number, bill total, cash received **before change**, and change given (default zero). Calculated tip = cash received − change given − bill total. Underpaid bills and negative change are rejected. Cash tips are automatically included in total earnings; the same cash bill cannot also be added to the manual Tips section through the form.

Earnings are paid separately. **Cash owed to store = starting cash + all cash received − all change given**, including cash tips. Wages, delivery fees, and tips are not deducted from cash owed. Example: $50 starting cash, a $42 bill, $50 received, and $3 change gives a $5 tip and $97 owed to the store. All source values are retained for admin inspection and correction.

## Admin flow

A four-digit admin PIN, verified by Firebase Authentication, protects employee management, hourly-rate settings, full history, entry inspection, corrections and reprints. Admin rights are an explicit database allowlist. The correct PIN is never embedded in the website. Corrections append an immutable full snapshot with reason, editor and time; originals cannot be overwritten or deleted through the application. Old shifts and corrections retain the original hourly rate. Employee deactivation retains history. The app converts the supplied PIN to a SHA-256 credential using the namespace `milanos-admin-pin-v1:` and submits it to Firebase’s password authentication for the existing admin account. This encoding meets the password-format requirements; a four-digit PIN still has only 10,000 possibilities. Firebase handles credential checking and throttling.

## Run locally

Use Node 22+ and `npm ci`, then `npm run dev`. Without Firebase configuration, the app runs a clearly labeled **in-memory demonstration** with sample employees. Demo data disappears on reload and is never used as a production fallback after a Firebase error.

Copy `.env.example` to `.env.local` and supply the Firebase web app configuration. These web config values identify the project; access is enforced by database rules. Never commit service-account keys, user passwords or deployment tokens.

## Firebase setup

1. Create a Firebase project on Spark and a **Realtime Database** in locked mode. No Cloud Functions or billing upgrade is required.
2. Register a web app and copy its configuration into `.env.local` (include the database URL).
3. Enable Authentication → Email/Password and Anonymous. Add the deployed domain to Authentication’s authorized domains if needed.
4. Create the administrator in Firebase Authentication with the configured admin email and the hex SHA-256 of `milanos-admin-pin-v1:` plus the chosen PIN as its password. Under the database, set `/admins/ADMIN_AUTH_UID` to `true` using the Firebase console or a trusted administrative tool. No client can grant itself admin rights.
5. Set `/settings/rateCents` to `1300`.
6. Deploy `database.rules.json` before use. On the store PC, sign into Admin, open Employees, click **Authorize this store computer**, add real employees, then Lock. The PC keeps an anonymous device session; drivers do not sign in. Clearing browser site data requires pairing again. To revoke a PC, remove its UID under `/devices` in Firebase.
7. Run `npm run build`. Deploy the `dist` folder through Firebase Hosting or GitHub Pages. Firebase Hosting configuration is supplied; use `npx firebase deploy --only database,hosting --project YOUR_PROJECT_ID` after authenticating as its owner.

Keep the source repository private unless you deliberately choose otherwise. The deployed app shell can be publicly reachable, while roster, cash-outs and administration remain protected by Firebase rules. Anyone physically using a paired PC can select any active driver, as requested; this is not proof of an individual’s identity.

## Data contract

- `employees/{id}`: name, active. Stable employee IDs; saved cash-outs contain name snapshots.
- `settings/rateCents`: positive integer cents per hour.
- `admins/{uid}`: trusted admin allowlist, server/console managed only.
- `devices/{uid}`: PCs authorized by an admin.
- `cashouts/{uuid}`: id, employeeId/name, start/end epoch milliseconds, rateCents, createdBy, createdAt, and delivery/tip maps.
- `schemaVersion: 2` on new submissions. `deliveries`, `tips`, and `onlineTips` use bounded keys `e000`–`e199` with `{amountCents, billNumber}` values. Bill numbers preserve leading zeros and support letters, digits, and hyphens. Historical numeric entries remain readable and correctable, labeled as having no recorded bill number. New submissions require bill numbers.
- `startingCashCents` defaults to zero. `cashDeliveries/{e000…e199}` contains `{billNumber, billTotalCents, cashCollectedCents, changeGivenCents}`. Cash tips and cash owed are derived, never counted as additional received cash. Empty maps may be omitted by Firebase. Rules validate monetary fields and require received cash less change to cover the bill total.
- `cashouts/{uuid}/corrections/{uuid}`: full corrected shift snapshot plus reason, editedBy and editedAt. Append only.

Duration is derived from timestamps, in minutes. Wages are rounded once to the nearest cent: `round(minutes × rateCents / 60)`. All fees and tips use integer cents. Totals are derived from the immutable source entries, avoiding inconsistent duplicated totals in storage. UI times use the store PC’s local timezone: configure that PC to the store’s timezone. The shift limit is 24 hours; equal or reversed times are rejected. There is no automatic break deduction.

Submission IDs remain stable during retries. A second write cannot overwrite the original; a retry checks an identical saved record before reporting success. A genuinely new form creates a new submission. Intentional duplicate shifts are not automatically blocked. Browser printing cannot prove physical print success; reprinting never creates another cash-out.

History initially loads the most recent 500 submissions; Load all history retrieves older records too. Date/employee filters operate on the loaded records. This intentionally small-store implementation should use paginated queries before growing to a very large archive.

## Verification

`npm run build` checks TypeScript and creates production assets. `npm test` tests accounting; database tests are skipped unless an emulator is running. Run the full suite with:

```
npx firebase emulators:exec --only database --project demo-milanos "npm test"
```

Tests exercise overnight shifts, cent rounding, invalid inputs, rate snapshots, unpaired clients, privileged operations, malformed fee entries, original-record immutability and append-only corrections. CI runs the emulator suite on every push. No test cash-outs are written to production. The expanded suite also covers bill-linked entries, future end times, cash change, calculated tips, cash owed, and backward compatibility with historic records.
