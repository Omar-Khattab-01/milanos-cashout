import "./style.css";
import * as store from "./store";
import {
  amountOf, billNumber, billOf, cashTotals, cents, current, hours,
  localInput, money, total, totals, validateShift,
  type CashDelivery, type Cashout, type Company, type Employee,
  type EntryList, type Expense, type Shift,
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
type ProtectedView = "history" | "employees" | "expenses";

let roster: Record<string, Employee> = {};
let rate = 1300;
let admin = false;
let view = "cashout";
let loginTarget: ProtectedView = "history";
let message = "";
let success = false;
let busy = false;
let records: Cashout[] = [];
let selected: Cashout | null = null;
let companies: Record<string, Company> = {};
let expenses: Expense[] = [];
let expenseMonth = today().slice(0, 7);
let customDates = false;
let pending: Cashout | null = null;
let editId = "";
let editingEmployeeId = "";
let reason = "";
let filterEmployee = "";
let filterDate = "";
const entryInputs: Record<string, Record<string, string>> = {};
const emptyConfirmed = () => ({ deliveries: false, tips: false, onlineTips: false, cashDeliveries: true });
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
  return {
    schemaVersion: existing?.schemaVersion === 2 ? 2 : 3,
    employeeId: draft.employeeId,
    employeeName: existing?.employeeName || roster[draft.employeeId]?.name || "",
    start: new Date(`${draft.startDate}T${draft.start}`).getTime(),
    end: new Date(`${draft.endDate}T${draft.end}`).getTime(),
    rateCents: existing?.rateCents || rate,
    deliveries: { ...draft.deliveries }, tips: { ...draft.tips }, onlineTips: { ...draft.onlineTips },
    startingCashCents: /^\d+(\.\d{1,2})?$/.test(draft.startingCash)
      ? Math.round(Number(draft.startingCash) * 100) : NaN,
    cashDeliveries: { ...draft.cashDeliveries },
  };
}

function receipt(record: Cashout) {
  const s = current(record), t = totals(s), cash = cashTotals(s);
  return `<div class="receipt"><h2>MILANO’S PIZZERIA</h2><p>DRIVER CASH-OUT</p><hr><dl><dt>Driver</dt><dd>${esc(s.employeeName)}</dd><dt>Shift date</dt><dd>${date(s.start)}</dd><dt>Started</dt><dd>${time(s.start)}</dd><dt>Ended</dt><dd>${date(s.end) !== date(s.start) ? date(s.end) + " " : ""}${time(s.end)}</dd><dt>Hours</dt><dd>${hours(t.minutes)}</dd></dl><hr><dl><dt>Hourly pay</dt><dd>${money(t.wages)}</dd><dt>Delivery fees</dt><dd>${money(t.deliveries)}</dd><dt>Tips</dt><dd>${money(t.tips + t.cashTips)}</dd><dt>Tips Online</dt><dd>${money(t.onlineTips)}</dd></dl><div class="grand"><span>Total pay</span><strong>${money(t.total)}</strong></div><hr><dl><dt>Starting cash</dt><dd>${money(cash.startingCash)}</dd><dt>Cash bill totals</dt><dd>${money(cash.billTotals)}</dd><dt>Cash owed to store</dt><dd>${money(cash.owed)}</dd></dl><p style="font-size:11px">Earnings paid separately</p><p style="font-size:10px">${esc(record.id.slice(0, 8).toUpperCase())}${record.corrections ? " · CORRECTED" : ""}${store.demo ? " · DEMO — NOT A PAYROLL RECORD" : ""}</p></div>`;
}

function entryField(kind: ListKind, name: string, label: string, placeholder: string, moneyField = false) {
  const value = entryInputs[kind]?.[name] ?? "";
  return `<div><label for="${kind}-${name}">${label}</label><input id="${kind}-${name}" name="${name}" aria-label="${kind} ${label}" ${moneyField ? 'inputmode="decimal"' : 'inputmode="numeric" maxlength="40"'} placeholder="${placeholder}" value="${esc(value)}" autocomplete="off" required></div>`;
}

function entrySection(kind: EntryKind, title: string, step: number) {
  const list = Object.entries(draft[kind]);
  return `<section class="card"><div class="row"><div class="section-head" style="margin:0"><span class="step">${step}</span><div><h2>${title}</h2><span class="subtle">Bill number → Space → amount → Enter.</span></div></div>${confirmed[kind] ? '<span class="pill">Done</span>' : ""}</div>${!confirmed[kind] ? `<form data-form="entry" data-kind="${kind}" class="entry-input bill-input">${entryField(kind, "billNumber", "Bill number", "e.g. 1042")}${entryField(kind, "amount", "Amount", "0.00", true)}<button class="primary" type="submit">+ Add</button></form>` : ""}${list.length ? `<ol class="entry-list">${list.map(([id, entry], i) => `<li><span class="subtle">${i + 1}. Bill ${esc(billOf(entry))}</span><span>${money(amountOf(entry))} ${!confirmed[kind] ? `<button data-action="remove" data-kind="${kind}" data-id="${id}">×</button>` : ""}</span></li>`).join("")}</ol>` : '<p class="subtle">No entries yet.</p>'}<div class="row entry-footer"><span class="subtle">${list.length} entries · <strong>${money(total(draft[kind]))}</strong></span><button data-action="done" data-kind="${kind}">${confirmed[kind] ? "Edit entries" : "Done"}</button></div></section>`;
}

function cashSection() {
  const entries = Object.entries(draft.cashDeliveries), t = cashTotals(shift());
  return `<section class="card"><div class="section-head"><span class="step">5</span><div><h2>Cash flow</h2><span class="subtle">Starting cash and cash-paid bills.</span></div></div><label for="startingCash">Starting cash taken</label><input id="startingCash" inputmode="decimal" data-draft="startingCash" value="${esc(draft.startingCash)}"><p class="subtle">Leave at $0.00 if no cash was taken. A bill can also appear in another section when a customer splits payment.</p><h3>Cash deliveries</h3>${!confirmed.cashDeliveries ? `<form data-form="cash-delivery" data-kind="cashDeliveries" class="entry-input bill-input">${entryField("cashDeliveries", "billNumber", "Bill number", "e.g. 1042")}${entryField("cashDeliveries", "billTotal", "Bill total", "0.00", true)}<button type="submit" class="primary">+ Add</button></form>` : ""}${entries.length ? `<ol class="entry-list">${entries.map(([id, e]) => `<li><span>Bill ${esc(e.billNumber)}</span><span>${money(e.billTotalCents)} ${!confirmed.cashDeliveries ? `<button data-action="remove" data-kind="cashDeliveries" data-id="${id}">×</button>` : ""}</span></li>`).join("")}</ol>` : '<p class="subtle">No cash deliveries entered.</p>'}<div class="entry-footer"><div class="row"><span class="subtle">${entries.length} cash bills · <strong>${money(t.billTotals)}</strong></span><button data-action="done" data-kind="cashDeliveries">${confirmed.cashDeliveries ? "Add / edit cash deliveries" : "Done"}</button></div></div></section>`;
}

function cashout() {
  const s = shift(), t = totals(s), cash = cashTotals(s);
  const valid = Number.isFinite(t.minutes) && t.minutes > 0 && t.minutes <= 1440;
  return `<div class="intro"><div><div class="eyebrow">Driver cash-out</div><h1>${editId ? "Correct this shift" : "Let’s wrap up your shift."}</h1><span class="subtle">Enter your hours, delivery fees, and tips.</span></div><span class="pill">${money(s.rateCents)} / hour</span></div><div class="layout"><div><section class="card"><div class="section-head"><span class="step">1</span><div><h2>Your shift</h2><span class="subtle">Choose your name and shift times.</span></div></div><div class="fields"><div class="full"><label for="employee">Driver name</label><select id="employee" data-draft="employeeId" ${editId ? "disabled" : ""}><option value="">Select your name</option>${Object.entries(roster).filter(([id, e]) => e.active !== false || id === draft.employeeId).map(([id, e]) => `<option value="${esc(id)}" ${draft.employeeId === id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>${!Object.keys(roster).length ? '<p class="subtle">An admin needs to add employees first.</p>' : ""}</div><div><label for="start">Start time</label><input id="start" type="time" data-draft="start" value="${esc(draft.start)}"></div><div><label for="end">End time</label><input id="end" type="time" data-draft="end" value="${esc(draft.end)}"></div></div><p class="subtle">Start date: ${esc(draft.startDate)} · End date: ${esc(draft.endDate)}<br>Fill this in at the end of your shift.</p><details class="date-options"><summary>Change dates / overnight shift</summary><div class="fields"><div><label for="startDate">Start date</label><input id="startDate" type="date" data-draft="startDate" value="${esc(draft.startDate)}"></div><div><label for="endDate">End date</label><input id="endDate" type="date" data-draft="endDate" value="${esc(draft.endDate)}"></div></div></details></section>${entrySection("deliveries", "Delivery fees", 2)}${entrySection("tips", "Tips", 3)}${entrySection("onlineTips", "Tips Online", 4)}${cashSection()}${editId ? `<section class="card"><label for="reason">Reason for correction</label><input id="reason" data-reason value="${esc(reason)}" maxlength="500" placeholder="Explain what changed and why"><p class="subtle">The original shift and every correction are retained.</p></section>` : ""}</div><aside class="card summary"><div class="eyebrow">Ready when you are</div><h2 style="margin-top:9px">Shift summary</h2><div class="summary-line"><span class="subtle">Driver</span><strong>${esc(s.employeeName || "Not selected")}</strong></div><div class="summary-line"><span class="subtle">Time worked</span><strong>${valid ? hours(t.minutes) : "—"}</strong></div><div class="summary-line"><span class="subtle">Hourly pay</span><strong>${valid ? money(t.wages) : "—"}</strong></div><div class="summary-line"><span class="subtle">Delivery fees</span><strong>${money(t.deliveries)}</strong></div><div class="summary-line"><span class="subtle">Tips</span><strong>${money(t.tips + t.cashTips)}</strong></div><div class="summary-line"><span class="subtle">Tips Online</span><strong>${money(t.onlineTips)}</strong></div><div class="grand"><span>Total pay</span><strong>${money((valid ? t.wages : 0) + t.deliveries + t.tips + t.onlineTips + t.cashTips)}</strong></div><div class="summary-line"><span class="subtle">Starting cash</span><strong>${Number.isFinite(s.startingCashCents) ? money(cash.startingCash) : "—"}</strong></div><div class="summary-line"><span class="subtle">Cash bill totals</span><strong>${money(cash.billTotals)}</strong></div><div class="grand"><span>Cash owed to store</span><strong>${Number.isFinite(s.startingCashCents) ? money(cash.owed) : "—"}</strong></div><p class="subtle">Starting cash plus cash bill totals. Earnings are paid separately.</p><button class="red wide" data-action="save">${busy ? "Saving…" : editId ? "Save correction" : "Save & print cash-out"}</button><p class="print-note">${store.demo ? "Demo records stay in memory only." : "Your cash-out is saved before printing."}<br>Only totals appear on your receipt.</p>${editId ? '<button class="wide" data-action="cancel-edit">Cancel correction</button>' : ""}</aside></div>`;
}

function loginView() {
  const names: Record<ProtectedView, string> = { history: "Cash-out history", employees: "Employees & pay", expenses: "Monthly expenses" };
  return `<section class="card login"><div class="eyebrow">Protected section</div><h1>${names[loginTarget]}</h1><p class="subtle">Enter the admin PIN to open this section.</p>${store.demo ? '<p class="message">Demo admin preview.</p><button class="primary wide" data-action="demo-login">Explore this section</button>' : '<form data-form="login"><label for="pin">Admin PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="Enter 4-digit PIN" required autofocus><button class="primary wide" type="submit">Unlock</button></form>'}</section>`;
}

function deviceLoginView() {
  return `<section class="card login"><div class="eyebrow">Store computer setup</div><h1>Unlock driver cash-outs</h1><p class="subtle">Enter the admin PIN once to authorize this computer. The cash-out page will stay unlocked in this browser.</p>${store.demo ? '<button class="primary wide" data-action="demo-device-login">Authorize demo computer</button>' : '<form data-form="device-login"><label for="device-pin">Admin PIN</label><input id="device-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="Enter 4-digit PIN" required autofocus><button class="primary wide" type="submit">Authorize this computer</button></form>'}</section>`;
}

function historyView() {
  const filtered = records.filter((r) => (!filterEmployee || current(r).employeeId === filterEmployee) && (!filterDate || localInput(current(r).start).slice(0, 10) === filterDate));
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Cash-out history</h1><span class="subtle">Review, correct, reprint, or delete saved shifts.</span></div><button data-action="load-all">Load all history</button></div><div class="toolbar"><select id="filter-employee"><option value="">All employees</option>${Object.entries(roster).map(([id, e]) => `<option value="${esc(id)}" ${filterEmployee === id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select><input id="filter-date" type="date" value="${filterDate}"><button data-action="clear-filters">Clear filters</button></div><section class="card table-wrap"><p class="subtle">${records.length} loaded · ${filtered.length} matching shifts.</p>${filtered.length ? `<table><thead><tr><th>Driver / date</th><th>Hours</th><th>Employee cost</th><th>Cash owed</th><th></th></tr></thead><tbody>${filtered.map((r) => { const s = current(r), t = totals(s); return `<tr><td><strong>${esc(s.employeeName)}</strong><br><span class="subtle">${date(s.start)}${r.corrections ? " · Corrected" : ""}</span></td><td>${hours(t.minutes)}</td><td><strong>${money(t.total)}</strong></td><td>${money(cashTotals(s).owed)}</td><td><button data-action="detail" data-id="${r.id}">View</button></td></tr>`; }).join("")}</tbody></table>` : '<div class="empty">No cash-outs found.</div>'}</section>`;
}

function employeeView() {
  const employeeRows = Object.entries(roster).map(([id, employee]) => {
    if (editingEmployeeId === id)
      return `<form data-form="employee-edit" data-id="${id}" class="employee"><div style="flex:1"><label for="edit-name-${id}">Employee name</label><input id="edit-name-${id}" name="name" value="${esc(employee.name)}" maxlength="80" required><label for="edit-phone-${id}">Phone number</label><input id="edit-phone-${id}" name="phone" type="tel" value="${esc(employee.phone || "")}" placeholder="Phone number" maxlength="30" required></div><div><button class="primary" type="submit">Save</button><button type="button" data-action="cancel-employee-edit">Cancel</button></div></form>`;
    return `<div class="employee"><div class="row"><span class="avatar">${esc(employee.name[0])}</span><div><strong>${esc(employee.name)}</strong><br><span class="subtle">${esc(employee.phone || "No phone number")}</span></div></div><div class="row"><button data-action="edit-employee" data-id="${id}">Edit</button><button data-action="delete-employee" data-id="${id}">Delete</button></div></div>`;
  }).join("");
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Employees & pay</h1><span class="subtle">Add drivers and keep contact information current.</span></div></div><div class="split"><section class="card"><h2>Employees</h2>${employeeRows || '<p class="subtle">No employees yet.</p>'}<form data-form="employee" style="margin-top:24px"><label for="name">Add employee</label><div class="fields"><div><input id="name" name="name" placeholder="Full name" maxlength="80" required></div><div><input id="phone" name="phone" type="tel" placeholder="Phone number" maxlength="30" required></div></div><button class="primary" type="submit">Add employee</button></form><p class="subtle">Deleting removes the employee from the driver list. Saved shift history remains.</p></section><section class="card"><h2>Store computer</h2><p class="subtle">Authorize this computer once so drivers can use it without signing in.</p><button data-action="authorize-device">Authorize this store computer</button><hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><h2>Hourly pay rate</h2><p class="subtle">One rate for all drivers. Saved shifts keep their original rate.</p><form data-form="rate"><label for="rate">Dollars per hour</label><div class="entry-input"><input id="rate" name="rate" inputmode="decimal" value="${(rate / 100).toFixed(2)}" required><button type="submit" class="primary">Save rate</button></div></form></section></div>`;
}

function expensesView() {
  const monthExpenses = expenses.filter((e) => e.date.startsWith(expenseMonth));
  const monthShifts = records.filter((r) => localInput(current(r).start).startsWith(expenseMonth));
  const foodCost = monthExpenses.reduce((sum, e) => sum + e.amountCents, 0);
  const employeeCost = monthShifts.reduce((sum, r) => sum + totals(current(r)).total, 0);
  const byCompany = monthExpenses.reduce<Record<string, number>>((result, e) => {
    result[e.companyName] = (result[e.companyName] || 0) + e.amountCents;
    return result;
  }, {});
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Monthly expenses</h1><span class="subtle">Track supplier orders and compare food and employee costs.</span></div><input id="expense-month" type="month" value="${expenseMonth}"></div><div class="split"><section class="card"><h2>Monthly overview</h2><div class="summary-line"><span>Food cost</span><strong>${money(foodCost)}</strong></div><div class="summary-line"><span>Employee cost</span><strong>${money(employeeCost)}</strong></div><div class="grand"><span>Total tracked cost</span><strong>${money(foodCost + employeeCost)}</strong></div><p class="subtle">Employee cost is the full driver pay total from saved shifts in this month.</p>${Object.keys(byCompany).length ? `<h3>Food cost by company</h3>${Object.entries(byCompany).sort((a, b) => b[1] - a[1]).map(([name, amount]) => `<div class="summary-line"><span>${esc(name)}</span><strong>${money(amount)}</strong></div>`).join("")}` : ""}</section><section class="card"><h2>Add supplier company</h2><form data-form="company"><label for="company-name">Company name</label><div class="entry-input"><input id="company-name" name="name" maxlength="100" placeholder="Supplier name" required><button class="primary" type="submit">Add</button></div></form><h2 style="margin-top:28px">Add order expense</h2><form data-form="expense"><label for="expense-company">Company</label><select id="expense-company" name="companyId" required><option value="">Select company</option>${Object.entries(companies).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, c]) => `<option value="${esc(id)}">${esc(c.name)}</option>`).join("")}</select><label for="expense-date">Order date</label><input id="expense-date" name="date" type="date" value="${today()}" required><label for="expense-amount">Total ordered</label><input id="expense-amount" name="amount" inputmode="decimal" placeholder="0.00" required><button class="primary wide" type="submit">Save expense</button></form></section></div><section class="card table-wrap"><h2>Orders for ${esc(expenseMonth)}</h2>${monthExpenses.length ? `<table><thead><tr><th>Date</th><th>Company</th><th>Total</th><th></th></tr></thead><tbody>${monthExpenses.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.companyName)}</td><td>${money(e.amountCents)}</td><td><button data-action="delete-expense" data-id="${e.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No supplier orders entered for this month.</div>'}</section>`;
}

function detailView() {
  if (!selected) return "";
  const s = current(selected);
  const items = (label: string, list: EntryList = {}) => `<details><summary>${label} · ${Object.keys(list).length} entries · ${money(total(list))}</summary><ol>${Object.values(list).map((entry) => `<li style="padding:8px">Bill ${esc(billOf(entry))} · ${money(amountOf(entry))}</li>`).join("") || '<p class="subtle">No entries.</p>'}</ol></details>`;
  const cashItems = (value: Shift) => `<details><summary>Cash deliveries · ${Object.keys(value.cashDeliveries || {}).length} bills · ${money(cashTotals(value).billTotals)}</summary><p>Starting cash: ${money(value.startingCashCents || 0)}</p><ol>${Object.values(value.cashDeliveries || {}).map((e) => `<li>Bill ${esc(e.billNumber)} · ${money(e.billTotalCents)}</li>`).join("") || "<p>No cash deliveries.</p>"}</ol></details>`;
  return `<div class="detail"><button data-action="back-history">← Back to history</button><h1 style="margin-top:20px">Shift record</h1><div class="row"><span class="subtle">${esc(s.employeeName)} · ${date(s.start)}</span><div class="row"><button data-action="edit">Correct</button><button class="primary" data-action="print">Reprint</button><button data-action="delete-shift">Delete shift</button></div></div>${receipt(selected)}<section class="card"><h2>Itemized entries</h2>${items("Delivery fees", s.deliveries)}${items("Tips", s.tips)}${items("Tips Online", s.onlineTips)}${cashItems(s)}<details><summary>Original record & correction history</summary><p class="subtle">Original submission: ${new Date(selected.createdAt).toLocaleString()}</p>${receipt({ ...selected, corrections: undefined })}${Object.values(selected.corrections || {}).sort((a, b) => b.editedAt - a.editedAt).map((c) => `<details><summary>${new Date(c.editedAt).toLocaleString()} · ${esc(c.reason)}</summary>${receipt({ ...c, id: selected!.id, createdBy: selected!.createdBy, createdAt: selected!.createdAt })}</details>`).join("")}</details></section></div>`;
}

function render() {
  const datesOpen = root.querySelector<HTMLDetailsElement>(".date-options")?.open;
  root.innerHTML = `<header><div class="brand"><span class="monogram">M</span><div><strong>milano’s</strong><small>PIZZERIA · DRIVER DESK</small></div></div><nav aria-label="Main navigation"><button data-action="cashout-nav" class="${view === "cashout" || view === "device-login" ? "active" : ""}">Cash-out</button><button data-action="protected-nav" data-view="history" class="${view === "history" || view === "detail" ? "active" : ""}">History</button><button data-action="protected-nav" data-view="employees" class="${view === "employees" ? "active" : ""}">Employees</button><button data-action="protected-nav" data-view="expenses" class="${view === "expenses" ? "active" : ""}">Expenses</button></nav></header>${store.demo ? '<div class="notice">Preview mode · Records are temporary and cleared when you reload.</div>' : ""}<main>${message ? `<div role="alert" class="message ${success ? "success" : ""}">${esc(message)}</div>` : ""}${view === "cashout" ? cashout() : view === "device-login" ? deviceLoginView() : view === "login" ? loginView() : view === "history" && admin ? historyView() : view === "employees" && admin ? employeeView() : view === "expenses" && admin ? expensesView() : view === "detail" && admin ? detailView() : view === "saved" && selected ? `<div class="saved-heading"><span class="pill">${store.demo ? "Demo saved" : "Cash-out saved"}</span><h1>You’re all set.</h1><p class="subtle">Your shift is saved.</p></div>${receipt(selected)}<div class="row" style="justify-content:center"><button data-action="print">Print receipt again</button><button class="primary" data-action="new">Next driver</button></div>` : ""}</main><footer>Milano’s Pizzeria · Driver cash-outs</footer>`;
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
  try { rate = await store.getRate(); } catch { rate = 1300; }
  if (loginTarget === "history") records = await store.history();
  if (loginTarget === "expenses") [records, companies, expenses] = await Promise.all([store.allHistory(), store.getCompanies(), store.getExpenses()]);
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
  if (event.key === " " && el.name === "billNumber" && el.closest("form[data-kind]")) {
    event.preventDefault();
    el.closest("form")!.querySelector<HTMLInputElement>('[name="amount"], [name="billTotal"]')?.focus();
  }
});

root.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement;
  if (el.dataset.draft) {
    if (el.dataset.draft === "startDate" || el.dataset.draft === "endDate") customDates = true;
    (draft as unknown as Record<string, unknown>)[el.dataset.draft] = el.value;
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
        if (Object.keys(draft[kind]).length >= 200) throw new Error("Maximum 200 entries per section.");
        const bill = billNumber(String(data.get("billNumber")));
        if (Object.values(draft[kind]).some((e) => typeof e !== "number" && e.billNumber.toLowerCase() === bill.toLowerCase())) throw new Error("That bill is already in this section.");
        const id = Array.from({ length: 200 }, (_, i) => "e" + String(i).padStart(3, "0")).find((key) => !(key in draft[kind]))!;
        draft[kind][id] = { billNumber: bill, amountCents: cents(String(data.get("amount"))) };
        entryInputs[kind] = {}; pending = null; break;
      }
      case "cash-delivery": {
        const bill = billNumber(String(data.get("billNumber")));
        if (Object.values(draft.cashDeliveries).some((e) => e.billNumber.toLowerCase() === bill.toLowerCase())) throw new Error("That cash bill is already entered in this section.");
        if (Object.keys(draft.cashDeliveries).length >= 200) throw new Error("Maximum 200 cash deliveries.");
        const id = Array.from({ length: 200 }, (_, i) => "e" + String(i).padStart(3, "0")).find((key) => !(key in draft.cashDeliveries))!;
        draft.cashDeliveries[id] = { billNumber: bill, billTotalCents: cents(String(data.get("billTotal"))) };
        entryInputs.cashDeliveries = {}; pending = null; break;
      }
      case "login": await store.login(String(data.get("pin"))); await afterLogin(); break;
      case "device-login":
        await store.login(String(data.get("pin")));
        await store.authorizeDevice();
        await store.logout();
        [roster, rate] = await Promise.all([store.roster(), store.getRate()]);
        view = "cashout";
        message = "This computer is authorized. Driver cash-outs will stay unlocked here.";
        success = true;
        break;
      case "employee": {
        const name = String(data.get("name")).trim(), phone = String(data.get("phone")).trim();
        if (!name) throw new Error("Enter an employee name.");
        if (!phone) throw new Error("Enter the employee’s phone number.");
        if (Object.values(roster).some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new Error("An employee with that name already exists.");
        await store.saveEmployee(crypto.randomUUID(), { name, phone }); roster = await store.roster();
        message = "Employee added."; success = true; break;
      }
      case "employee-edit": {
        const id = form.dataset.id!;
        const name = String(data.get("name")).trim(), phone = String(data.get("phone")).trim();
        if (!name) throw new Error("Enter an employee name.");
        if (!phone) throw new Error("Enter the employee’s phone number.");
        if (Object.entries(roster).some(([otherId, employee]) => otherId !== id && employee.name.toLowerCase() === name.toLowerCase())) throw new Error("An employee with that name already exists.");
        await store.saveEmployee(id, { ...roster[id], name, phone });
        roster = await store.roster(); editingEmployeeId = "";
        message = "Employee updated."; success = true; break;
      }
      case "rate": {
        const newRate = cents(String(data.get("rate")));
        await store.setRate(newRate); rate = newRate;
        message = "Hourly rate updated. Existing shifts are unchanged."; success = true; break;
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
        await store.saveExpense({ id: crypto.randomUUID(), companyId, companyName: company.name, date: expenseDate, amountCents: cents(String(data.get("amount"))), createdAt: Date.now(), createdBy: store.uid() });
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
      case "protected-nav": await openProtected(button.dataset.view as ProtectedView); break;
      case "cashout-nav":
        if (admin) await store.logout();
        admin = false; editId = ""; selected = null; view = "cashout";
        try {
          [roster, rate] = await Promise.all([store.roster(), store.getRate()]);
        } catch {
          view = "device-login";
        }
        break;
      case "back-history": records = await store.history(); view = "history"; break;
      case "authorize-device": await store.authorizeDevice(); message = "This store computer is authorized for driver cash-outs."; success = true; break;
      case "done": {
        const kind = button.dataset.kind as ListKind;
        if (Array.from(root.querySelectorAll<HTMLInputElement>(`form[data-kind="${kind}"] input`)).some((input) => input.value.trim())) throw new Error("Add or clear the entry you typed before choosing Done.");
        confirmed[kind] = !confirmed[kind]; break;
      }
      case "remove": delete draft[button.dataset.kind as ListKind][button.dataset.id!]; pending = null; break;
      case "save": {
        confirmed = { deliveries: true, tips: true, onlineTips: true, cashDeliveries: true };
        const s = shift(); validateShift(s);
        if (editId) {
          if (!reason.trim()) throw new Error("Enter a reason for the correction.");
          await store.correct(editId, { ...s, reason: reason.trim(), editedAt: Date.now(), editedBy: store.uid() });
          records = await store.history(); selected = records.find((r) => r.id === editId) || null; editId = ""; view = "detail";
        } else {
          pending ||= { ...s, id: crypto.randomUUID(), createdBy: store.uid(), createdAt: Date.now() };
          await store.save(pending); selected = structuredClone(pending); view = "saved"; pending = null; render(); print();
        }
        draft = fresh(); Object.keys(entryInputs).forEach((key) => delete entryInputs[key]); confirmed = emptyConfirmed(); break;
      }
      case "print": print(); break;
      case "new": selected = null; draft = fresh(); confirmed = emptyConfirmed(); [roster, rate] = await Promise.all([store.roster(), store.getRate()]); view = "cashout"; break;
      case "demo-login": await store.login(""); await afterLogin(); break;
      case "demo-device-login": view = "cashout"; message = "Demo computer authorized."; success = true; break;
      case "edit-employee": editingEmployeeId = button.dataset.id!; break;
      case "cancel-employee-edit": editingEmployeeId = ""; break;
      case "delete-employee": {
        const id = button.dataset.id!;
        if (!window.confirm(`Delete ${roster[id].name}? Their saved history will remain.`)) return;
        await store.deleteEmployee(id); roster = await store.roster(); message = "Employee deleted."; success = true; break;
      }
      case "detail": selected = records.find((r) => r.id === button.dataset.id)!; view = "detail"; break;
      case "delete-shift":
        if (!selected || !window.confirm(`Permanently delete ${current(selected).employeeName}’s shift from ${date(current(selected).start)}?`)) return;
        await store.deleteShift(selected.id); records = await store.history(); selected = null; view = "history"; message = "Shift deleted."; success = true; break;
      case "delete-expense":
        if (!window.confirm("Delete this order expense?")) return;
        await store.deleteExpense(button.dataset.id!); expenses = await store.getExpenses(); message = "Expense deleted."; success = true; break;
      case "edit": {
        if (!selected) return;
        const s = current(selected); editId = selected.id;
        draft = { employeeId: s.employeeId, startDate: localInput(s.start).slice(0, 10), endDate: localInput(s.end).slice(0, 10), start: localInput(s.start).slice(11), end: localInput(s.end).slice(11), deliveries: { ...s.deliveries }, tips: { ...s.tips }, onlineTips: { ...s.onlineTips }, startingCash: ((s.startingCashCents || 0) / 100).toFixed(2), cashDeliveries: { ...s.cashDeliveries } };
        confirmed = { deliveries: true, tips: true, onlineTips: true, cashDeliveries: true }; reason = ""; view = "cashout"; break;
      }
      case "cancel-edit": editId = ""; draft = fresh(); confirmed = emptyConfirmed(); view = "detail"; break;
      case "load-all": records = await store.allHistory(); break;
      case "clear-filters": filterEmployee = ""; filterDate = ""; break;
    }
  });
});

root.innerHTML = "<main><h1>Milano’s driver desk</h1><p>Loading…</p></main>";
void run(async () => {
  await store.init(); admin = false;
  try {
    [roster, rate] = await Promise.all([store.roster(), store.getRate()]);
  } catch {
    view = "device-login";
  }
});

setInterval(() => {
  if (view === "cashout" && !editId && !customDates && !draft.start && !draft.end && draft.startDate === draft.endDate && draft.startDate !== today()) {
    draft.startDate = today(); draft.endDate = today(); render();
  }
}, 60000);
