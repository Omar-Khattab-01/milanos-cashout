import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  get,
  set,
  remove,
  update,
  query,
  orderByChild,
  limitToLast,
} from "firebase/database";
import type {
  Cashout,
  CashoutReview,
  Company,
  Correction,
  DailySales,
  Employee,
  EmployeeRole,
  Expense,
  ReviewStatus,
  StoreCashCorrection,
  StoreCashEntry,
} from "./model";
const env = import.meta.env;
export const demo = !env.VITE_FIREBASE_API_KEY;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const app = demo ? null : initializeApp(config);
const adminApp = demo ? null : initializeApp(config, "admin");
const kioskAuth = app ? getAuth(app) : null;
const auth = adminApp ? getAuth(adminApp) : null;
const kioskDb = app ? getDatabase(app) : null;
const adminDb = adminApp ? getDatabase(adminApp) : null;
let db = kioskDb;
let demoAdmin = false;
let employees: Record<string, Employee> = {
  alex: { name: "Alex Morgan", phone: "416-555-0101", role: "driver" },
  jamie: { name: "Jamie Wilson", phone: "416-555-0102", role: "cook" },
  sam: { name: "Sam Taylor", phone: "416-555-0103", role: "cashier" },
};
let rates: Record<EmployeeRole, number> = {
  driver: 1300,
  cook: 1300,
  cashier: 1300,
};
const records: Record<string, Cashout> = {};
let companies: Record<string, Company> = {
  supplier: { name: "Sample Food Supplier" },
};
const expenseRecords: Record<string, Expense> = {};
const reviewRecords: Record<string, CashoutReview> = {};
const storeCashRecords: Record<string, StoreCashEntry> = {};
const dailySalesRecords: Record<string, DailySales> = {};
export const uid = () =>
  auth?.currentUser?.uid || kioskAuth?.currentUser?.uid || "demo-driver";
export async function init() {
  if (auth && kioskAuth) {
    await Promise.all([
      setPersistence(auth, browserSessionPersistence),
      setPersistence(kioskAuth, browserLocalPersistence),
    ]);
    await Promise.all([auth.authStateReady(), kioskAuth.authStateReady()]);
    if (!kioskAuth.currentUser) await signInAnonymously(kioskAuth);
    // Protected sections require a fresh PIN after every visit.
    if (auth.currentUser) await signOut(auth);
    db = kioskDb;
  }
}
export async function authorizeDevice() {
  if (adminDb && kioskAuth?.currentUser)
    await set(ref(adminDb, `devices/${kioskAuth.currentUser.uid}`), true);
}
export async function isAdmin() {
  if (!db) return demoAdmin;
  if (!auth?.currentUser || auth.currentUser.isAnonymous) return false;
  return (await get(ref(db, `admins/${uid()}`))).val() === true;
}
export async function login(pin: string) {
  if (!auth) {
    demoAdmin = true;
    return;
  }
  if (!/^\d{4}$/.test(pin)) throw new Error("Enter your four-digit admin PIN.");
  // Firebase verifies the credential. This encoding adapts a PIN to its password
  // format; it does not increase the strength of a four-digit PIN.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("milanos-admin-pin-v1:" + pin),
  );
  const password = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  try {
    await signInWithEmailAndPassword(
      auth,
      "omar.lkhattab2000@gmail.com",
      password,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/too-many-requests")
      throw new Error("Too many attempts. Please wait and try again.");
    if (code === "auth/network-request-failed")
      throw new Error(
        "Unable to connect. Check your internet connection and try again.",
      );
    throw new Error("Incorrect admin PIN. Please try again.");
  }
  db = adminDb;
  if (!(await isAdmin())) {
    await logout();
    throw new Error("This account does not have admin access.");
  }
}
export async function logout() {
  if (auth) {
    await signOut(auth);
    db = kioskDb;
  }
  demoAdmin = false;
}
export async function roster(): Promise<Record<string, Employee>> {
  return db
    ? (await get(ref(db, "employees"))).val() || {}
    : structuredClone(employees);
}
export async function getRates(): Promise<Record<EmployeeRole, number>> {
  if (!db) return { ...rates };
  const value = (await get(ref(db, "settings"))).val() || {};
  const result = {
    driver: value.rateCents ?? 1300,
    cook: value.cookRateCents ?? 1300,
    cashier: value.cashierRateCents ?? 1300,
  };
  if (Object.values(result).some((rate) => !Number.isInteger(rate) || rate <= 0))
    throw new Error("The administrator needs to set valid hourly rates.");
  return result;
}
export async function setRate(role: EmployeeRole, value: number) {
  const key = role === "driver" ? "rateCents" : `${role}RateCents`;
  if (db) await set(ref(db, `settings/${key}`), value);
  else rates[role] = value;
}
export async function saveEmployee(id: string, employee: Employee) {
  if (db) await set(ref(db, `employees/${id}`), employee);
  else employees[id] = employee;
}
export async function deleteEmployee(id: string) {
  if (db) await remove(ref(db, `employees/${id}`));
  else delete employees[id];
}
function canonical(value: unknown): string {
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(
          ([, v]) =>
            v !== undefined &&
            !(v && typeof v === "object" && !Object.keys(v).length),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function save(record: Cashout) {
  if (!db) {
    records[record.id] = structuredClone(record);
    return;
  }
  try {
    await set(ref(db, `cashouts/${record.id}`), record);
  } catch (error) {
    const saved = (await get(ref(db, `cashouts/${record.id}`))).val();
    if (!saved || canonical(saved) !== canonical(record)) throw error;
  }
}
export async function history(): Promise<Cashout[]> {
  const value = db
    ? (
        await get(
          query(
            ref(db, "cashouts"),
            orderByChild("createdAt"),
            limitToLast(500),
          ),
        )
      ).val() || {}
    : records;
  return (Object.values(value) as Cashout[]).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}
export async function allHistory(): Promise<Cashout[]> {
  const value = db ? (await get(ref(db, "cashouts"))).val() || {} : records;
  return (Object.values(value) as Cashout[]).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}
export async function correct(id: string, correction: Correction) {
  const key = crypto.randomUUID();
  if (db)
    await update(ref(db, `cashouts/${id}/corrections`), { [key]: correction });
  else {
    records[id].corrections ||= {};
    records[id].corrections![key] = structuredClone(correction);
  }
}
export async function deleteShift(id: string) {
  if (db)
    await update(ref(db), {
      [`cashouts/${id}`]: null,
      [`cashoutReviews/${id}`]: null,
    });
  else {
    delete records[id];
    delete reviewRecords[id];
  }
}
export async function getReviews(): Promise<Record<string, CashoutReview>> {
  return db
    ? (await get(ref(db, "cashoutReviews"))).val() || {}
    : structuredClone(reviewRecords);
}
export async function setReview(id: string, status: ReviewStatus) {
  const review: CashoutReview = {
    status,
    updatedAt: Date.now(),
    updatedBy: uid(),
  };
  if (db) await set(ref(db, `cashoutReviews/${id}`), review);
  else reviewRecords[id] = review;
}
export async function getCompanies(): Promise<Record<string, Company>> {
  return db
    ? (await get(ref(db, "companies"))).val() || {}
    : structuredClone(companies);
}
export async function saveCompany(id: string, company: Company) {
  if (db) await set(ref(db, `companies/${id}`), company);
  else companies[id] = company;
}
export async function getExpenses(): Promise<Expense[]> {
  const value = db
    ? (await get(ref(db, "expenses"))).val() || {}
    : expenseRecords;
  return (Object.values(value) as Expense[]).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}
export async function saveExpense(expense: Expense) {
  if (db) await set(ref(db, `expenses/${expense.id}`), expense);
  else expenseRecords[expense.id] = structuredClone(expense);
}
export async function deleteExpense(id: string) {
  if (db) await remove(ref(db, `expenses/${id}`));
  else delete expenseRecords[id];
}
export async function getStoreCash(): Promise<StoreCashEntry[]> {
  const value = db
    ? (await get(ref(db, "storeCash"))).val() || {}
    : storeCashRecords;
  return (Object.values(value) as StoreCashEntry[]).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}
export async function saveStoreCash(entry: StoreCashEntry) {
  if (db) await set(ref(db, `storeCash/${entry.id}`), entry);
  else storeCashRecords[entry.id] = structuredClone(entry);
}
export async function correctStoreCash(
  id: string,
  correction: StoreCashCorrection,
) {
  const key = crypto.randomUUID();
  if (db)
    await set(ref(db, `storeCash/${id}/corrections/${key}`), correction);
  else {
    storeCashRecords[id].corrections ||= {};
    storeCashRecords[id].corrections![key] = structuredClone(correction);
  }
}
export async function getDailySales(): Promise<Record<string, DailySales>> {
  return db
    ? (await get(ref(db, "dailySales"))).val() || {}
    : structuredClone(dailySalesRecords);
}
export async function saveDailySales(record: DailySales) {
  if (db) await set(ref(db, `dailySales/${record.date}`), record);
  else dailySalesRecords[record.date] = structuredClone(record);
}
export async function deleteDailySales(date: string) {
  if (db) await remove(ref(db, `dailySales/${date}`));
  else delete dailySalesRecords[date];
}
