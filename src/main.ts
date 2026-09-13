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
let draft = fresh(),
  confirmed = { deliveries: false, tips: false },
  pending: Cashout | null = null,
  editId = "",
  reason = "",
  filterEmployee = "",
  filterDate = "";
function fresh() {
  return {
    employeeId: "",
    start: "",
    end: "",
    deliveries: {} as Record<string, number>,
    tips: {} as Record<string, number>,
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
    employeeId: draft.employeeId,
    employeeName: roster[draft.employeeId]?.name || "",
    start: new Date(draft.start).getTime(),
    end: new Date(draft.end).getTime(),
    rateCents: editId && selected ? current(selected).rateCents : rate,
    deliveries: { ...draft.deliveries },
    tips: { ...draft.tips },
  };
}
function receipt(record: Cashout) {
  const s = current(record),
    t = totals(s);
  return `<div class="receipt"><h2>MILANO’S PIZZERIA</h2><p>DRIVER CASH-OUT</p><hr><dl><dt>Driver</dt><dd>${esc(s.employeeName)}</dd><dt>Shift date</dt><dd>${date(s.start)}</dd><dt>Started</dt><dd>${time(s.start)}</dd><dt>Ended</dt><dd>${date(s.end) !== date(s.start) ? date(s.end) + " " : ""}${time(s.end)}</dd><dt>Hours</dt><dd>${hours(t.minutes)}</dd></dl><hr><dl><dt>Hourly pay</dt><dd>${money(t.wages)}</dd><dt>Delivery fees</dt><dd>${money(t.deliveries)}</dd><dt>Tips</dt><dd>${money(t.tips)}</dd></dl><div class="grand"><span>Total pay</span><strong>${money(t.total)}</strong></div><p style="font-size:10px">${esc(record.id.slice(0, 8).toUpperCase())}${record.corrections ? " · CORRECTED" : ""}${store.demo ? " · DEMO — NOT A PAYROLL RECORD" : ""}</p></div>`;
}
function entrySection(
  kind: "deliveries" | "tips",
  title: string,
  step: number,
) {
  const list = Object.entries(draft[kind]);
  return `<section class="card"><div class="row"><div class="section-head" style="margin:0"><span class="step">${step}</span><div><h2>${title}</h2><span class="subtle">${kind === "deliveries" ? "Add each delivery fee separately." : "Add each tip separately."}</span></div></div>${confirmed[kind] ? '<span class="pill">Done</span>' : ""}</div>${!confirmed[kind] ? `<form data-form="entry" data-kind="${kind}" class="entry-input"><input aria-label="${title} amount" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" required><button class="primary" type="submit">+ Add</button></form>` : ""}${list.length ? `<ol class="entry-list">${list.map(([id, amount], i) => `<li><span class="subtle">${kind === "deliveries" ? "Delivery" : "Tip"} ${i + 1}</span><span>${money(amount)} ${!confirmed[kind] ? `<button data-action="remove" data-kind="${kind}" data-id="${id}" aria-label="Remove ${title} ${i + 1}">×</button>` : ""}</span></li>`).join("")}</ol>` : '<p class="subtle">No entries yet. Choose Done if there are none.</p>'}<div class="row entry-footer"><span class="subtle">${list.length} ${list.length === 1 ? "entry" : "entries"} · <strong>${money(Object.values(draft[kind]).reduce((a, b) => a + b, 0))}</strong></span><button data-action="done" data-kind="${kind}">${confirmed[kind] ? "Edit entries" : "Done"}</button></div></section>`;
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
    )}</select>${!Object.keys(roster).length ? '<p class="subtle">An admin needs to add employees first.</p>' : ""}</div><div><label for="start">Shift started</label><input id="start" type="datetime-local" data-draft="start" value="${esc(draft.start)}"><button data-action="now" data-field="start" style="margin-top:8px">Start now</button></div><div><label for="end">Shift ended</label><input id="end" type="datetime-local" data-draft="end" value="${esc(draft.end)}"><button data-action="now" data-field="end" style="margin-top:8px">End now</button></div></div><p class="subtle">Times use this device’s local time. For an overnight shift, choose the following day as the end date.</p></section>${entrySection("deliveries", "Delivery fees", 2)}${entrySection("tips", "Tips", 3)}${editId ? `<section class="card"><label for="reason">Reason for correction</label><input id="reason" data-reason value="${esc(reason)}" maxlength="500" placeholder="Explain what changed and why"><p class="subtle">The original shift and every correction are retained.</p></section>` : ""}</div><aside class="card summary"><div class="eyebrow">Ready when you are</div><h2 style="margin-top:9px">Shift summary</h2><div class="summary-line"><span class="subtle">Driver</span><strong>${esc(s.employeeName || "Not selected")}</strong></div><div class="summary-line"><span class="subtle">Time worked</span><strong>${valid ? hours(t.minutes) : "—"}</strong></div><div class="summary-line"><span class="subtle">Hourly pay</span><strong>${valid ? money(t.wages) : "—"}</strong></div><div class="summary-line"><span class="subtle">Delivery fees</span><strong>${money(t.deliveries)}</strong></div><div class="summary-line"><span class="subtle">Tips</span><strong>${money(t.tips)}</strong></div><div class="grand"><span>Total pay</span><strong>${money((valid ? t.wages : 0) + t.deliveries + t.tips)}</strong></div><button class="red wide" data-action="save" ${busy ? "disabled" : ""}>${busy ? "Saving…" : editId ? "Save correction" : "Save & print cash-out"}</button><p class="print-note">${store.demo ? "Demo records stay in memory only." : "Your cash-out is saved before printing."}<br>Only totals appear on your receipt.</p>${editId ? '<button class="wide" data-action="cancel-edit">Cancel correction</button>' : ""}</aside></div>`;
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
      ? `<table><thead><tr><th>Driver / date</th><th>Hours</th><th>Hourly pay</th><th>Delivery fees</th><th>Tips</th><th>Total</th><th></th></tr></thead><tbody>${filtered
          .map((r) => {
            const s = current(r),
              t = totals(s);
            return `<tr><td><strong>${esc(s.employeeName)}</strong><br><span class="subtle">${date(s.start)}${r.corrections ? " · Corrected" : ""}</span></td><td>${hours(t.minutes)}</td><td>${money(t.wages)}</td><td>${money(t.deliveries)}</td><td>${money(t.tips)}</td><td><strong>${money(t.total)}</strong></td><td><button data-action="detail" data-id="${r.id}">View</button></td></tr>`;
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
  const items = (label: string, list: Record<string, number> = {}) =>
    `<details><summary>${label} · ${Object.keys(list).length} entries · ${money(Object.values(list).reduce((a, b) => a + b, 0))}</summary><ol>${
      Object.values(list)
        .map((amount) => `<li style="padding:8px">${money(amount)}</li>`)
        .join("") || '<p class="subtle">No entries.</p>'
    }</ol></details>`;
  return `<div class="detail"><button data-action="nav" data-view="history">← Back to history</button><h1 style="margin-top:20px">Shift record</h1><div class="row"><span class="subtle">${esc(s.employeeName)} · ${date(s.start)}</span><div class="row"><button data-action="edit">Correct</button><button class="primary" data-action="print">Reprint</button></div></div>${receipt(selected)}<section class="card"><h2>Itemized entries</h2>${items("Delivery fees", s.deliveries)}${items("Tips", s.tips)}<details><summary>Original record & correction history</summary><p class="subtle">Original submission: ${new Date(selected.createdAt).toLocaleString()}</p>${receipt({ ...selected, corrections: undefined })}${items("Original delivery fees", selected.deliveries)}${items("Original tips", selected.tips)}${Object.values(
    selected.corrections || {},
  )
    .sort((a, b) => b.editedAt - a.editedAt)
    .map(
      (c) =>
        `<details><summary>${new Date(c.editedAt).toLocaleString()} · ${esc(c.reason)}</summary><p class="subtle">Admin: ${esc(c.editedBy)}</p>${receipt({ ...selected!, ...c, corrections: undefined })}${items("Delivery fees", c.deliveries)}${items("Tips", c.tips)}</details>`,
    )
    .join("")}</details></section></div>`;
}
function render() {
  root.innerHTML = `<header><div class="brand"><span class="monogram">M</span><div><strong>milano’s</strong><small>PIZZERIA · DRIVER DESK</small></div></div><nav aria-label="Main navigation"><button data-action="nav" data-view="cashout" class="${view === "cashout" ? "active" : ""}">Cash-out</button>${admin ? `<button data-action="nav" data-view="history" class="${view === "history" ? "active" : ""}">History</button><button data-action="nav" data-view="employees" class="${view === "employees" ? "active" : ""}">Employees</button><button data-action="logout">Lock</button>` : '<button data-action="nav" data-view="login">Admin ↗</button>'}</nav></header>${store.demo ? '<div class="notice">Preview mode · Sample employees · Records are temporary and are cleared when you reload. Connect Firebase before using this for real shifts.</div>' : ""}<main>${message ? `<div role="alert" class="message ${success ? "success" : ""}">${esc(message)}</div>` : ""}${view === "cashout" ? cashout() : view === "login" ? loginView() : view === "history" && admin ? historyView() : view === "employees" && admin ? employeeView() : view === "detail" && admin ? detailView() : view === "saved" && selected ? `<div class="saved-heading"><span class="pill">${store.demo ? "Demo saved" : "Cash-out saved"}</span><h1>You’re all set.</h1><p class="subtle">If printing was cancelled, reprint below. Your shift is already saved.</p></div>${receipt(selected)}<div class="row" style="justify-content:center"><button data-action="print">Print receipt again</button><button class="primary" data-action="new">Next driver</button></div>` : ""}</main><footer>Milano’s Pizzeria · Driver cash-outs</footer>`;
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
root.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.draft) {
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
        const kind = form.dataset.kind as "deliveries" | "tips";
        if (Object.keys(draft[kind]).length >= 200)
          throw new Error("Maximum 200 entries per section.");
        draft[kind][
          Array.from(
            { length: 200 },
            (_, i) => "e" + String(i).padStart(3, "0"),
          ).find((id) => !(id in draft[kind]))!
        ] = cents(String(data.get("amount")));
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
    if (form.dataset.form === "entry")
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
          confirmed = { deliveries: false, tips: false };
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
        draft[b.dataset.field as "start" | "end"] = localInput(Date.now());
        pending = null;
        break;
      case "done": {
        const kind = b.dataset.kind as "deliveries" | "tips";
        const input = root.querySelector<HTMLInputElement>(
          `form[data-kind="${kind}"] input`,
        );
        if (input?.value.trim())
          throw new Error("Add the amount you typed before choosing Done.");
        confirmed[kind] = !confirmed[kind];
        break;
      }
      case "remove":
        delete draft[b.dataset.kind as "deliveries" | "tips"][b.dataset.id!];
        pending = null;
        break;
      case "save": {
        if (!confirmed.deliveries || !confirmed.tips)
          throw new Error(
            "Choose Done for both delivery fees and tips before saving.",
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
          confirmed = { deliveries: false, tips: false };
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
          confirmed = { deliveries: false, tips: false };
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
        pending = null;
        confirmed = { deliveries: false, tips: false };
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
        confirmed = { deliveries: false, tips: false };
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
          start: localInput(s.start),
          end: localInput(s.end),
          deliveries: { ...s.deliveries },
          tips: { ...s.tips },
        };
        confirmed = { deliveries: true, tips: true };
        reason = "";
        view = "cashout";
        break;
      }
      case "cancel-edit":
        editId = "";
        draft = fresh();
        confirmed = { deliveries: false, tips: false };
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
