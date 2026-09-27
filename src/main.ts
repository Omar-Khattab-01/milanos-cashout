import "./style.css";
import * as store from "./store";
import {
  amountOf, billNumber, billOf, cashCents, cashTotals, cents, current, hours,
  localInput, money, salesCents, storeCashAmount, total, totals, validateShift,
  type CashDelivery, type CashFlowEntry, type Cashout, type CashoutReview, type Company, type Employee,
  type DailySales, type EmployeeRole, type EntryList, type Expense, type InventoryItem, type InventoryTargetType, type ReviewStatus,
  type RegisterCash, type Shift, type StoreCashEntry,
} from "./model";

const root = document.querySelector<HTMLDivElement>("#app")!;
const esc = (value: unknown) => String(value ?? "").replace(
  /[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
);
const today = () => localInput(Date.now()).slice(0, 10);
const date = (time: number) => new Date(time).toLocaleDateString("en-CA", {
  month: "short", day: "numeric", year: "numeric",
});
const time = (value: number) => new Date(value).toLocaleTimeString("en-CA", {
  hour: "numeric", minute: "2-digit",
});

type EntryKind = "deliveries" | "tips" | "onlineTips";
type ListKind = EntryKind | "cashDeliveries";
type ProtectedView = "history" | "employees" | "expenses" | "inventory";
type DeviceView = "cashout" | "store-cash";
type ExpenseTab = "overview" | "sales" | "suppliers" | "payroll" | "settings";

let roster: Record<string, Employee> = {};
let rates: Record<EmployeeRole, number> = { driver: 1300, cook: 1300, cashier: 1300 };
let cashoutRole: EmployeeRole = "driver";
let admin = false;
let view = "cashout";
let loginTarget: ProtectedView = "history";
let deviceTarget: DeviceView = "cashout";
let message = "";
let success = false;
let busy = false;
let records: Cashout[] = [];
let reviews: Record<string, CashoutReview> = {};
let selected: Cashout | null = null;
let companies: Record<string, Company> = {};
let expenses: Expense[] = [];
let storeCashEntries: StoreCashEntry[] = [];
let registerCash: Record<string, RegisterCash> = {};
let cashFlows: CashFlowEntry[] = [];
let inventory: Record<string, InventoryItem> = {};
let editingInventoryId = "";
let editingStoreCashId = "";
let dailySales: Record<string, DailySales> = {};
let expenseMonth = today().slice(0, 7);
let expenseTab: ExpenseTab = "overview";
let monthlyRentCents = 0;
let customDates = false;
let pending: Cashout | null = null;
let editId = "";
let editingEmployeeId = "";
let reason = "";
let editingListEntry: { kind: ListKind; id: string } | null = null;
let filterEmployee = "";
let filterDate = "";
const entryInputs: Record<string, Record<string, string>> = {};
const emptyConfirmed = () => ({ deliveries: true, tips: false, onlineTips: false, cashDeliveries: true });
let confirmed = emptyConfirmed();

function fresh() {
  customDates = false;
  return {
    employeeId: "", startDate: today(), endDate: today(), start: "", end: "",
    deliveries: {} as EntryList, tips: {} as EntryList, onlineTips: {} as EntryList,
    startingCash: "0.00", cashDeliveries: {} as Record<string, CashDelivery>,
  };
}
let draft = fresh();

function shift(): Shift {
  const existing = editId && selected ? current(selected) : null;
  const role = existing?.employeeRole || cashoutRole;
  return {
    schemaVersion: existing?.schemaVersion && existing.schemaVersion < 4 ? existing.schemaVersion : 4,
    employeeId: draft.employeeId,
    employeeName: existing?.employeeName || roster[draft.employeeId]?.name || "",
    employeeRole: role,
    start: new Date(`${draft.startDate}T${draft.start}`).getTime(),
    end: new Date(`${draft.endDate}T${draft.end}`).getTime(),
    rateCents: existing?.rateCents || rates[role],
    ...(role === "driver" ? {
      deliveries: { ...draft.deliveries }, tips: { ...draft.tips }, onlineTips: { ...draft.onlineTips },
      startingCashCents: /^\d+(\.\d{1,2})?$/.test(draft.startingCash)
        ? Math.round(Number(draft.startingCash) * 100) : NaN,
      cashDeliveries: { ...draft.cashDeliveries },
    } : {}),
  };
}

const roleName = (role: EmployeeRole) => role[0].toUpperCase() + role.slice(1);
const employeeRole = (employee: Employee): EmployeeRole => employee.role || "driver";
const shiftRole = (value: Shift): EmployeeRole => value.employeeRole || "driver";

function receipt(record: Cashout) {
  const s = current(record), t = totals(s), cash = cashTotals(s), role = shiftRole(s);
  const driverTotals = role === "driver" ? `<dt>Delivery fees</dt><dd>${money(t.deliveries)}</dd><dt>Tips</dt><dd>${money(t.tips + t.cashTips)}</dd><dt>Tips Online</dt><dd>${money(t.onlineTips)}</dd>` : "";
  const driverCash = role === "driver" ? `<hr><dl><dt>Starting cash</dt><dd>${money(cash.startingCash)}</dd><dt>Cash bill totals</dt><dd>${money(cash.billTotals)}</dd><dt>Cash owed to store</dt><dd>${money(cash.owed)}</dd></dl><p style="font-size:11px">Earnings paid separately</p>` : "";
  return `<div class="receipt"><h2>MILANO’S PIZZERIA</h2><p>${roleName(role).toUpperCase()} CASH-OUT</p><hr><dl><dt>Employee</dt><dd>${esc(s.employeeName)}</dd><dt>Role</dt><dd>${roleName(role)}</dd><dt>Shift date</dt><dd>${date(s.start)}</dd><dt>Started</dt><dd>${time(s.start)}</dd><dt>Ended</dt><dd>${date(s.end) !== date(s.start) ? date(s.end) + " " : ""}${time(s.end)}</dd><dt>Hours</dt><dd>${hours(t.minutes)}</dd></dl><hr><dl><dt>Hourly pay</dt><dd>${money(t.wages)}</dd>${driverTotals}</dl><div class="grand"><span>Total pay</span><strong>${money(t.total)}</strong></div>${driverCash}<p style="font-size:10px">${esc(record.id.slice(0, 8).toUpperCase())}${record.corrections ? " · CORRECTED" : ""}${store.demo ? " · DEMO — NOT A PAYROLL RECORD" : ""}</p></div>`;
}

function entryField(kind: ListKind, name: string, label: string, placeholder: string, moneyField = false, required = true) {
  const value = entryInputs[kind]?.[name] ?? "";
  return `<div><label for="${kind}-${name}">${label}</label><input id="${kind}-${name}" name="${name}" aria-label="${kind} ${label}" ${moneyField ? 'inputmode="decimal"' : 'inputmode="numeric" maxlength="40"'} placeholder="${placeholder}" value="${esc(value)}" autocomplete="off" ${required ? "required" : ""}></div>`;
}

function entrySection(kind: EntryKind, title: string, step: number) {
  const list = Object.entries(draft[kind]);
  const supportsFee = kind !== "deliveries";
  const editing = editingListEntry?.kind === kind;
  const amountLabel = kind === "tips" || kind === "onlineTips" ? "Tip amount" : "Amount";
  return `<section class="card"><div class="row"><div class="section-head" style="margin:0"><span class="step">${step}</span><div><h2>${title}</h2><span class="subtle">${supportsFee ? "Bill number → Space → tip amount → Space → delivery fee → Enter. Delivery fee is optional." : "Bill number → Space → amount → Enter."}</span></div></div>${confirmed[kind] ? '<span class="pill">Done</span>' : ""}</div>${!confirmed[kind] ? `<form data-form="entry" data-kind="${kind}" class="entry-input ${supportsFee ? "multi-input" : "bill-input"}">${entryField(kind, "billNumber", "Bill number", "e.g. 1042")}${entryField(kind, "amount", amountLabel, "0.00", true)}${supportsFee ? entryField(kind, "deliveryFee", "Delivery fee", "0.00", true, false) : ""}<button class="primary" type="submit">${editing ? "Save changes" : "+ Add"}</button></form>` : ""}${list.length ? `<ol class="entry-list">${list.map(([id, entry], i) => { const fee = typeof entry === "number" ? 0 : entry.deliveryFeeCents || 0; return `<li><span class="subtle">${i + 1}. Bill ${esc(billOf(entry))}${supportsFee ? ` · Delivery fee ${money(fee)}` : ""}</span><span>${money(amountOf(entry))} ${!confirmed[kind] ? `<button data-action="edit-list-entry" data-kind="${kind}" data-id="${id}">Edit</button><button data-action="remove" data-kind="${kind}" data-id="${id}">×</button>` : ""}</span></li>`; }).join("")}</ol>` : '<p class="subtle">No entries yet.</p>'}<div class="row entry-footer"><span class="subtle">${list.length} entries · <strong>${money(total(draft[kind]))}</strong></span><button data-action="done" data-kind="${kind}">${confirmed[kind] ? "Edit entries" : "Done"}</button></div></section>`;
}

function cashSection() {
  const entries = Object.entries(draft.cashDeliveries), t = cashTotals(shift());
  const editing = editingListEntry?.kind === "cashDeliveries";
  return `<section class="card"><div class="section-head"><span class="step">4</span><div><h2>Cash flow</h2><span class="subtle">Starting cash and cash-paid bills.</span></div></div><label for="startingCash">Starting cash taken</label><input id="startingCash" inputmode="decimal" data-draft="startingCash" value="${esc(draft.startingCash)}"><p class="subtle">Leave at $0.00 if no cash was taken. A bill can also appear in another section when a customer splits payment.</p><h3>Cash deliveries</h3>${!confirmed.cashDeliveries ? `<p class="subtle">Bill number → Space → bill total → Space → delivery fee → Enter.</p><form data-form="cash-delivery" data-kind="cashDeliveries" class="entry-input multi-input">${entryField("cashDeliveries", "billNumber", "Bill number", "e.g. 1042")}${entryField("cashDeliveries", "billTotal", "Bill total", "0.00", true)}${entryField("cashDeliveries", "deliveryFee", "Delivery fee", "0.00", true, false)}<button type="submit" class="primary">${editing ? "Save changes" : "+ Add"}</button></form>` : ""}${entries.length ? `<ol class="entry-list">${entries.map(([id, e]) => `<li><span>Bill ${esc(e.billNumber)} · Delivery fee ${money(e.deliveryFeeCents || 0)}</span><span>${money(e.billTotalCents)} ${!confirmed.cashDeliveries ? `<button data-action="edit-list-entry" data-kind="cashDeliveries" data-id="${id}">Edit</button><button data-action="remove" data-kind="cashDeliveries" data-id="${id}">×</button>` : ""}</span></li>`).join("")}</ol>` : '<p class="subtle">No cash deliveries entered.</p>'}<div class="entry-footer"><div class="row"><span class="subtle">${entries.length} cash bills · <strong>${money(t.billTotals)}</strong></span><button data-action="done" data-kind="cashDeliveries">${confirmed.cashDeliveries ? "Add / edit cash deliveries" : "Done"}</button></div></div></section>`;
}

function cashout() {
  const s = shift(), t = totals(s), cash = cashTotals(s);
  const valid = Number.isFinite(t.minutes) && t.minutes > 0 && t.minutes <= 1440;
  const role = shiftRole(s);
  const tabs = !editId ? `<div class="toolbar role-tabs">${(["driver", "cook", "cashier"] as EmployeeRole[]).map((item) => `<button data-action="cashout-role" data-role="${item}" class="${cashoutRole === item ? "active" : ""}">${roleName(item)}</button>`).join("")}</div>` : "";
  const employees = Object.entries(roster).filter(([id, employee]) =>
    (employee.active !== false && employeeRole(employee) === role) || id === draft.employeeId,
  );
  const shiftCard = `<section class="card"><div class="section-head"><span class="step">1</span><div><h2>Your shift</h2><span class="subtle">Choose your name and shift times.</span></div></div><div class="fields"><div class="full"><label for="employee">${roleName(role)} name</label><select id="employee" data-draft="employeeId" ${editId ? "disabled" : ""}><option value="">Select your name</option>${employees.map(([id, employee]) => `<option value="${esc(id)}" ${draft.employeeId === id ? "selected" : ""}>${esc(employee.name)}</option>`).join("")}</select>${!employees.length ? `<p class="subtle">An admin needs to add a ${role} employee first.</p>` : ""}</div><div><label for="start">Start time</label><input id="start" type="time" data-draft="start" value="${esc(draft.start)}"></div><div><label for="end">End time</label><input id="end" type="time" data-draft="end" value="${esc(draft.end)}"></div></div><p class="subtle">Start date: ${esc(draft.startDate)} · End date: ${esc(draft.endDate)}<br>Fill this in at the end of your shift.</p><details class="date-options"><summary>Change dates / overnight shift</summary><div class="fields"><div><label for="startDate">Start date</label><input id="startDate" type="date" data-draft="startDate" value="${esc(draft.startDate)}"></div><div><label for="endDate">End date</label><input id="endDate" type="date" data-draft="endDate" value="${esc(draft.endDate)}"></div></div></details></section>`;
  const driverSections = role === "driver" ? `${entrySection("tips", "Tips", 2)}${entrySection("onlineTips", "Tips Online", 3)}${cashSection()}` : "";
  const correction = editId ? `<section class="card"><label for="reason">Reason for correction</label><input id="reason" data-reason value="${esc(reason)}" maxlength="500" placeholder="Explain what changed and why"><p class="subtle">The original shift and every correction are retained.</p></section>` : "";
  const driverSummary = role === "driver" ? `<div class="summary-line"><span class="subtle">Delivery fees</span><strong>${money(t.deliveries)}</strong></div><div class="summary-line"><span class="subtle">Tips</span><strong>${money(t.tips + t.cashTips)}</strong></div><div class="summary-line"><span class="subtle">Tips Online</span><strong>${money(t.onlineTips)}</strong></div>` : "";
  const cashSummary = role === "driver" ? `<div class="summary-line"><span class="subtle">Starting cash</span><strong>${Number.isFinite(s.startingCashCents) ? money(cash.startingCash) : "—"}</strong></div><div class="summary-line"><span class="subtle">Cash bill totals</span><strong>${money(cash.billTotals)}</strong></div><div class="grand"><span>Cash owed to store</span><strong>${Number.isFinite(s.startingCashCents) ? money(cash.owed) : "—"}</strong></div><p class="subtle">Starting cash plus cash bill totals. Earnings are paid separately.</p>` : "";
  const displayedTotal = role === "driver" ? (valid ? t.wages : 0) + t.deliveries + t.tips + t.onlineTips + t.cashTips : valid ? t.wages : 0;
  return `${tabs}<div class="intro"><div><div class="eyebrow">${roleName(role)} cash-out</div><h1>${editId ? "Correct this shift" : "Let’s wrap up your shift."}</h1><span class="subtle">${role === "driver" ? "Enter each bill once with its tip and delivery fee." : "Enter your start and end time."}</span></div><span class="pill">${money(s.rateCents)} / hour</span></div><div class="layout"><div>${shiftCard}${driverSections}${correction}</div><aside class="card summary"><div class="eyebrow">Ready when you are</div><h2 style="margin-top:9px">Shift summary</h2><div class="summary-line"><span class="subtle">Employee</span><strong>${esc(s.employeeName || "Not selected")}</strong></div><div class="summary-line"><span class="subtle">Role</span><strong>${roleName(role)}</strong></div><div class="summary-line"><span class="subtle">Time worked</span><strong>${valid ? hours(t.minutes) : "—"}</strong></div><div class="summary-line"><span class="subtle">Hourly pay</span><strong>${valid ? money(t.wages) : "—"}</strong></div>${driverSummary}<div class="grand"><span>Total pay</span><strong>${money(displayedTotal)}</strong></div>${cashSummary}<button class="red wide" data-action="save">${busy ? "Saving…" : editId ? "Save correction" : "Save cash-out"}</button><p class="print-note">${store.demo ? "Demo records stay in memory only." : "Your cash-out will be saved in the system."}<br>Receipts can be printed from History.</p>${editId ? '<button class="wide" data-action="cancel-edit">Cancel correction</button>' : ""}</aside></div>`;
}

function loginView() {
  const names: Record<ProtectedView, string> = { history: "Cash-out history", employees: "Employees & pay", expenses: "Monthly expenses", inventory: "Inventory" };
  return `<section class="card login"><div class="eyebrow">Protected section</div><h1>${names[loginTarget]}</h1><p class="subtle">Enter the admin PIN to open this section.</p>${store.demo ? '<p class="message">Demo admin preview.</p><button class="primary wide" data-action="demo-login">Explore this section</button>' : '<form data-form="login"><label for="pin">Admin PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="Enter 4-digit PIN" required autofocus><button class="primary wide" type="submit">Unlock</button></form>'}</section>`;
}

function deviceLoginView() {
  return `<section class="card login"><div class="eyebrow">Store computer setup</div><h1>Unlock employee tools</h1><p class="subtle">Enter the admin PIN once to authorize this computer. Cash-outs and in-store cash entry will stay unlocked in this browser.</p>${store.demo ? '<button class="primary wide" data-action="demo-device-login">Authorize demo computer</button>' : '<form data-form="device-login"><label for="device-pin">Admin PIN</label><input id="device-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="Enter 4-digit PIN" required autofocus><button class="primary wide" type="submit">Authorize this computer</button></form>'}</section>`;
}

function storeCashView() {
  const day = today();
  const entries = storeCashEntries.filter((entry) => entry.date === day);
  const totalReceived = entries.reduce((sum, entry) => sum + storeCashAmount(entry), 0);
  const dayFlows = cashFlows.filter((entry) => entry.date === day);
  const totalCashFlow = dayFlows.reduce((sum, entry) => sum + entry.amountCents, 0);
  const openingCash = registerCash[day]?.openingCashCents || 0;
  const expectedCash = openingCash + totalReceived - totalCashFlow;
  const drivers = Object.entries(roster).filter(([, employee]) => employee.active !== false && employeeRole(employee) === "driver");
  const editing = entries.find((entry) => entry.id === editingStoreCashId);
  const form = editing
    ? `<h2>Correct cash amount</h2><p class="subtle">Bill ${esc(editing.billNumber || "Not recorded")} · The original amount remains in the audit history.</p><form data-form="store-cash-edit" data-id="${editing.id}"><label for="store-cash-edit-amount">Corrected amount received</label><input id="store-cash-edit-amount" name="amount" inputmode="decimal" value="${(storeCashAmount(editing) / 100).toFixed(2)}" autocomplete="off" required autofocus><div class="row" style="margin-top:16px"><button class="primary" type="submit">Save correction</button><button type="button" data-action="cancel-store-cash-edit">Cancel</button></div></form>`
    : `<h2>Add cash order</h2><p class="subtle">Today’s date is added automatically. Saved payments cannot be deleted.</p><form data-form="store-cash"><label for="store-cash-bill">Bill number</label><input id="store-cash-bill" name="billNumber" inputmode="numeric" maxlength="40" placeholder="e.g. 1042" autocomplete="off" required autofocus><label for="store-cash-amount">Amount received</label><input id="store-cash-amount" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" required><button class="primary wide" type="submit" style="margin-top:16px">Save cash received</button></form>`;
  return `<div class="intro"><div><div class="eyebrow">Cashier desk</div><h1>Store cash</h1><span class="subtle">Track payments received and cash given to drivers.</span></div><span class="pill">${esc(day)}</span></div><section class="card register-overview"><h2>Register cash</h2><div class="register-totals"><div><span class="subtle">Opening cash in register</span><strong>${money(openingCash)}</strong></div><div><span class="subtle">Cash received today</span><strong>${money(totalReceived)}</strong></div><div><span class="subtle">Cash flow to drivers</span><strong>− ${money(totalCashFlow)}</strong></div><div class="expected"><span>Expected cash in register</span><strong>${money(expectedCash)}</strong></div></div><p class="subtle">Expected cash = opening cash + cash received − cash given to drivers. Opening cash and driver cash flow do not count as sales.</p><details><summary>${registerCash[day] ? "Edit opening cash" : "Set opening cash"} (admin)</summary><form data-form="register-cash"><label for="register-opening-cash">Opening cash for today</label><input id="register-opening-cash" name="amount" inputmode="decimal" value="${(openingCash / 100).toFixed(2)}" autocomplete="off" required><label for="register-pin">Admin PIN</label><input id="register-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="Enter 4-digit PIN" required><button class="primary wide" type="submit">Save opening cash</button></form></details></section><div class="split"><section class="card">${form}</section><section class="card"><h2>Cash flow to driver</h2><p class="subtle">Record cash taken from the register at the start of a driver’s shift.</p><form data-form="cash-flow"><label for="cash-flow-driver">Driver name</label><select id="cash-flow-driver" name="employeeId" required><option value="">Select driver</option>${drivers.map(([id, employee]) => `<option value="${esc(id)}">${esc(employee.name)}</option>`).join("")}</select><label for="cash-flow-amount">Amount taken</label><input id="cash-flow-amount" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" required><button class="primary wide" type="submit">Save driver cash flow</button></form></section></div><div class="split"><section class="card table-wrap"><h2>Today’s cash received</h2>${entries.length ? `<table><thead><tr><th>Time</th><th>Bill number</th><th>Amount received</th><th></th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${time(entry.createdAt)}</td><td><strong>${esc(entry.billNumber || "Not recorded")}</strong></td><td>${money(storeCashAmount(entry))}${entry.corrections ? ' <span class="subtle">Corrected</span>' : ""}</td><td><button data-action="edit-store-cash" data-id="${entry.id}">Edit amount</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No in-store cash has been entered today.</div>'}</section><section class="card table-wrap"><h2>Today’s driver cash flow</h2>${dayFlows.length ? `<table><thead><tr><th>Time</th><th>Driver</th><th>Amount taken</th></tr></thead><tbody>${dayFlows.map((entry) => `<tr><td>${time(entry.createdAt)}</td><td><strong>${esc(entry.employeeName)}</strong></td><td>${money(entry.amountCents)}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">No cash has been given to drivers today.</div>'}</section></div>`;
}

function reviewState(id: string): "not_reviewed" | ReviewStatus {
  return reviews[id]?.status || "not_reviewed";
}

function reviewBadge(id: string) {
  const status = reviewState(id);
  const label = status === "reviewed" ? "Reviewed" : status === "under_review" ? "Under Review" : "Not Reviewed";
  return `<span class="review-status ${status}">${label}</span>`;
}

function historyView() {
  const filtered = records.filter((r) => (!filterEmployee || current(r).employeeId === filterEmployee) && (!filterDate || localInput(current(r).start).slice(0, 10) === filterDate));
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Cash-out history</h1><span class="subtle">Review, correct, reprint, or delete saved shifts.</span></div><button data-action="load-all">Load all history</button></div><div class="toolbar"><select id="filter-employee"><option value="">All employees</option>${Object.entries(roster).map(([id, e]) => `<option value="${esc(id)}" ${filterEmployee === id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select><input id="filter-date" type="date" value="${filterDate}"><button data-action="clear-filters">Clear filters</button></div><section class="card table-wrap"><p class="subtle">${records.length} loaded · ${filtered.length} matching shifts.</p>${filtered.length ? `<table><thead><tr><th>Employee / date</th><th>Review status</th><th>Hours</th><th>Total pay</th><th>Cash owed</th><th></th></tr></thead><tbody>${filtered.map((r) => { const s = current(r), t = totals(s), status = reviewState(r.id); return `<tr><td><strong>${esc(s.employeeName)}</strong><br><span class="subtle">${roleName(shiftRole(s))} · ${date(s.start)}${r.corrections ? " · Corrected" : ""}</span></td><td>${reviewBadge(r.id)}</td><td>${hours(t.minutes)}</td><td><strong>${money(t.total)}</strong></td><td>${shiftRole(s) === "driver" ? money(cashTotals(s).owed) : "—"}</td><td><div class="row"><button data-action="detail" data-id="${r.id}">View</button>${status === "reviewed" ? '<span class="review-check" aria-label="Reviewed">✓</span>' : ""}</div></td></tr>`; }).join("")}</tbody></table>` : '<div class="empty">No cash-outs found.</div>'}</section>`;
}

function employeeView() {
  const employeeRows = Object.entries(roster).map(([id, employee]) => {
    if (editingEmployeeId === id)
      return `<form data-form="employee-edit" data-id="${id}" class="employee"><div style="flex:1"><label for="edit-name-${id}">Employee name</label><input id="edit-name-${id}" name="name" value="${esc(employee.name)}" maxlength="80" required><label for="edit-phone-${id}">Phone number</label><input id="edit-phone-${id}" name="phone" type="tel" value="${esc(employee.phone || "")}" placeholder="Phone number" maxlength="30" required><label for="edit-role-${id}">Role</label><select id="edit-role-${id}" name="role" required>${(["driver", "cook", "cashier"] as EmployeeRole[]).map((role) => `<option value="${role}" ${employeeRole(employee) === role ? "selected" : ""}>${roleName(role)}</option>`).join("")}</select></div><div><button class="primary" type="submit">Save</button><button type="button" data-action="cancel-employee-edit">Cancel</button></div></form>`;
    return `<div class="employee"><div class="row"><span class="avatar">${esc(employee.name[0])}</span><div><strong>${esc(employee.name)}</strong><br><span class="subtle">${roleName(employeeRole(employee))} · ${esc(employee.phone || "No phone number")}</span></div></div><div class="row"><button data-action="edit-employee" data-id="${id}">Edit</button><button data-action="delete-employee" data-id="${id}">Delete</button></div></div>`;
  }).join("");
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Employees & pay</h1><span class="subtle">Assign each employee as a driver, cook, or cashier.</span></div></div><div class="split"><section class="card"><h2>Employees</h2>${employeeRows || '<p class="subtle">No employees yet.</p>'}<form data-form="employee" style="margin-top:24px"><label for="name">Add employee</label><div class="fields"><div><input id="name" name="name" placeholder="Full name" maxlength="80" required></div><div><input id="phone" name="phone" type="tel" placeholder="Phone number" maxlength="30" required></div><div class="full"><select name="role" aria-label="Employee role" required><option value="driver">Driver</option><option value="cook">Cook</option><option value="cashier">Cashier</option></select></div></div><button class="primary" type="submit">Add employee</button></form><p class="subtle">Deleting removes the employee from the cash-out list. Saved shift history remains.</p></section><section class="card"><h2>Store computer</h2><p class="subtle">Authorize this computer once so employees can use it without signing in.</p><button data-action="authorize-device">Authorize this store computer</button><hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><h2>Hourly pay rates</h2><p class="subtle">Set one rate for each role. Saved shifts keep their original rate.</p><form data-form="rates"><label for="driver-rate">Driver</label><input id="driver-rate" name="driver" inputmode="decimal" value="${(rates.driver / 100).toFixed(2)}" required><label for="cook-rate">Cook</label><input id="cook-rate" name="cook" inputmode="decimal" value="${(rates.cook / 100).toFixed(2)}" required><label for="cashier-rate">Cashier</label><input id="cashier-rate" name="cashier" inputmode="decimal" value="${(rates.cashier / 100).toFixed(2)}" required><button type="submit" class="primary wide">Save hourly rates</button></form></section></div>`;
}

function dailySalesView() {
  const monthStoreCash = storeCashEntries.filter((entry) => entry.date.startsWith(expenseMonth));
  const monthSales = Object.values(dailySales).filter((entry) => entry.date.startsWith(expenseMonth)).sort((a, b) => b.date.localeCompare(a.date));
  const driverCashFor = (day: string) => records.reduce((sum, record) => {
    const s = current(record);
    return sum + (shiftRole(s) === "driver" && localInput(s.start).slice(0, 10) === day ? cashTotals(s).billTotals : 0);
  }, 0);
  const deliveryFor = (day: string) => records.reduce((sum, record) => {
    const shift = current(record);
    return sum + (shiftRole(shift) === "driver" && localInput(shift.start).slice(0, 10) === day ? totals(shift).deliveries : 0);
  }, 0);
  const storeCashFor = (day: string) => storeCashEntries.reduce((sum, entry) => sum + (entry.date === day ? storeCashAmount(entry) : 0), 0);
  const rows = monthSales.map((sale) => {
    const expected = sale.pcSalesCents + sale.onlineOrdersCents;
    const delivery = deliveryFor(sale.date), driverCash = driverCashFor(sale.date), storeCash = storeCashFor(sale.date);
    const difference = expected + delivery - sale.cloverGrossCents - sale.onlineReceivableCents - driverCash - storeCash;
    return { sale, expected, delivery, driverCash, storeCash, difference };
  });
  const monthlyDifference = rows.reduce((sum, row) => sum + row.difference, 0);
  return `<section class="card"><div class="row"><div><h2>Daily sales reconciliation</h2><p class="subtle">PC sales + online orders + driver delivery pay, minus Clover gross sales, online receivables, driver cash orders, and in-store cash.</p></div>${rows.length ? `<span class="pill">Month difference: ${money(monthlyDifference)}</span>` : ""}</div><form data-form="daily-sales"><div class="fields"><div><label for="sales-date">Date</label><input id="sales-date" name="date" type="date" value="${today()}" required></div><div><label for="pc-sales">Milano’s PC sales</label><input id="pc-sales" name="pcSales" inputmode="decimal" placeholder="0.00" required></div><div><label for="online-orders">Online orders</label><input id="online-orders" name="onlineOrders" inputmode="decimal" placeholder="0.00" required></div><div><label for="clover-gross">Clover devices gross sales</label><input id="clover-gross" name="cloverGross" inputmode="decimal" placeholder="0.00" required></div><div><label for="online-receivable">Online order receivable</label><input id="online-receivable" name="onlineReceivable" inputmode="decimal" placeholder="0.00" required></div></div><button class="primary" type="submit" style="margin-top:16px">Save daily sales</button><p class="subtle">Saving the same date updates that day. Delivery pay, driver cash, and in-store cash are calculated automatically.</p></form></section><section class="card table-wrap"><h2>Daily sales for ${esc(expenseMonth)}</h2>${rows.length ? `<table><thead><tr><th>Date</th><th>PC + online</th><th>Clover</th><th>Online receivable</th><th>Delivery</th><th>Driver cash</th><th>Store cash</th><th>Difference</th><th></th></tr></thead><tbody>${rows.map(({ sale, expected, delivery, driverCash, storeCash, difference }) => `<tr><td>${esc(sale.date)}</td><td>${money(expected)}</td><td>${money(sale.cloverGrossCents)}</td><td>${money(sale.onlineReceivableCents)}</td><td>${money(delivery)}</td><td>${money(driverCash)}</td><td>${money(storeCash)}</td><td><strong class="${difference === 0 ? "balanced" : "unbalanced"}">${money(difference)}</strong></td><td><button data-action="delete-daily-sales" data-date="${esc(sale.date)}">Delete</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No daily sales entered for this month.</div>'}</section><section class="card table-wrap"><h2>In-store cash entries</h2>${monthStoreCash.length ? `<table><thead><tr><th>Date</th><th>Time</th><th>Bill number</th><th>Amount</th></tr></thead><tbody>${monthStoreCash.map((entry) => `<tr><td>${esc(entry.date)}</td><td>${time(entry.createdAt)}</td><td>${esc(entry.billNumber || "Not recorded")}</td><td>${money(storeCashAmount(entry))}${entry.corrections ? ' <span class="subtle">Corrected</span>' : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">No in-store cash entries for this month.</div>'}</section>`;
}

function expensesView() {
  const monthExpenses = expenses.filter((e) => e.date.startsWith(expenseMonth));
  const monthShifts = records.filter((r) => localInput(current(r).start).startsWith(expenseMonth));
  const foodCost = monthExpenses.reduce((sum, e) => sum + e.amountCents, 0);
  const employeeCost = monthShifts.reduce((sum, r) => sum + totals(current(r)).wages, 0);
  const byCompany = monthExpenses.reduce<Record<string, number>>((result, e) => {
    result[e.companyName] = (result[e.companyName] || 0) + e.amountCents;
    return result;
  }, {});
  const driverPayouts = monthShifts.reduce<Record<string, { name: string; deliveries: number; tips: number }>>((result, record) => {
    const s = current(record), t = totals(s);
    if (shiftRole(s) !== "driver") return result;
    result[s.employeeId] ||= { name: s.employeeName, deliveries: 0, tips: 0 };
    result[s.employeeId].deliveries += t.deliveries;
    result[s.employeeId].tips += t.tips + t.onlineTips + t.cashTips;
    return result;
  }, {});
  const deliveryTotal = Object.values(driverPayouts).reduce((sum, row) => sum + row.deliveries, 0);
  const tipTotal = Object.values(driverPayouts).reduce((sum, row) => sum + row.tips, 0);
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Monthly expenses</h1><span class="subtle">Track supplier orders, hourly wages, deliveries, and tips.</span></div><input id="expense-month" type="month" value="${expenseMonth}"></div><div class="split"><section class="card"><h2>Monthly overview</h2><div class="summary-line"><span>Food cost</span><strong>${money(foodCost)}</strong></div><div class="summary-line"><span>Employee cost (hourly pay)</span><strong>${money(employeeCost)}</strong></div><div class="grand"><span>Total tracked cost</span><strong>${money(foodCost + employeeCost)}</strong></div><p class="subtle">Delivery fees and tips are listed separately below and are not included in total tracked cost.</p>${Object.keys(byCompany).length ? `<h3>Food cost by company</h3>${Object.entries(byCompany).sort((a, b) => b[1] - a[1]).map(([name, amount]) => `<div class="summary-line"><span>${esc(name)}</span><strong>${money(amount)}</strong></div>`).join("")}` : ""}</section><section class="card"><h2>Add supplier company</h2><form data-form="company"><label for="company-name">Company name</label><div class="entry-input"><input id="company-name" name="name" maxlength="100" placeholder="Supplier name" required><button class="primary" type="submit">Add</button></div></form><h2 style="margin-top:28px">Add order expense</h2><form data-form="expense"><label for="expense-company">Company</label><select id="expense-company" name="companyId" required><option value="">Select company</option>${Object.entries(companies).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, c]) => `<option value="${esc(id)}">${esc(c.name)}</option>`).join("")}</select><label for="expense-date">Order date</label><input id="expense-date" name="date" type="date" value="${today()}" required><label for="expense-amount">Total ordered</label><input id="expense-amount" name="amount" inputmode="decimal" placeholder="0.00" required><button class="primary wide" type="submit">Save expense</button></form></section></div><section class="card table-wrap"><h2>Deliveries and tips</h2>${Object.keys(driverPayouts).length ? `<table><thead><tr><th>Driver</th><th>Delivery fees</th><th>Tips</th><th>Total</th></tr></thead><tbody>${Object.values(driverPayouts).sort((a, b) => a.name.localeCompare(b.name)).map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${money(row.deliveries)}</td><td>${money(row.tips)}</td><td><strong>${money(row.deliveries + row.tips)}</strong></td></tr>`).join("")}<tr><td><strong>Monthly total</strong></td><td><strong>${money(deliveryTotal)}</strong></td><td><strong>${money(tipTotal)}</strong></td><td><strong>${money(deliveryTotal + tipTotal)}</strong></td></tr></tbody></table>` : '<div class="empty">No driver cash-outs for this month.</div>'}</section><section class="card table-wrap"><h2>Orders for ${esc(expenseMonth)}</h2>${monthExpenses.length ? `<table><thead><tr><th>Date</th><th>Company</th><th>Total</th><th></th></tr></thead><tbody>${monthExpenses.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.companyName)}</td><td>${money(e.amountCents)}</td><td><button data-action="delete-expense" data-id="${e.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No supplier orders entered for this month.</div>'}</section>`;
}

function organizedExpensesView() {
  const monthExpenses = expenses.filter((entry) => entry.date.startsWith(expenseMonth));
  const monthShifts = records.filter((record) => localInput(current(record).start).startsWith(expenseMonth));
  const monthSales = Object.values(dailySales).filter((entry) => entry.date.startsWith(expenseMonth));
  const foodCost = monthExpenses.reduce((sum, entry) => sum + entry.amountCents, 0);
  const employeeCost = monthShifts.reduce((sum, record) => sum + totals(current(record)).wages, 0);
  const employeeDeliveryCost = monthShifts.reduce((sum, record) => {
    const shift = current(record);
    return sum + (shiftRole(shift) === "driver" ? totals(shift).deliveries : 0);
  }, 0);
  const recordedSales = monthSales.reduce((sum, entry) => sum + entry.pcSalesCents + entry.onlineOrdersCents, 0);
  const operatingCosts = foodCost + employeeCost + employeeDeliveryCost + monthlyRentCents;
  const amountLeft = recordedSales - operatingCosts;
  const byCompany = monthExpenses.reduce<Record<string, number>>((result, entry) => {
    result[entry.companyName] = (result[entry.companyName] || 0) + entry.amountCents;
    return result;
  }, {});
  const payroll = monthShifts.reduce<Record<string, { name: string; role: EmployeeRole; wages: number; deliveries: number; tips: number }>>((result, record) => {
    const shift = current(record), shiftTotals = totals(shift), role = shiftRole(shift);
    result[shift.employeeId] ||= { name: shift.employeeName, role, wages: 0, deliveries: 0, tips: 0 };
    result[shift.employeeId].wages += shiftTotals.wages;
    if (role === "driver") {
      result[shift.employeeId].deliveries += shiftTotals.deliveries;
      result[shift.employeeId].tips += shiftTotals.tips + shiftTotals.onlineTips + shiftTotals.cashTips;
    }
    return result;
  }, {});
  const deliveryTotal = employeeDeliveryCost;
  const tipTotal = Object.values(payroll).reduce((sum, row) => sum + row.tips, 0);
  const chartMax = Math.max(recordedSales, operatingCosts, Math.abs(amountLeft), foodCost, employeeCost, employeeDeliveryCost, monthlyRentCents, 1);
  const chartBar = (label: string, amount: number, tone = "") => `<div class="chart-row"><div class="chart-label"><span>${label}</span><strong>${money(amount)}</strong></div><div class="chart-track"><span class="chart-fill ${tone}" style="width:${Math.max(2, Math.round((Math.abs(amount) / chartMax) * 100))}%"></span></div></div>`;
  const tabs = ([
    ["overview", "Overview"],
    ["sales", "Sales"],
    ["suppliers", "Supplier Costs"],
    ["payroll", "Payroll"],
    ["settings", "Settings"],
  ] as [ExpenseTab, string][]).map(([id, label]) => `<button data-action="expense-tab" data-tab="${id}" class="${expenseTab === id ? "active" : ""}" aria-selected="${expenseTab === id}">${label}</button>`).join("");

  const overview = `<div class="expense-grid"><section class="card"><div class="eyebrow">Monthly performance</div><h2>Money in and out</h2><div class="summary-line"><span>Recorded sales</span><strong>${money(recordedSales)}</strong></div><div class="summary-line"><span>Food cost</span><strong>${money(foodCost)}</strong></div><div class="summary-line"><span>Employee cost (hourly pay)</span><strong>${money(employeeCost)}</strong></div><div class="summary-line"><span>Employee cost (delivery pay)</span><strong>${money(employeeDeliveryCost)}</strong></div><div class="summary-line"><span>Fixed monthly rent</span><strong>${money(monthlyRentCents)}</strong></div><div class="summary-line total-line"><span>Total operating costs</span><strong>${money(operatingCosts)}</strong></div><div class="grand result-total ${amountLeft < 0 ? "negative" : "positive"}"><span>Amount left after tracked costs</span><strong>${money(amountLeft)}</strong></div><p class="subtle">Recorded sales − food costs − hourly employee pay − driver delivery pay − rent. Tips remain separate and are not deducted here.</p></section><section class="card chart-card"><div class="eyebrow">Cash flow</div><h2>Sales compared with costs</h2>${chartBar("Recorded sales", recordedSales, "income")}${chartBar("Operating costs", operatingCosts, "cost")}${chartBar("Amount left", amountLeft, amountLeft < 0 ? "loss" : "remaining")}</section></div><section class="card chart-card"><div class="row"><div><div class="eyebrow">Cost breakdown</div><h2>Where operating costs went</h2></div><span class="pill">${esc(expenseMonth)}</span></div>${chartBar("Food", foodCost, "food")}${chartBar("Hourly employee pay", employeeCost, "payroll")}${chartBar("Driver delivery pay", employeeDeliveryCost, "delivery")}${chartBar("Rent", monthlyRentCents, "rent")}</section>`;

  const sales = dailySalesView()
    .replace("Month difference:", "Month unreconciled difference:")
    .replace("<th>Difference</th>", "<th>Unreconciled difference</th>")
    .replace("</p></div>", "</p><p class=\"subtle\"><strong>What it means:</strong> $0 is balanced. A positive amount means some sales are not matched to a recorded payment source. A negative amount means recorded payment sources are higher than sales.</p></div>");

  const suppliers = `<div class="split"><section class="card"><h2>Add supplier company</h2><form data-form="company"><label for="company-name">Company name</label><div class="entry-input"><input id="company-name" name="name" maxlength="100" placeholder="Supplier name" required><button class="primary" type="submit">Add</button></div></form><h2 style="margin-top:28px">Add order expense</h2><form data-form="expense"><label for="expense-company">Company</label><select id="expense-company" name="companyId" required><option value="">Select company</option>${Object.entries(companies).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, company]) => `<option value="${esc(id)}">${esc(company.name)}</option>`).join("")}</select><label for="expense-date">Order date</label><input id="expense-date" name="date" type="date" value="${today()}" required><label for="expense-amount">Total ordered</label><input id="expense-amount" name="amount" inputmode="decimal" placeholder="0.00" required><button class="primary wide" type="submit">Save expense</button></form></section><section class="card"><h2>Food cost by company</h2>${Object.keys(byCompany).length ? Object.entries(byCompany).sort((a, b) => b[1] - a[1]).map(([name, amount]) => `<div class="summary-line"><span>${esc(name)}</span><strong>${money(amount)}</strong></div>`).join("") + `<div class="grand"><span>Total food cost</span><strong>${money(foodCost)}</strong></div>` : '<div class="empty">No supplier costs entered for this month.</div>'}</section></div><section class="card table-wrap"><h2>Supplier orders for ${esc(expenseMonth)}</h2>${monthExpenses.length ? `<table><thead><tr><th>Date</th><th>Company</th><th>Total</th><th></th></tr></thead><tbody>${monthExpenses.map((entry) => `<tr><td>${esc(entry.date)}</td><td>${esc(entry.companyName)}</td><td>${money(entry.amountCents)}</td><td><button data-action="delete-expense" data-id="${entry.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No supplier orders entered for this month.</div>'}</section>`;

  const payrollView = `<section class="card table-wrap"><div class="row"><div><h2>Employee pay for ${esc(expenseMonth)}</h2><p class="subtle">Hourly pay and driver delivery pay are included in operating costs. Tips remain separate.</p></div><span class="pill">Employee cost ${money(employeeCost + deliveryTotal)}</span></div>${Object.keys(payroll).length ? `<table><thead><tr><th>Employee</th><th>Role</th><th>Hourly pay</th><th>Delivery pay</th><th>Tips</th></tr></thead><tbody>${Object.values(payroll).sort((a, b) => a.name.localeCompare(b.name)).map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${roleName(row.role)}</td><td>${money(row.wages)}</td><td>${row.role === "driver" ? money(row.deliveries) : "—"}</td><td>${row.role === "driver" ? money(row.tips) : "—"}</td></tr>`).join("")}<tr><td colspan="2"><strong>Monthly totals</strong></td><td><strong>${money(employeeCost)}</strong></td><td><strong>${money(deliveryTotal)}</strong></td><td><strong>${money(tipTotal)}</strong></td></tr></tbody></table>` : '<div class="empty">No employee cash-outs for this month.</div>'}</section>`;

  const settings = `<section class="card settings-card"><div class="eyebrow">Expense settings</div><h2>Fixed monthly rent</h2><p class="subtle">This amount is automatically counted once in every month’s overview. Enter $0.00 if there is no rent to count.</p><form data-form="monthly-rent"><label for="monthly-rent">Rent paid each month</label><input id="monthly-rent" name="amount" inputmode="decimal" value="${(monthlyRentCents / 100).toFixed(2)}" required><button class="primary" type="submit">Save monthly rent</button></form></section>`;
  const content: Record<ExpenseTab, string> = { overview, sales, suppliers, payroll: payrollView, settings };
  return `<div class="intro expenses-intro"><div><div class="eyebrow">Management</div><h1>Business finances</h1><span class="subtle">Review sales, operating costs, and the amount left for each month.</span></div><label class="month-picker" for="expense-month"><span>Viewing month</span><input id="expense-month" type="month" value="${expenseMonth}"></label></div><nav class="expense-tabs" aria-label="Expense sections" role="tablist">${tabs}</nav><div class="expense-panel" role="tabpanel">${content[expenseTab]}</div>`;
}

const inventoryValue = (value: string, type: InventoryTargetType) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a number with up to two decimal places.");
  const number = Number(value);
  const maximum = type === "percentage" ? 100 : 1000000;
  if (!Number.isFinite(number) || number < 0 || number > maximum) throw new Error(type === "percentage" ? "Enter a percentage from 0 to 100." : "Enter a quantity from 0 to 1,000,000.");
  return number;
};

function inventoryView() {
  const items = Object.values(inventory).sort((a, b) => {
    const aNeed = Math.max(0, a.targetValue - a.currentValue), bNeed = Math.max(0, b.targetValue - b.currentValue);
    return bNeed - aNeed || a.name.localeCompare(b.name);
  });
  const itemCards = items.map((item) => {
    const needed = Math.max(0, item.targetValue - item.currentValue);
    const excess = Math.max(0, item.currentValue - item.targetValue);
    const suffix = item.targetType === "percentage" ? "%" : "";
    const progress = item.targetValue > 0 ? Math.min(100, Math.round((item.currentValue / item.targetValue) * 100)) : 100;
    const format = (value: number) => value.toLocaleString("en-CA", { maximumFractionDigits: 2 });
    const status = needed > 0 ? `Need ${format(needed)}${suffix}` : excess > 0 ? `Excess ${format(excess)}${suffix}` : "Target met";
    const statusClass = needed > 0 ? "needs-stock" : excess > 0 ? "excess-stock" : "stocked";
    const editor = editingInventoryId === item.id ? `<div class="inventory-editor"><form data-form="inventory-update" data-id="${item.id}" class="inventory-update"><div><label for="inventory-current-${item.id}">Current ${item.targetType}</label><input id="inventory-current-${item.id}" name="currentValue" inputmode="decimal" value="${item.currentValue}" required autofocus></div><div><label for="inventory-target-${item.id}">Target ${item.targetType}</label><input id="inventory-target-${item.id}" name="targetValue" inputmode="decimal" value="${item.targetValue}" required></div><button class="primary" type="submit">Save changes</button></form><div class="row inventory-editor-actions"><button data-action="cancel-inventory-edit">Close</button><button data-action="delete-inventory" data-id="${item.id}">Delete item</button></div></div>` : "";
    return `<article class="inventory-item ${statusClass}"><div class="inventory-shopping-row"><button class="inventory-item-open" data-action="edit-inventory" data-id="${item.id}" aria-expanded="${editingInventoryId === item.id}"><span><strong>${esc(item.name)}</strong><small>${status}</small></span><span class="inventory-count"><strong>${format(item.currentValue)}${suffix}</strong><small>Target ${format(item.targetValue)}${suffix}</small></span></button><button class="inventory-reset" data-action="reset-inventory" data-id="${item.id}">Reset to target</button></div><div class="inventory-progress" aria-label="${esc(item.name)} stock progress"><span style="width:${progress}%"></span></div>${editor}</article>`;
  }).join("");
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Inventory</h1><span class="subtle">Keep stock levels current and see what is needed while shopping.</span></div><span class="pill">${items.filter((item) => item.currentValue < item.targetValue).length} items needed</span></div><div class="inventory-layout"><section class="card inventory-add"><h2>Add inventory item</h2><form data-form="inventory-add"><label for="inventory-name">Item name</label><input id="inventory-name" name="name" maxlength="100" placeholder="e.g. Pizza boxes" required><label for="inventory-type">Track by</label><select id="inventory-type" name="targetType" required><option value="quantity">Quantity</option><option value="percentage">Percentage</option></select><div class="fields"><div><label for="inventory-target">Target</label><input id="inventory-target" name="targetValue" inputmode="decimal" placeholder="0" required></div><div><label for="inventory-current">Current in store</label><input id="inventory-current" name="currentValue" inputmode="decimal" placeholder="0" required></div></div><button class="primary wide" type="submit">Add inventory item</button></form></section><section><div class="inventory-list">${itemCards || '<div class="card empty">No inventory items yet. Add the first item to start the shopping list.</div>'}</div></section></div>`;
}

function detailView() {
  if (!selected) return "";
  const s = current(selected);
  const status = reviewState(selected.id);
  const items = (label: string, list: EntryList = {}) => `<details><summary>${label} · ${Object.keys(list).length} entries · ${money(total(list))}</summary><ol>${Object.values(list).map((entry) => `<li style="padding:8px">Bill ${esc(billOf(entry))} · ${money(amountOf(entry))}${typeof entry !== "number" && entry.deliveryFeeCents !== undefined ? ` · Delivery fee ${money(entry.deliveryFeeCents)}` : ""}</li>`).join("") || '<p class="subtle">No entries.</p>'}</ol></details>`;
  const cashItems = (value: Shift) => `<details><summary>Cash deliveries · ${Object.keys(value.cashDeliveries || {}).length} bills · ${money(cashTotals(value).billTotals)}</summary><p>Starting cash: ${money(value.startingCashCents || 0)}</p><ol>${Object.values(value.cashDeliveries || {}).map((e) => `<li>Bill ${esc(e.billNumber)} · ${money(e.billTotalCents)} · Delivery fee ${money(e.deliveryFeeCents || 0)}</li>`).join("") || "<p>No cash deliveries.</p>"}</ol></details>`;
  const reviewActions = status === "reviewed"
    ? `<div class="row"><span>${reviewBadge(selected.id)}</span><span class="review-check" aria-label="Reviewed">✓</span></div>`
    : `<div class="row"><span>${reviewBadge(selected.id)}</span><div class="row"><button class="primary" data-action="set-review" data-status="reviewed">Mark Paid</button>${status === "not_reviewed" ? '<button data-action="set-review" data-status="under_review">Partially Paid</button>' : ""}</div></div>`;
  const itemized = shiftRole(s) === "driver" ? `<h2>Itemized entries</h2>${items("Delivery fees", s.deliveries)}${items("Tips", s.tips)}${items("Tips Online", s.onlineTips)}${cashItems(s)}` : "";
  return `<div class="detail"><button data-action="back-history">← Back to history</button><h1 style="margin-top:20px">Shift record</h1><div class="row"><span class="subtle">${esc(s.employeeName)} · ${roleName(shiftRole(s))} · ${date(s.start)}</span><div class="row"><button data-action="edit">Correct</button><button class="primary" data-action="print">Reprint</button><button data-action="delete-shift">Delete shift</button></div></div><section class="card"><h2>Payment review</h2>${reviewActions}</section>${receipt(selected)}<section class="card">${itemized}<details><summary>Original record & correction history</summary><p class="subtle">Original submission: ${new Date(selected.createdAt).toLocaleString()}</p>${receipt({ ...selected, corrections: undefined })}${Object.values(selected.corrections || {}).sort((a, b) => b.editedAt - a.editedAt).map((c) => `<details><summary>${new Date(c.editedAt).toLocaleString()} · ${esc(c.reason)}</summary>${receipt({ ...c, id: selected!.id, createdBy: selected!.createdBy, createdAt: selected!.createdAt })}</details>`).join("")}</details></section></div>`;
}

function render() {
  const datesOpen = root.querySelector<HTMLDetailsElement>(".date-options")?.open;
  root.innerHTML = `<header><div class="brand"><span class="monogram">M</span><div><strong>milano’s</strong><small>PIZZERIA · EMPLOYEE DESK</small></div></div><nav aria-label="Main navigation"><button data-action="cashout-nav" class="${view === "cashout" || view === "device-login" ? "active" : ""}">Cash-out</button><button data-action="protected-nav" data-view="history" class="${view === "history" || view === "detail" ? "active" : ""}">History</button><button data-action="protected-nav" data-view="employees" class="${view === "employees" ? "active" : ""}">Employees</button><button data-action="protected-nav" data-view="expenses" class="${view === "expenses" ? "active" : ""}">Expenses</button></nav></header>${store.demo ? '<div class="notice">Preview mode · Records are temporary and cleared when you reload.</div>' : ""}<main>${message ? `<div role="alert" class="message ${success ? "success" : ""}">${esc(message)}</div>` : ""}${view === "cashout" ? cashout() : view === "device-login" ? deviceLoginView() : view === "login" ? loginView() : view === "history" && admin ? historyView() : view === "employees" && admin ? employeeView() : view === "expenses" && admin ? organizedExpensesView() : view === "detail" && admin ? detailView() : view === "saved" && selected ? `<div class="saved-heading"><span class="pill">${store.demo ? "Demo saved" : "Cash-out saved"}</span><h1>You’re all set.</h1><p class="subtle">The receipt below is for reference. An admin can print it from History.</p></div>${receipt(selected)}<div class="row" style="justify-content:center"><button class="primary" data-action="new">Next employee</button></div>` : ""}</main><footer>Milano’s Pizzeria · Employee cash-outs</footer>`;
  const cashoutNav = root.querySelector<HTMLButtonElement>('button[data-action="cashout-nav"]');
  cashoutNav?.insertAdjacentHTML("afterend", `<button data-action="store-cash-nav" class="${view === "store-cash" || (view === "device-login" && deviceTarget === "store-cash") ? "active" : ""}">Store Cash</button>`);
  const expensesNav = root.querySelector<HTMLButtonElement>('button[data-view="expenses"]');
  expensesNav?.insertAdjacentHTML("afterend", `<button data-action="protected-nav" data-view="inventory" class="${view === "inventory" ? "active" : ""}">Inventory</button>`);
  if (view === "device-login" && deviceTarget === "store-cash") cashoutNav?.classList.remove("active");
  if (view === "store-cash") root.querySelector("main")?.insertAdjacentHTML("beforeend", storeCashView());
  if (view === "inventory" && admin) root.querySelector("main")?.insertAdjacentHTML("beforeend", inventoryView());
  const startingCashInput = view === "cashout" && cashoutRole === "driver" ? root.querySelector<HTMLInputElement>('#startingCash') : null;
  if (startingCashInput) {
    startingCashInput.readOnly = true;
    const label = root.querySelector<HTMLLabelElement>('label[for="startingCash"]');
    if (label) label.textContent = "Starting cash from Store Cash";
    const note = startingCashInput.nextElementSibling;
    if (note) note.textContent = "This is filled automatically from today’s cash flow recorded in Store Cash.";
  }
  if (datesOpen) root.querySelector<HTMLDetailsElement>(".date-options")!.open = true;
  if (busy) root.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = true));
}

function print() {
  if (!selected) return;
  document.getElementById("print-root")?.remove();
  const node = document.createElement("div");
  node.id = "print-root";
  node.innerHTML = receipt(selected);
  node.style.display = "none";
  document.body.appendChild(node);
  window.print();
}

async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true; message = ""; success = false; render();
  try { await action(); }
  catch (error) { message = error instanceof Error ? error.message : "Something went wrong. Please try again."; }
  finally { busy = false; render(); }
}

async function openProtected(target: ProtectedView) {
  await store.logout();
  admin = false; loginTarget = target; view = "login";
}

async function afterLogin() {
  admin = true;
  roster = await store.roster();
  try { rates = await store.getRates(); } catch { rates = { driver: 1300, cook: 1300, cashier: 1300 }; }
  if (loginTarget === "history") [records, reviews] = await Promise.all([store.history(), store.getReviews()]);
  if (loginTarget === "expenses") [records, companies, expenses, storeCashEntries, dailySales, monthlyRentCents] = await Promise.all([store.allHistory(), store.getCompanies(), store.getExpenses(), store.getStoreCash(), store.getDailySales(), store.getMonthlyRent()]);
  if (loginTarget === "inventory") inventory = await store.getInventory();
  view = loginTarget;
}

root.addEventListener("input", (event) => {
  const el = event.target as HTMLInputElement;
  if (el.dataset.draft) {
    if (el.dataset.draft === "startDate" || el.dataset.draft === "endDate") customDates = true;
    (draft as unknown as Record<string, unknown>)[el.dataset.draft] = el.value;
    pending = null;
  }
  if (el.hasAttribute("data-reason")) reason = el.value;
  const form = el.closest<HTMLFormElement>("form[data-kind]");
  if (form?.dataset.kind && el.name) {
    entryInputs[form.dataset.kind] ||= {};
    entryInputs[form.dataset.kind][el.name] = el.value;
  }
});

root.addEventListener("keydown", (event) => {
  const el = event.target as HTMLInputElement;
  const form = el.closest<HTMLFormElement>("form[data-kind]");
  if (event.key === " " && el.name === "billNumber" && form) {
    event.preventDefault();
    form.querySelector<HTMLInputElement>('[name="amount"], [name="billTotal"]')?.focus();
  } else if (event.key === " " && (el.name === "amount" || el.name === "billTotal") && form?.querySelector('[name="deliveryFee"]')) {
    event.preventDefault();
    form.querySelector<HTMLInputElement>('[name="deliveryFee"]')?.focus();
  }
});

root.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement;
  if (el.dataset.draft) {
    if (el.dataset.draft === "startDate" || el.dataset.draft === "endDate") customDates = true;
    (draft as unknown as Record<string, unknown>)[el.dataset.draft] = el.value;
    if (el.dataset.draft === "employeeId" && cashoutRole === "driver" && !editId) {
      const startingCash = cashFlows.reduce((sum, entry) => sum + (entry.date === today() && entry.employeeId === el.value ? entry.amountCents : 0), 0);
      draft.startingCash = (startingCash / 100).toFixed(2);
    }
    pending = null; render();
  }
  if (el.hasAttribute("data-reason")) reason = el.value;
  if (el.id === "filter-employee") filterEmployee = el.value;
  if (el.id === "filter-date") filterDate = el.value;
  if (el.id === "expense-month") expenseMonth = el.value;
  if (["filter-employee", "filter-date", "expense-month"].includes(el.id)) render();
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement, data = new FormData(form);
  void run(async () => {
    switch (form.dataset.form) {
      case "entry": {
        const kind = form.dataset.kind as EntryKind;
        const editingId = editingListEntry?.kind === kind ? editingListEntry.id : "";
        if (!editingId && Object.keys(draft[kind]).length >= 200) throw new Error("Maximum 200 entries per section.");
        const bill = billNumber(String(data.get("billNumber")));
        if (Object.entries(draft[kind]).some(([id, e]) => id !== editingId && typeof e !== "number" && e.billNumber.toLowerCase() === bill.toLowerCase())) throw new Error("That bill is already in this section.");
        const id = editingId || Array.from({ length: 200 }, (_, i) => "e" + String(i).padStart(3, "0")).find((key) => !(key in draft[kind]))!;
        draft[kind][id] = { billNumber: bill, amountCents: kind === "deliveries" ? cents(String(data.get("amount"))) : cashCents(String(data.get("amount"))), ...(kind !== "deliveries" ? { deliveryFeeCents: cashCents(String(data.get("deliveryFee") || "0")) } : {}) };
        entryInputs[kind] = {}; editingListEntry = null; pending = null; break;
      }
      case "cash-delivery": {
        const editingId = editingListEntry?.kind === "cashDeliveries" ? editingListEntry.id : "";
        const bill = billNumber(String(data.get("billNumber")));
        if (Object.entries(draft.cashDeliveries).some(([id, e]) => id !== editingId && e.billNumber.toLowerCase() === bill.toLowerCase())) throw new Error("That cash bill is already entered in this section.");
        if (!editingId && Object.keys(draft.cashDeliveries).length >= 200) throw new Error("Maximum 200 cash deliveries.");
        const id = editingId || Array.from({ length: 200 }, (_, i) => "e" + String(i).padStart(3, "0")).find((key) => !(key in draft.cashDeliveries))!;
        draft.cashDeliveries[id] = { billNumber: bill, billTotalCents: cents(String(data.get("billTotal"))), deliveryFeeCents: cashCents(String(data.get("deliveryFee") || "0")) };
        entryInputs.cashDeliveries = {}; editingListEntry = null; pending = null; break;
      }
      case "login": await store.login(String(data.get("pin"))); await afterLogin(); break;
      case "device-login":
        await store.login(String(data.get("pin")));
        await store.authorizeDevice();
        await store.logout();
        [roster, rates, storeCashEntries, registerCash, cashFlows] = await Promise.all([store.roster(), store.getRates(), store.getStoreCash(), store.getRegisterCash(), store.getCashFlows()]);
        view = deviceTarget;
        message = "This computer is authorized. Employee tools will stay unlocked here.";
        success = true;
        break;
      case "employee": {
        const name = String(data.get("name")).trim(), phone = String(data.get("phone")).trim();
        const role = String(data.get("role")) as EmployeeRole;
        if (!name) throw new Error("Enter an employee name.");
        if (!phone) throw new Error("Enter the employee’s phone number.");
        if (Object.values(roster).some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new Error("An employee with that name already exists.");
        if (!["driver", "cook", "cashier"].includes(role)) throw new Error("Select an employee role.");
        await store.saveEmployee(crypto.randomUUID(), { name, phone, role }); roster = await store.roster();
        message = "Employee added."; success = true; break;
      }
      case "employee-edit": {
        const id = form.dataset.id!;
        const name = String(data.get("name")).trim(), phone = String(data.get("phone")).trim();
        const role = String(data.get("role")) as EmployeeRole;
        if (!name) throw new Error("Enter an employee name.");
        if (!phone) throw new Error("Enter the employee’s phone number.");
        if (Object.entries(roster).some(([otherId, employee]) => otherId !== id && employee.name.toLowerCase() === name.toLowerCase())) throw new Error("An employee with that name already exists.");
        if (!["driver", "cook", "cashier"].includes(role)) throw new Error("Select an employee role.");
        await store.saveEmployee(id, { ...roster[id], name, phone, role });
        roster = await store.roster(); editingEmployeeId = "";
        message = "Employee updated."; success = true; break;
      }
      case "rates": {
        const nextRates: Record<EmployeeRole, number> = {
          driver: cents(String(data.get("driver"))),
          cook: cents(String(data.get("cook"))),
          cashier: cents(String(data.get("cashier"))),
        };
        await Promise.all((Object.entries(nextRates) as [EmployeeRole, number][]).map(([role, value]) => store.setRate(role, value)));
        rates = nextRates;
        message = "Hourly rates updated. Existing shifts are unchanged."; success = true; break;
      }
      case "store-cash": {
        const bill = billNumber(String(data.get("billNumber")));
        if (storeCashEntries.some((entry) => entry.date === today() && entry.billNumber?.toLowerCase() === bill.toLowerCase())) throw new Error("That bill number is already entered today.");
        const entry: StoreCashEntry = { id: crypto.randomUUID(), billNumber: bill, date: today(), amountCents: salesCents(String(data.get("amount"))), createdAt: Date.now(), createdBy: store.uid() };
        if (entry.amountCents <= 0) throw new Error("Enter a cash amount greater than zero.");
        await store.saveStoreCash(entry);
        storeCashEntries = await store.getStoreCash();
        message = `Cash received saved: ${money(entry.amountCents)}.`; success = true; break;
      }
      case "store-cash-edit": {
        const id = form.dataset.id!, entry = storeCashEntries.find((item) => item.id === id);
        if (!entry) throw new Error("That cash entry could not be found.");
        const amountCents = salesCents(String(data.get("amount")));
        await store.correctStoreCash(id, { amountCents, editedAt: Date.now(), editedBy: store.uid() });
        storeCashEntries = await store.getStoreCash(); editingStoreCashId = "";
        message = `Bill ${entry.billNumber || "Not recorded"} corrected to ${money(amountCents)}.`; success = true; break;
      }
      case "register-cash": {
        const openingCashCents = salesCents(String(data.get("amount")));
        await store.login(String(data.get("pin")));
        try {
          await store.saveRegisterCash({ date: today(), openingCashCents, updatedAt: Date.now(), updatedBy: store.uid() });
        } finally {
          await store.logout();
        }
        registerCash = await store.getRegisterCash();
        message = `Opening register cash saved: ${money(openingCashCents)}.`; success = true; break;
      }
      case "cash-flow": {
        const employeeId = String(data.get("employeeId")), employee = roster[employeeId];
        if (!employee || employee.active === false || employeeRole(employee) !== "driver") throw new Error("Select an active driver.");
        const amountCents = salesCents(String(data.get("amount")));
        if (amountCents <= 0) throw new Error("Enter a cash flow amount greater than zero.");
        const entry: CashFlowEntry = { id: crypto.randomUUID(), employeeId, employeeName: employee.name, date: today(), amountCents, createdAt: Date.now(), createdBy: store.uid() };
        await store.saveCashFlow(entry);
        cashFlows = await store.getCashFlows();
        message = `${money(amountCents)} cash flow saved for ${employee.name}.`; success = true; break;
      }
      case "inventory-add": {
        const name = String(data.get("name")).trim(), targetType = String(data.get("targetType")) as InventoryTargetType;
        if (!name) throw new Error("Enter an inventory item name.");
        if (Object.values(inventory).some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error("That inventory item already exists.");
        if (targetType !== "quantity" && targetType !== "percentage") throw new Error("Select quantity or percentage.");
        const item: InventoryItem = { id: crypto.randomUUID(), name, targetType, targetValue: inventoryValue(String(data.get("targetValue")), targetType), currentValue: inventoryValue(String(data.get("currentValue")), targetType), updatedAt: Date.now(), updatedBy: store.uid() };
        await store.saveInventoryItem(item); inventory = await store.getInventory();
        message = `${name} added to inventory.`; success = true; break;
      }
      case "inventory-update": {
        const id = form.dataset.id!, existing = inventory[id];
        if (!existing) throw new Error("That inventory item could not be found.");
        const item: InventoryItem = { ...existing, targetValue: inventoryValue(String(data.get("targetValue")), existing.targetType), currentValue: inventoryValue(String(data.get("currentValue")), existing.targetType), updatedAt: Date.now(), updatedBy: store.uid() };
        await store.saveInventoryItem(item); inventory = await store.getInventory(); editingInventoryId = "";
        message = `${item.name} inventory updated.`; success = true; break;
      }
      case "daily-sales": {
        const salesDate = String(data.get("date"));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(salesDate)) throw new Error("Enter the sales date.");
        await store.saveDailySales({ date: salesDate, pcSalesCents: salesCents(String(data.get("pcSales"))), onlineOrdersCents: salesCents(String(data.get("onlineOrders"))), cloverGrossCents: salesCents(String(data.get("cloverGross"))), onlineReceivableCents: salesCents(String(data.get("onlineReceivable"))), updatedAt: Date.now(), updatedBy: store.uid() });
        dailySales = await store.getDailySales(); expenseMonth = salesDate.slice(0, 7);
        message = "Daily sales saved."; success = true; break;
      }
      case "monthly-rent": {
        monthlyRentCents = salesCents(String(data.get("amount")));
        await store.setMonthlyRent(monthlyRentCents);
        message = `Monthly rent saved: ${money(monthlyRentCents)}.`; success = true; break;
      }
      case "company": {
        const name = String(data.get("name")).trim();
        if (!name) throw new Error("Enter a company name.");
        if (Object.values(companies).some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error("That company already exists.");
        await store.saveCompany(crypto.randomUUID(), { name }); companies = await store.getCompanies();
        message = "Company added."; success = true; break;
      }
      case "expense": {
        const companyId = String(data.get("companyId")), company = companies[companyId], expenseDate = String(data.get("date"));
        if (!company) throw new Error("Select a company.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) throw new Error("Enter the order date.");
        const amountCents = salesCents(String(data.get("amount")));
        if (amountCents <= 0) throw new Error("Enter an order total greater than zero.");
        await store.saveExpense({ id: crypto.randomUUID(), companyId, companyName: company.name, date: expenseDate, amountCents, createdAt: Date.now(), createdBy: store.uid() });
        expenses = await store.getExpenses(); expenseMonth = expenseDate.slice(0, 7);
        message = "Order expense saved."; success = true; break;
      }
    }
  }).then(() => {
    if (form.dataset.form === "entry" || form.dataset.form === "cash-delivery") root.querySelector<HTMLInputElement>(`form[data-kind="${form.dataset.kind}"] input`)?.focus();
  });
});

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  void run(async () => {
    switch (button.dataset.action) {
      case "expense-tab": expenseTab = button.dataset.tab as ExpenseTab; break;
      case "edit-inventory": editingInventoryId = editingInventoryId === button.dataset.id ? "" : button.dataset.id!; break;
      case "cancel-inventory-edit": editingInventoryId = ""; break;
      case "reset-inventory": {
        const item = inventory[button.dataset.id!];
        if (!item) throw new Error("That inventory item could not be found.");
        await store.saveInventoryItem({ ...item, currentValue: item.targetValue, updatedAt: Date.now(), updatedBy: store.uid() });
        inventory = await store.getInventory(); editingInventoryId = ""; message = `${item.name} reset to its target.`; success = true; break;
      }
      case "protected-nav": await openProtected(button.dataset.view as ProtectedView); break;
      case "cashout-nav":
        if (admin) await store.logout();
        admin = false; deviceTarget = "cashout"; editingStoreCashId = ""; editId = ""; selected = null; view = "cashout";
        try {
          [roster, rates, cashFlows] = await Promise.all([store.roster(), store.getRates(), store.getCashFlows()]);
        } catch {
          view = "device-login";
        }
        break;
      case "store-cash-nav":
        if (admin) await store.logout();
        admin = false; deviceTarget = "store-cash"; editingStoreCashId = ""; editId = ""; selected = null; view = "store-cash";
        try {
          [roster, storeCashEntries, registerCash, cashFlows] = await Promise.all([store.roster(), store.getStoreCash(), store.getRegisterCash(), store.getCashFlows()]);
        } catch {
          view = "device-login";
        }
        break;
      case "cashout-role":
        cashoutRole = button.dataset.role as EmployeeRole;
        draft = fresh();
        editingListEntry = null;
        confirmed = emptyConfirmed();
        pending = null;
        break;
      case "back-history": [records, reviews] = await Promise.all([store.history(), store.getReviews()]); view = "history"; break;
      case "authorize-device": await store.authorizeDevice(); message = "This store computer is authorized for driver cash-outs."; success = true; break;
      case "done": {
        const kind = button.dataset.kind as ListKind;
        if (Array.from(root.querySelectorAll<HTMLInputElement>(`form[data-kind="${kind}"] input`)).some((input) => input.value.trim())) throw new Error("Add or clear the entry you typed before choosing Done.");
        confirmed[kind] = !confirmed[kind]; break;
      }
      case "edit-list-entry": {
        const kind = button.dataset.kind as ListKind, id = button.dataset.id!;
        editingListEntry = { kind, id }; confirmed[kind] = false;
        if (kind === "cashDeliveries") {
          const entry = draft.cashDeliveries[id];
          entryInputs[kind] = { billNumber: entry.billNumber, billTotal: (entry.billTotalCents / 100).toFixed(2), deliveryFee: ((entry.deliveryFeeCents || 0) / 100).toFixed(2) };
        } else {
          const entry = draft[kind][id];
          if (typeof entry === "number") throw new Error("This legacy entry can only be changed from History.");
          entryInputs[kind] = { billNumber: entry.billNumber, amount: (entry.amountCents / 100).toFixed(2), deliveryFee: ((entry.deliveryFeeCents || 0) / 100).toFixed(2) };
        }
        break;
      }
      case "remove": {
        const kind = button.dataset.kind as ListKind;
        delete draft[kind][button.dataset.id!];
        if (editingListEntry?.kind === kind && editingListEntry.id === button.dataset.id) {
          editingListEntry = null; entryInputs[kind] = {};
        }
        pending = null; break;
      }
      case "save": {
        confirmed = { deliveries: true, tips: true, onlineTips: true, cashDeliveries: true };
        const s = shift(); validateShift(s);
        if (editId) {
          if (!reason.trim()) throw new Error("Enter a reason for the correction.");
          await store.correct(editId, { ...s, reason: reason.trim(), editedAt: Date.now(), editedBy: store.uid() });
          records = await store.history(); selected = records.find((r) => r.id === editId) || null; editId = ""; view = "detail";
        } else {
          pending ||= { ...s, id: crypto.randomUUID(), createdBy: store.uid(), createdAt: Date.now() };
          await store.save(pending); selected = structuredClone(pending); view = "saved"; pending = null;
        }
        draft = fresh(); editingListEntry = null; Object.keys(entryInputs).forEach((key) => delete entryInputs[key]); confirmed = emptyConfirmed(); break;
      }
      case "print": print(); break;
      case "new": selected = null; draft = fresh(); editingListEntry = null; confirmed = emptyConfirmed(); [roster, rates] = await Promise.all([store.roster(), store.getRates()]); view = "cashout"; break;
      case "demo-login": await store.login(""); await afterLogin(); break;
      case "demo-device-login": view = deviceTarget; message = "Demo computer authorized."; success = true; break;
      case "edit-employee": editingEmployeeId = button.dataset.id!; break;
      case "cancel-employee-edit": editingEmployeeId = ""; break;
      case "delete-employee": {
        const id = button.dataset.id!;
        if (!window.confirm(`Delete ${roster[id].name}? Their saved history will remain.`)) return;
        await store.deleteEmployee(id); roster = await store.roster(); message = "Employee deleted."; success = true; break;
      }
      case "detail": selected = records.find((r) => r.id === button.dataset.id)!; view = "detail"; break;
      case "set-review":
        if (!selected) return;
        await store.setReview(selected.id, button.dataset.status as ReviewStatus);
        reviews = await store.getReviews();
        message = button.dataset.status === "reviewed" ? "Cash-out marked as paid and reviewed." : "Cash-out marked as partially paid and under review.";
        success = true;
        break;
      case "delete-shift":
        if (!selected || !window.confirm(`Permanently delete ${current(selected).employeeName}’s shift from ${date(current(selected).start)}?`)) return;
        await store.deleteShift(selected.id); records = await store.history(); selected = null; view = "history"; message = "Shift deleted."; success = true; break;
      case "delete-expense":
        if (!window.confirm("Delete this order expense?")) return;
        await store.deleteExpense(button.dataset.id!); expenses = await store.getExpenses(); message = "Expense deleted."; success = true; break;
      case "delete-daily-sales":
        if (!window.confirm(`Delete daily sales for ${button.dataset.date}?`)) return;
        await store.deleteDailySales(button.dataset.date!); dailySales = await store.getDailySales(); message = "Daily sales deleted."; success = true; break;
      case "delete-inventory": {
        const item = inventory[button.dataset.id!];
        if (!item || !window.confirm(`Delete ${item.name} from inventory?`)) return;
        await store.deleteInventoryItem(item.id); inventory = await store.getInventory(); editingInventoryId = ""; message = "Inventory item deleted."; success = true; break;
      }
      case "edit-store-cash": editingStoreCashId = button.dataset.id!; break;
      case "cancel-store-cash-edit": editingStoreCashId = ""; break;
      case "edit": {
        if (!selected) return;
        const s = current(selected); editId = selected.id;
        cashoutRole = shiftRole(s);
        draft = { employeeId: s.employeeId, startDate: localInput(s.start).slice(0, 10), endDate: localInput(s.end).slice(0, 10), start: localInput(s.start).slice(11), end: localInput(s.end).slice(11), deliveries: { ...s.deliveries }, tips: { ...s.tips }, onlineTips: { ...s.onlineTips }, startingCash: ((s.startingCashCents || 0) / 100).toFixed(2), cashDeliveries: { ...s.cashDeliveries } };
        confirmed = { deliveries: true, tips: true, onlineTips: true, cashDeliveries: true }; reason = ""; view = "cashout"; break;
      }
      case "cancel-edit": editId = ""; draft = fresh(); editingListEntry = null; confirmed = emptyConfirmed(); view = "detail"; break;
      case "load-all": [records, reviews] = await Promise.all([store.allHistory(), store.getReviews()]); break;
      case "clear-filters": filterEmployee = ""; filterDate = ""; break;
    }
  });
});

root.innerHTML = "<main><h1>Milano’s driver desk</h1><p>Loading…</p></main>";
void run(async () => {
  await store.init(); admin = false;
  try {
    [roster, rates, cashFlows] = await Promise.all([store.roster(), store.getRates(), store.getCashFlows()]);
  } catch {
    view = "device-login";
  }
});

setInterval(() => {
  if (view === "cashout" && !editId && !customDates && !draft.start && !draft.end && draft.startDate === draft.endDate && draft.startDate !== today()) {
    draft.startDate = today(); draft.endDate = today(); render();
  }
}, 60000);
