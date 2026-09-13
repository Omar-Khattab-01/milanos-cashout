import "./style.css";
import * as store from "./store";
import {
  cents,
  money,
  totals,
  validateShift,
  current,
  localInput,
  hours,
  type Shift,
  type Cashout,
  type Employee,
  type EntryList,
  type CashDelivery,
  total,
  amountOf,
  billOf,
  billNumber,
  cashCents,
  cashTotals,
} from "./model";
const root = document.querySelector<HTMLDivElement>("#app")!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let roster: Record<string, Employee> = {},
  rate = 1300,
  admin = false,
  view = "cashout",
  message = "",
  success = false,
  busy = false,
  records: Cashout[] = [],
  selected: Cashout | null = null;
type EntryKind = "deliveries" | "tips" | "onlineTips";
type ListKind = EntryKind | "cashDeliveries";
const today = () => localInput(Date.now()).slice(0, 10);
const emptyConfirmed = () => ({
  deliveries: false,
  tips: false,
  onlineTips: false,
  cashDeliveries: true,
});
const entryInputs: Record<string, Record<string, string>> = {};
let customDates = false;
let draft = fresh(),
  confirmed = emptyConfirmed(),
  pending: Cashout | null = null,
  editId = "",
  reason = "",
  filterEmployee = "",
  filterDate = "";
function fresh() {
  customDates = false;
  return {
    employeeId: "",
    startDate: today(),
    endDate: today(),
    start: "",
    end: "",
    deliveries: {} as EntryList,
    tips: {} as EntryList,
    onlineTips: {} as EntryList,
    startingCash: "0.00",
    cashDeliveries: {} as Record<string, CashDelivery>,
  };
}
const date = (time: number) =>
  new Date(time).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const time = (value: number) =>
  new Date(value).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
function shift(): Shift {
  return {
    schemaVersion: 2,
    employeeId: draft.employeeId,
    employeeName: roster[draft.employeeId]?.name || "",
    start: new Date(`${draft.startDate}T${draft.start}`).getTime(),
    end: new Date(`${draft.endDate}T${draft.end}`).getTime(),
    rateCents: editId && selected ? current(selected).rateCents : rate,
    deliveries: { ...draft.deliveries },
    tips: { ...draft.tips },
    onlineTips: { ...draft.onlineTips },
    startingCashCents: /^\d+(\.\d{1,2})?$/.test(draft.startingCash)
      ? Math.round(Number(draft.startingCash) * 100)
      : NaN,
    cashDeliveries: { ...draft.cashDeliveries },
  };
}
function receipt(record: Cashout) {
  const s = current(record),
    t = totals(s);
  return `<div class="receipt"><h2>MILANO’S PIZZERIA</h2><p>DRIVER CASH-OUT</p><hr><dl><dt>Driver</dt><dd>${esc(s.employeeName)}</dd><dt>Shift date</dt><dd>${date(s.start)}</dd><dt>Started</dt><dd>${time(s.start)}</dd><dt>Ended</dt><dd>${date(s.end) !== date(s.start) ? date(s.end) + " " : ""}${time(s.end)}</dd><dt>Hours</dt><dd>${hours(t.minutes)}</dd></dl><hr><dl><dt>Hourly pay</dt><dd>${money(t.wages)}</dd><dt>Delivery fees</dt><dd>${money(t.deliveries)}</dd><dt>Tips</dt><dd>${money(t.tips)}</dd><dt>Cash tips (calculated)</dt><dd>${money(t.cashTips)}</dd><dt>Tips Online</dt><dd>${money(t.onlineTips)}</dd></dl><div class="grand"><span>Total pay</span><strong>${money(t.total)}</strong></div><hr><dl><dt>Starting cash</dt><dd>${money(s.startingCashCents || 0)}</dd><dt>Cash bill totals</dt><dd>${money(cashTotals(s).billTotals)}</dd><dt>Cash received</dt><dd>${money(cashTotals(s).received)}</dd><dt>Change given</dt><dd>${money(cashTotals(s).change)}</dd><dt>Cash owed to store</dt><dd>${money(cashTotals(s).owed)}</dd></dl><p style="font-size:11px">Earnings paid separately</p><p style="font-size:10px">${esc(record.id.slice(0, 8).toUpperCase())}${record.corrections ? " · CORRECTED" : ""}${store.demo ? " · DEMO — NOT A PAYROLL RECORD" : ""}</p></div>`;
}
function entryField(
  kind: ListKind,
  name: string,
  label: string,
  placeholder: string,
  moneyField = false,
) {
  const value =
    entryInputs[kind]?.[name] ?? (name === "changeGiven" ? "0.00" : "");
  return `<div><label for="${kind}-${name}">${label}</label><input id="${kind}-${name}" name="${name}" aria-label="${kind} ${label}" ${moneyField ? 'inputmode="decimal"' : 'inputmode="numeric" maxlength="40"'} placeholder="${placeholder}" value="${esc(value)}" autocomplete="off" required></div>`;
}
function entrySection(kind: EntryKind, title: string, step: number) {
  const list = Object.entries(draft[kind]);
  return `<section class="card"><div class="row"><div class="section-head" style="margin:0"><span class="step">${step}</span><div><h2>${title}</h2><span class="subtle">${kind === "tips" ? "Cash-delivery tips are calculated below. " : ""}Amount → Space → bill number → Enter.</span></div></div>${confirmed[kind] ? '<span class="pill">Done</span>' : ""}</div>${!confirmed[kind] ? `<form data-form="entry" data-kind="${kind}" class="entry-input bill-input">${entryField(kind, "amount", "Amount", "0.00", true)}${entryField(kind, "billNumber", "Bill number", "e.g. 1042")}<button class="primary" type="submit">+ Add</button></form>` : ""}${list.length ? `<ol class="entry-list">${list.map(([id, entry], i) => `<li><span class="subtle">${i + 1}. Bill ${esc(billOf(entry))}</span><span>${money(amountOf(entry))} ${!confirmed[kind] ? `<button data-action="remove" data-kind="${kind}" data-id="${id}" aria-label="Remove ${title} ${i + 1}">×</button>` : ""}</span></li>`).join("")}</ol>` : '<p class="subtle">No entries yet. Choose Done if there are none.</p>'}<div class="row entry-footer"><span class="subtle">${list.length} entries · <strong>${money(total(draft[kind]))}</strong></span><button data-action="done" data-kind="${kind}">${confirmed[kind] ? "Edit entries" : "Done"}</button></div></section>`;
}
function cashSection() {
  const kind = "cashDeliveries",
    entries = Object.entries(draft.cashDeliveries),
    t = cashTotals(shift());
  return `<section class="card"><div class="section-head"><span class="step">5</span><div><h2>Cash flow</h2><span class="subtle">Cash taken for change and cash-paid bills.</span></div></div><label for="startingCash">Starting cash taken</label><input id="startingCash" inputmode="decimal" data-draft="startingCash" value="${esc(draft.startingCash)}"><p class="subtle">Leave at $0.00 if you did not take any cash for change.</p><h3>Cash deliveries</h3><p class="subtle">Enter cash received before giving change. Tips are calculated automatically.</p>${!confirmed.cashDeliveries ? `<form data-form="cash-delivery" data-kind="${kind}" class="entry-input cash-input">${entryField(kind, "billNumber", "Bill number", "e.g. 1042")}${entryField(kind, "billTotal", "Bill total", "0.00", true)}${entryField(kind, "cashCollected", "Cash received", "0.00", true)}${entryField(kind, "changeGiven", "Change given", "0.00", true)}<button type="submit" class="primary">+ Add</button></form>` : ""}${entries.length ? `<ol class="entry-list">${entries.map(([id, e]) => `<li><div>Bill ${esc(e.billNumber)}<br><span class="subtle">Bill total ${money(e.billTotalCents)} · Received ${money(e.cashCollectedCents)}<br>Change ${money(e.changeGivenCents)} · Tip ${money(e.cashCollectedCents - e.changeGivenCents - e.billTotalCents)}</span></div>${!confirmed.cashDeliveries ? `<button data-action="remove" data-kind="cashDeliveries" data-id="${id}" aria-label="Remove cash bill ${esc(e.billNumber)}">×</button>` : ""}</li>`).join("")}</ol>` : '<p class="subtle">No cash deliveries entered.</p>'}<div class="entry-footer"><div class="row"><span class="subtle">${entries.length} cash bills · Collected <strong>${money(t.collected)}</strong></span><button data-action="done" data-kind="cashDeliveries">${confirmed.cashDeliveries ? "Add / edit cash deliveries" : "Done"}</button></div></div></section>`;
}
function cashout() {
  const s = shift(),
    t = totals(s),
    valid = Number.isFinite(t.minutes) && t.minutes > 0 && t.minutes <= 1440;
  return `<div class="intro"><div><div class="eyebrow">Driver cash-out</div><h1>${editId ? "Correct this shift" : "Let’s wrap up your shift."}</h1><span class="subtle">Enter your hours, delivery fees, and tips.</span></div><span class="pill">${money(s.rateCents)} / hour</span></div><div class="layout"><div><section class="card"><div class="section-head"><span class="step">1</span><div><h2>Your shift</h2><span class="subtle">Choose your name and shift times.</span></div></div><div class="fields"><div class="full"><label for="employee">Driver name</label><select id="employee" data-draft="employeeId" ${editId ? "disabled" : ""}><option value="">Select your name</option>${Object.entries(
    roster,
  )
    .filter(([id, e]) => e.active || id === draft.employeeId)
    .map(
      ([id, e]) =>
        `<option value="${esc(id)}" ${draft.employeeId === id ? "selected" : ""}>${esc(e.name)}</option>`,
    )
    .join(
      "",
    )}</select>${!Object.keys(roster).length ? '<p class="subtle">An admin needs to add employees first.</p>' : ""}</div><div><label for="start">Start time</label><input id="start" type="time" data-draft="start" value="${esc(draft.start)}"></div><div><label for="end">End time</label><input id="end" type="time" data-draft="end" value="${esc(draft.end)}"></div></div><p class="subtle">Start date: ${esc(draft.startDate)} · End date: ${esc(draft.endDate)}<br>Fill this in at the end of your shift.</p><details class="date-options"><summary>Change dates / overnight shift</summary><div class="fields"><div><label for="startDate">Start date</label><input id="startDate" type="date" data-draft="startDate" value="${esc(draft.startDate)}"></div><div><label for="endDate">End date</label><input id="endDate" type="date" data-draft="endDate" value="${esc(draft.endDate)}"></div></div></details></section>${entrySection("deliveries", "Delivery fees", 2)}${entrySection("tips", "Tips", 3)}${entrySection("onlineTips", "Tips Online", 4)}${cashSection()}${editId ? `<section class="card"><label for="reason">Reason for correction</label><input id="reason" data-reason value="${esc(reason)}" maxlength="500" placeholder="Explain what changed and why"><p class="subtle">The original shift and every correction are retained.</p></section>` : ""}</div><aside class="card summary"><div class="eyebrow">Ready when you are</div><h2 style="margin-top:9px">Shift summary</h2><div class="summary-line"><span class="subtle">Driver</span><strong>${esc(s.employeeName || "Not selected")}</strong></div><div class="summary-line"><span class="subtle">Time worked</span><strong>${valid ? hours(t.minutes) : "—"}</strong></div><div class="summary-line"><span class="subtle">Hourly pay</span><strong>${valid ? money(t.wages) : "—"}</strong></div><div class="summary-line"><span class="subtle">Delivery fees</span><strong>${money(t.deliveries)}</strong></div><div class="summary-line"><span class="subtle">Tips</span><strong>${money(t.tips)}</strong></div><div class="summary-line"><span class="subtle">Tips Online</span><strong>${money(t.onlineTips)}</strong></div><div class="summary-line"><span class="subtle">Cash tips (calculated)</span><strong>${money(t.cashTips)}</strong></div><div class="grand"><span>Total pay</span><strong>${money((valid ? t.wages : 0) + t.deliveries + t.tips + t.onlineTips + t.cashTips)}</strong></div><div class="summary-line"><span class="subtle">Starting cash</span><strong>${Number.isFinite(s.startingCashCents) ? money(s.startingCashCents || 0) : "—"}</strong></div><div class="summary-line"><span class="subtle">Cash received</span><strong>${money(cashTotals(s).received)}</strong></div><div class="summary-line"><span class="subtle">Change given</span><strong>${money(cashTotals(s).change)}</strong></div><div class="grand"><span>Cash owed to store</span><strong>${Number.isFinite(s.startingCashCents) ? money(cashTotals(s).owed) : "—"}</strong></div><p class="subtle">Return the starting cash and all cash kept after change. Earnings are paid separately.</p><button class="red wide" data-action="save" ${busy ? "disabled" : ""}>${busy ? "Saving…" : editId ? "Save correction" : "Save & print cash-out"}</button><p class="print-note">${store.demo ? "Demo records stay in memory only." : "Your cash-out is saved before printing."}<br>Only totals appear on your receipt.</p>${editId ? '<button class="wide" data-action="cancel-edit">Cancel correction</button>' : ""}</aside></div>`;
}
function loginView() {
  return `<section class="card login"><div class="eyebrow">Management</div><h1>Admin access</h1><p class="subtle">Manage employees, review cash-outs, and reprint receipts.</p>${store.demo ? '<p class="message">Demo only. Admin access here is a preview.</p><button class="primary wide" data-action="demo-login">Explore demo admin</button>' : '<form data-form="login"><label for="pin">Admin PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="Enter 4-digit PIN" required><button class="primary wide" type="submit">Unlock admin</button></form>'}</section>`;
}
function historyView() {
  const filtered = records.filter(
    (r) =>
      (!filterEmployee || current(r).employeeId === filterEmployee) &&
      (!filterDate || localInput(current(r).start).slice(0, 10) === filterDate),
  );
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Cash-out history</h1><span class="subtle">Review shifts, individual entries, and saved receipts.</span></div><button data-action="load-all">Load all history</button></div><div class="toolbar"><select id="filter-employee" aria-label="Filter employee"><option value="">All employees</option>${Object.entries(
    roster,
  )
    .map(
      ([id, e]) =>
        `<option value="${esc(id)}" ${filterEmployee === id ? "selected" : ""}>${esc(e.name)}</option>`,
    )
    .join(
      "",
    )}</select><input id="filter-date" type="date" aria-label="Filter shift date" value="${filterDate}"><button data-action="clear-filters">Clear filters</button></div><section class="card table-wrap"><p class="subtle">${records.length} loaded · ${filtered.length} matching shifts. Initially shows the latest 500 submissions.</p>${
    filtered.length
      ? `<table><thead><tr><th>Driver / date</th><th>Hours</th><th>Hourly pay</th><th>Delivery fees</th><th>Tips</th><th>Tips Online</th><th>Cash tips</th><th>Cash owed</th><th>Total</th><th></th></tr></thead><tbody>${filtered
          .map((r) => {
            const s = current(r),
              t = totals(s);
            return `<tr><td><strong>${esc(s.employeeName)}</strong><br><span class="subtle">${date(s.start)}${r.corrections ? " · Corrected" : ""}</span></td><td>${hours(t.minutes)}</td><td>${money(t.wages)}</td><td>${money(t.deliveries)}</td><td>${money(t.tips)}</td><td>${money(t.onlineTips)}</td><td>${money(t.cashTips)}</td><td>${money(cashTotals(s).owed)}</td><td><strong>${money(t.total)}</strong></td><td><button data-action="detail" data-id="${r.id}">View</button></td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<div class="empty">No cash-outs found. Saved shifts will appear here.</div>'
  }</section>`;
}
function employeeView() {
  return `<div class="intro"><div><div class="eyebrow">Management</div><h1>Employees & pay</h1><span class="subtle">Keep the driver list up to date.</span></div></div><div class="split"><section class="card"><h2>Employees</h2>${Object.entries(
    roster,
  )
    .map(
      ([id, e]) =>
        `<div class="employee"><div class="row"><span class="avatar">${esc(e.name[0])}</span><div><strong>${esc(e.name)}</strong><br><span class="subtle">${e.active ? "Active" : "Inactive"}</span></div></div><button data-action="toggle-employee" data-id="${id}">${e.active ? "Deactivate" : "Reactivate"}</button></div>`,
    )
    .join(
      "",
    )}<form data-form="employee" style="margin-top:24px"><label for="name">Add employee</label><div class="entry-input"><input id="name" name="name" placeholder="Full name" maxlength="80" required><button class="primary" type="submit">Add</button></div></form><p class="subtle">Deactivating a driver keeps their cash-out history.</p></section><section class="card"><h2>Store computer</h2><p class="subtle">Authorize this computer once so drivers can select their names without signing in.</p><button data-action="authorize-device">Authorize this store computer</button><hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><h2>Hourly pay rate</h2><p class="subtle">One rate for all drivers. Saved shifts keep their original rate.</p><form data-form="rate"><label for="rate">Dollars per hour</label><div class="entry-input"><input id="rate" name="rate" inputmode="decimal" value="${(rate / 100).toFixed(2)}" required><button type="submit" class="primary">Save rate</button></div></form></section></div>`;
}
function detailView() {
  if (!selected) return "";
  const s = current(selected);
  const items = (label: string, list: EntryList = {}) =>
    `<details><summary>${label} · ${Object.keys(list).length} entries · ${money(total(list))}</summary><ol>${
      Object.values(list)
        .map(
          (entry) =>
            `<li style="padding:8px">Bill ${esc(billOf(entry))} · ${money(amountOf(entry))}</li>`,
        )
        .join("") || '<p class="subtle">No entries.</p>'
    }</ol></details>`;
  const cashItems = (s: Shift) =>
    `<details><summary>Cash deliveries · ${Object.keys(s.cashDeliveries || {}).length} bills</summary><p>Starting cash: ${money(s.startingCashCents || 0)}</p><ol>${
      Object.values(s.cashDeliveries || {})
        .map(
          (e) =>
            `<li>Bill ${esc(e.billNumber)} · Total ${money(e.billTotalCents)} · Received ${money(e.cashCollectedCents)} · Change ${money(e.changeGivenCents)} · Tip ${money(e.cashCollectedCents - e.changeGivenCents - e.billTotalCents)}</li>`,
        )
        .join("") || "<p>No cash deliveries.</p>"
    }</ol></details>`;
  return `<div class="detail"><button data-action="nav" data-view="history">← Back to history</button><h1 style="margin-top:20px">Shift record</h1><div class="row"><span class="subtle">${esc(s.employeeName)} · ${date(s.start)}</span><div class="row"><button data-action="edit">Correct</button><button class="primary" data-action="print">Reprint</button></div></div>${receipt(selected)}<section class="card"><h2>Itemized entries</h2>${items("Delivery fees", s.deliveries)}${items("Tips", s.tips)}${items("Tips Online", s.onlineTips)}${cashItems(s)}<details><summary>Original record & correction history</summary><p class="subtle">Original submission: ${new Date(selected.createdAt).toLocaleString()}</p>${receipt({ ...selected, corrections: undefined })}${items("Original delivery fees", selected.deliveries)}${items("Original tips", selected.tips)}${items("Original Tips Online", selected.onlineTips)}${cashItems(selected)}${Object.values(
    selected.corrections || {},
  )
    .sort((a, b) => b.editedAt - a.editedAt)
    .map(
      (c) =>
        `<details><summary>${new Date(c.editedAt).toLocaleString()} · ${esc(c.reason)}</summary><p class="subtle">Admin: ${esc(c.editedBy)}</p>${receipt({ ...c, id: selected!.id, createdBy: selected!.createdBy, createdAt: selected!.createdAt })}${items("Delivery fees", c.deliveries)}${items("Tips", c.tips)}${items("Tips Online", c.onlineTips)}${cashItems(c)}</details>`,
    )
    .join("")}</details></section></div>`;
}
function render() {
  const datesOpen =
    root.querySelector<HTMLDetailsElement>(".date-options")?.open;
  root.innerHTML = `<header><div class="brand"><span class="monogram">M</span><div><strong>milano’s</strong><small>PIZZERIA · DRIVER DESK</small></div></div><nav aria-label="Main navigation"><button data-action="nav" data-view="cashout" class="${view === "cashout" ? "active" : ""}">Cash-out</button>${admin ? `<button data-action="nav" data-view="history" class="${view === "history" ? "active" : ""}">History</button><button data-action="nav" data-view="employees" class="${view === "employees" ? "active" : ""}">Employees</button><button data-action="logout">Lock</button>` : '<button data-action="nav" data-view="login">Admin ↗</button>'}</nav></header>${store.demo ? '<div class="notice">Preview mode · Sample employees · Records are temporary and are cleared when you reload. Connect Firebase before using this for real shifts.</div>' : ""}<main>${message ? `<div role="alert" class="message ${success ? "success" : ""}">${esc(message)}</div>` : ""}${view === "cashout" ? cashout() : view === "login" ? loginView() : view === "history" && admin ? historyView() : view === "employees" && admin ? employeeView() : view === "detail" && admin ? detailView() : view === "saved" && selected ? `<div class="saved-heading"><span class="pill">${store.demo ? "Demo saved" : "Cash-out saved"}</span><h1>You’re all set.</h1><p class="subtle">If printing was cancelled, reprint below. Your shift is already saved.</p></div>${receipt(selected)}<div class="row" style="justify-content:center"><button data-action="print">Print receipt again</button><button class="primary" data-action="new">Next driver</button></div>` : ""}</main><footer>Milano’s Pizzeria · Driver cash-outs</footer>`;
  if (datesOpen) {
    const dates = root.querySelector<HTMLDetailsElement>(".date-options");
    if (dates) dates.open = true;
  }
  if (busy)
    root
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
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
  busy = true;
  message = "";
  success = false;
  root
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => (b.disabled = true));
  try {
    await action();
  } catch (error) {
    message =
      error instanceof Error
        ? error.message
        : "Something went wrong. Please try again.";
  } finally {
    busy = false;
    render();
  }
}
root.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.draft) {
    if (el.dataset.draft === "startDate" || el.dataset.draft === "endDate")
      customDates = true;
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
root.addEventListener("keydown", (e) => {
  const el = e.target as HTMLInputElement;
  if (e.key === " " && el.name === "amount" && el.closest("form[data-kind]")) {
    e.preventDefault();
    el.closest("form")!
      .querySelector<HTMLInputElement>('[name="billNumber"]')
      ?.focus();
  }
});
root.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.draft) {
    if (el.dataset.draft === "startDate" || el.dataset.draft === "endDate")
      customDates = true;
    (draft as unknown as Record<string, unknown>)[el.dataset.draft] = el.value;
    pending = null;
    render();
  }
  if (el.hasAttribute("data-reason")) reason = el.value;
  if (el.id === "filter-employee") {
    filterEmployee = el.value;
    render();
  }
  if (el.id === "filter-date") {
    filterDate = el.value;
    render();
  }
});
root.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement,
    data = new FormData(form);
  void run(async () => {
    switch (form.dataset.form) {
      case "entry": {
        const kind = form.dataset.kind as EntryKind;
        if (Object.keys(draft[kind]).length >= 200)
          throw new Error("Maximum 200 entries per section.");
        const bill = billNumber(String(data.get("billNumber")));
        if (
          Object.values(draft[kind]).some(
            (e) =>
              typeof e !== "number" &&
              e.billNumber.toLowerCase() === bill.toLowerCase(),
          )
        )
          throw new Error(
            "That bill is already in this section. Remove its entry before replacing it.",
          );
        if (
          kind === "tips" &&
          Object.values(draft.cashDeliveries).some(
            (e) => e.billNumber.toLowerCase() === bill.toLowerCase(),
          )
        )
          throw new Error(
            "This bill’s cash tip is already calculated in Cash deliveries.",
          );
        const id = Array.from(
          { length: 200 },
          (_, i) => "e" + String(i).padStart(3, "0"),
        ).find((id) => !(id in draft[kind]))!;
        draft[kind][id] = {
          amountCents: cents(String(data.get("amount"))),
          billNumber: bill,
        };
        entryInputs[kind] = {};
        pending = null;
        break;
      }
      case "cash-delivery": {
        const bill = billNumber(String(data.get("billNumber")));
        if (
          Object.values(draft.cashDeliveries).some(
            (e) => e.billNumber.toLowerCase() === bill.toLowerCase(),
          )
        )
          throw new Error("That cash bill is already entered.");
        if (Object.keys(draft.cashDeliveries).length >= 200)
          throw new Error("Maximum 200 cash deliveries.");
        const id = Array.from(
          { length: 200 },
          (_, i) => "e" + String(i).padStart(3, "0"),
        ).find((id) => !(id in draft.cashDeliveries))!;
        const cashEntry = {
          billNumber: bill,
          billTotalCents: cents(String(data.get("billTotal"))),
          cashCollectedCents: cashCents(String(data.get("cashCollected"))),
          changeGivenCents: cashCents(String(data.get("changeGiven"))),
        };
        if (
          cashEntry.cashCollectedCents - cashEntry.changeGivenCents <
          cashEntry.billTotalCents
        )
          throw new Error(
            "Cash received minus change must cover the bill total.",
          );
        if (
          Object.values(draft.tips).some(
            (e) =>
              typeof e !== "number" &&
              e.billNumber.toLowerCase() === bill.toLowerCase(),
          )
        )
          throw new Error(
            "Remove the separate tip for this bill; its cash tip will be calculated automatically.",
          );
        draft.cashDeliveries[id] = cashEntry;
        entryInputs.cashDeliveries = {};
        pending = null;
        break;
      }
      case "login":
        await store.login(String(data.get("pin")));
        admin = true;
        roster = await store.roster();
        try {
          rate = await store.getRate();
        } catch {
          rate = 1300;
        }
        records = await store.history();
        view = "history";
        break;
      case "employee": {
        const name = String(data.get("name")).trim();
        if (!name) throw new Error("Enter an employee name.");
        if (
          Object.values(roster).some(
            (e) => e.name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw new Error("An employee with that name already exists.");
        await store.saveEmployee(crypto.randomUUID(), { name, active: true });
        roster = await store.roster();
        break;
      }
      case "rate":
        {
          const newRate = cents(String(data.get("rate")));
          await store.setRate(newRate);
          rate = newRate;
        }
        message = "Hourly rate updated. Existing shifts are unchanged.";
        success = true;
        break;
    }
  }).then(() => {
    if (form.dataset.form === "entry" || form.dataset.form === "cash-delivery")
      root
        .querySelector<HTMLInputElement>(
          `form[data-kind="${form.dataset.kind}"] input`,
        )
        ?.focus();
  });
});
root.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!b) return;
  void run(async () => {
    switch (b.dataset.action) {
      case "nav": {
        if (editId) {
          editId = "";
          draft = fresh();
          for (const key of Object.keys(entryInputs)) delete entryInputs[key];
          confirmed = emptyConfirmed();
        }
        view = b.dataset.view!;
        if (view === "history" && admin) records = await store.history();
        if (view === "cashout") {
          roster = await store.roster();
          rate = await store.getRate();
        }
        break;
      }
      case "authorize-device":
        await store.authorizeDevice();
        message = "This store computer is authorized for driver cash-outs.";
        success = true;
        break;
      case "now":
        draft[b.dataset.field as "start" | "end"] = localInput(
          Date.now(),
        ).slice(11);
        pending = null;
        break;
      case "done": {
        const kind = b.dataset.kind as ListKind;
        const inputs = root.querySelectorAll<HTMLInputElement>(
          `form[data-kind="${kind}"] input`,
        );
        if (
          Array.from(inputs).some((input) =>
            input.name === "changeGiven"
              ? Number(input.value) !== 0
              : !!input.value.trim(),
          )
        )
          throw new Error(
            "Add or clear the entry you typed before choosing Done.",
          );
        confirmed[kind] = !confirmed[kind];
        break;
      }
      case "remove":
        delete draft[b.dataset.kind as ListKind][b.dataset.id!];
        pending = null;
        break;
      case "save": {
        if (Object.values(confirmed).some((done) => !done))
          throw new Error(
            "Choose Done for delivery fees, tips, online tips, and cash deliveries before saving.",
          );
        const s = shift();
        validateShift(s);
        if (editId) {
          if (!reason.trim())
            throw new Error("Enter a reason for the correction.");
          await store.correct(editId, {
            ...s,
            reason: reason.trim(),
            editedAt: Date.now(),
            editedBy: store.uid(),
          });
          records = await store.history();
          selected = records.find((r) => r.id === editId) || null;
          editId = "";
          view = "detail";
          draft = fresh();
          for (const key of Object.keys(entryInputs)) delete entryInputs[key];
          confirmed = emptyConfirmed();
        } else {
          pending ||= {
            ...s,
            id: crypto.randomUUID(),
            createdBy: store.uid(),
            createdAt: Date.now(),
          };
          await store.save(pending);
          selected = structuredClone(pending);
          view = "saved";
          draft = fresh();
          for (const key of Object.keys(entryInputs)) delete entryInputs[key];
          confirmed = emptyConfirmed();
          pending = null;
          render();
          print();
        }
        break;
      }
      case "print":
        print();
        break;
      case "new":
        selected = null;
        draft = fresh();
        for (const key of Object.keys(entryInputs)) delete entryInputs[key];
        pending = null;
        confirmed = emptyConfirmed();
        roster = await store.roster();
        rate = await store.getRate();
        view = "cashout";
        break;
      case "demo-login":
        await store.login("");
        admin = true;
        roster = await store.roster();
        try {
          rate = await store.getRate();
        } catch {
          rate = 1300;
        }
        records = await store.history();
        view = "history";
        break;
      case "logout":
        await store.logout();
        admin = false;
        records = [];
        selected = null;
        editId = "";
        draft = fresh();
        for (const key of Object.keys(entryInputs)) delete entryInputs[key];
        confirmed = emptyConfirmed();
        view = "cashout";
        break;
      case "toggle-employee": {
        const id = b.dataset.id!;
        await store.saveEmployee(id, {
          ...roster[id],
          active: !roster[id].active,
        });
        roster = await store.roster();
        break;
      }
      case "detail":
        selected = records.find((r) => r.id === b.dataset.id)!;
        view = "detail";
        break;
      case "edit": {
        if (!selected) return;
        const s = current(selected);
        editId = selected.id;
        draft = {
          employeeId: s.employeeId,
          startDate: localInput(s.start).slice(0, 10),
          endDate: localInput(s.end).slice(0, 10),
          start: localInput(s.start).slice(11),
          end: localInput(s.end).slice(11),
          deliveries: { ...s.deliveries },
          tips: { ...s.tips },
          onlineTips: { ...s.onlineTips },
          startingCash: ((s.startingCashCents || 0) / 100).toFixed(2),
          cashDeliveries: { ...s.cashDeliveries },
        };
        confirmed = {
          deliveries: true,
          tips: true,
          onlineTips: true,
          cashDeliveries: true,
        };
        reason = "";
        view = "cashout";
        break;
      }
      case "cancel-edit":
        editId = "";
        draft = fresh();
        for (const key of Object.keys(entryInputs)) delete entryInputs[key];
        confirmed = emptyConfirmed();
        view = "detail";
        break;
      case "load-all":
        records = await store.allHistory();
        break;
      case "clear-filters":
        filterEmployee = "";
        filterDate = "";
        break;
    }
  });
});
root.innerHTML = "<main><h1>Milano’s driver desk</h1><p>Loading…</p></main>";
void run(async () => {
  await store.init();
  admin = await store.isAdmin();
  try {
    [roster, rate] = await Promise.all([store.roster(), store.getRate()]);
  } catch {
    throw new Error(
      "Setup needed: an admin must sign in, set the hourly rate, and authorize this store computer under Employees.",
    );
  }
});

setInterval(() => {
  if (
    view === "cashout" &&
    !editId &&
    !customDates &&
    !draft.start &&
    !draft.end &&
    draft.startDate === draft.endDate &&
    draft.startDate !== today()
  ) {
    draft.startDate = today();
    draft.endDate = today();
    render();
  }
}, 60000);
