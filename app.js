"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const FIELDS = ITEM_FIELDS;

let items = [];
let states = PURCHASE_STATES;
let weightTypes = WEIGHT_TYPES;
let configs = [];
let selected = new Set(); // "config|item_id"
let parentOf = new Map(); // child_id -> parent_id
const HIKING = "thru-hiking";
// Suggestions only; any category can be typed.
const DEFAULT_CATEGORIES = [
  "pack", "shelter", "sleeping", "kitchen", "water", "clothing", "footwear",
  "electronics", "navigation", "first aid", "hygiene", "food", "misc",
];
let sort = { key: null, dir: 1 };

// ---------- helpers ----------

let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 5000 : 1500);
}

const num = (v) => (v === "" || v == null ? null : Number(v));
function fmtWeight(g) {
  if (g == null) return "?";
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;
}
const fmtPrice = (p) =>
  "S$" + p.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inConfig = (config, id) => selected.has(`${config}|${id}`);

function slugify(s) {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  let id = base, n = 2;
  while (items.some((i) => i.id === id)) id = `${base}-${n++}`;
  return id;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function weightTypeOptions(select, value) {
  select.replaceChildren(el("option", { value: "" }, "(none)"), ...weightTypes.map((t) => el("option", { value: t }, t)));
  select.value = value || "";
}

function stateOptions(select, value) {
  select.replaceChildren(el("option", { value: "" }, "(none)"), ...states.map((s) => el("option", { value: s }, s)));
  select.value = value || "";
  select.className = value ? `state state-${value}` : "";
}

// ---------- containment editing ----------

function descendantsOf(id) {
  const found = new Set();
  const walk = (p) => {
    for (const [child, parent] of parentOf) {
      if (parent === p && !found.has(child)) { found.add(child); walk(child); }
    }
  };
  walk(id);
  return found;
}

// A select for the container an item sits in. The full option list is built on first
// focus, since every row has one and most are never opened.
function parentSelect(item, onChanged) {
  const current = parentOf.get(item.id) || "";
  const byId = new Map(items.map((i) => [i.id, i]));
  const select = el("select", { class: "parent-select", title: "Container this item goes inside" });
  const none = () => el("option", { value: "" }, "—");
  select.append(none());
  if (current) select.append(el("option", { value: current }, byId.get(current)?.name || current));
  select.value = current;

  const fill = () => {
    if (select.dataset.filled) return;
    select.dataset.filled = "1";
    const excluded = descendantsOf(item.id);
    excluded.add(item.id);
    const candidates = items.filter((i) => !excluded.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
    select.replaceChildren(none(), ...candidates.map((i) => el("option", { value: i.id }, i.name)));
    select.value = current;
  };
  select.addEventListener("focus", fill);
  select.addEventListener("mousedown", fill);
  select.addEventListener("change", () => {
    try {
      Store.setParent(item.id, select.value);
      loadItems();
      toast(select.value ? `Moved into ${byId.get(select.value).name}` : "Removed from container");
      onChanged();
    } catch (e) {
      select.value = current;
      toast(e.message, true);
    }
  });
  return select;
}

// ---------- items view ----------

function renderSummary() {
  $("#summary").replaceChildren(
    summaryGroup("All items", items),
    ...configs.map((c) => summaryGroup(c, items.filter((i) => inConfig(c, i.id))))
  );
}

function summaryGroup(label, group) {
  const totals = { count: group.length, weight: 0, base: 0, price: 0 };
  const byState = Object.fromEntries(states.map((s) => [s, { count: 0, price: 0 }]));
  for (const i of group) {
    totals.weight += num(i.weight_g) || 0;
    if (i.weight_type === "base") totals.base += num(i.weight_g) || 0;
    totals.price += num(i.price) || 0;
    if (byState[i.purchase_state]) {
      byState[i.purchase_state].count++;
      byState[i.purchase_state].price += num(i.price) || 0;
    }
  }
  const stat = (label, value, cls = "") =>
    el("div", { class: "stat" }, el("div", { class: "label" }, label), el("div", { class: `value ${cls}` }, value));
  return el(
    "div",
    { class: "stat-group" },
    el("span", { class: "group-label" }, label),
    stat("Items", String(totals.count)),
    stat("Base weight", fmtWeight(totals.base)),
    stat("Total weight", fmtWeight(totals.weight)),
    stat("Total price", fmtPrice(totals.price)),
    ...states.map((s) =>
      stat(`${s} (${byState[s].count})`, fmtPrice(byState[s].price), `state-${s}`)
    )
  );
}

function visibleItems() {
  const q = $("#search").value.trim().toLowerCase();
  const st = $("#state-filter").value;
  const cfg = $("#config-filter").value;
  let rows = items.filter(
    (i) =>
      (!st || i.purchase_state === st) &&
      (!cfg || inConfig(cfg, i.id)) &&
      (!q || [i.name, i.category, i.remarks].some((v) => v.toLowerCase().includes(q)))
  );
  if (sort.key) {
    const numeric = sort.key === "weight_g" || sort.key === "price";
    rows = [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (numeric) return ((num(x) ?? -Infinity) - (num(y) ?? -Infinity)) * sort.dir;
      return x.localeCompare(y) * sort.dir;
    });
  }
  return rows;
}

function renderCategoryOptions() {
  const used = items.map((i) => i.category).filter(Boolean);
  const all = [...new Set([...DEFAULT_CATEGORIES, ...used])].sort();
  $("#category-options").replaceChildren(...all.map((c) => el("option", { value: c })));
}

function renderTable() {
  renderCategoryOptions();
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("sorted-asc", th.dataset.sort === sort.key && sort.dir === 1);
    th.classList.toggle("sorted-desc", th.dataset.sort === sort.key && sort.dir === -1);
  });
  $("#items-table tbody").replaceChildren(...visibleItems().map(renderRow));
}

function renderRow(item) {
  const tr = el("tr");
  const input = (field, type = "text") => {
    const inp = el("input", { type, value: item[field], "data-field": field });
    if (type === "number") Object.assign(inp, { min: 0, step: "any" });
    inp.addEventListener("change", () => save(item.id, tr));
    return inp;
  };
  const weightType = el("select", { "data-field": "weight_type" });
  weightTypeOptions(weightType, item.weight_type);
  weightType.addEventListener("change", () => save(item.id, tr));

  const select = el("select", { "data-field": "purchase_state" });
  stateOptions(select, item.purchase_state);
  select.addEventListener("change", () => save(item.id, tr));

  const categoryInput = input("category");
  categoryInput.setAttribute("list", "category-options");

  const linkInput = input("purchase_link", "url");
  const linkOpen = el("a", { target: "_blank", rel: "noopener", title: "Open link" }, "↗");
  const syncLink = () => {
    linkOpen.href = linkInput.value;
    linkOpen.style.visibility = linkInput.value ? "visible" : "hidden";
  };
  linkInput.addEventListener("input", syncLink);
  syncLink();

  tr.append(
    el("td", {}, input("name")),
    el("td", {}, categoryInput),
    el("td", { class: "num" }, input("weight_g", "number")),
    el("td", {}, weightType),
    el("td", { class: "num" }, input("price", "number")),
    el("td", {}, select),
    ...configs.map((c) => {
      const box = el("input", { type: "checkbox", title: c });
      box.checked = inConfig(c, item.id);
      box.addEventListener("change", () => toggleConfig(c, item.id, box));
      return el("td", { class: "config" }, box);
    }),
    el("td", { class: "parent" }, parentSelect(item, () => {})),
    el("td", { class: "link" }, linkInput, linkOpen),
    el("td", {}, input("remarks")),
    el("td", { class: "actions" }, el("button", { title: "Delete", onclick: () => remove(item) }, "✕"))
  );
  return tr;
}

function setSelection(config, itemId, isSelected) {
  applyConfigurations(Store.setSelection({ config, item_id: itemId, selected: isSelected }));
}

function toggleConfig(config, itemId, box) {
  try {
    setSelection(config, itemId, box.checked);
    renderSummary();
    toast(`${box.checked ? "Added to" : "Removed from"} ${config}`);
  } catch (e) {
    box.checked = !box.checked;
    toast(e.message, true);
  }
}

function save(id, tr) {
  const body = { id };
  tr.querySelectorAll("[data-field]").forEach((f) => (body[f.dataset.field] = f.value));
  tr.querySelectorAll(".invalid").forEach((f) => f.classList.remove("invalid"));
  try {
    const updated = Store.update(id, body);
    items[items.findIndex((i) => i.id === id)] = updated;
    const select = tr.querySelector('[data-field="purchase_state"]');
    select.className = updated.purchase_state ? `state state-${updated.purchase_state}` : "";
    renderSummary();
    toast("Saved");
  } catch (e) {
    markInvalid(tr, e.message);
    toast(e.message, true);
  }
}

function markInvalid(container, message) {
  const field = FIELDS.find((f) => message.startsWith(f));
  const input = field && container.querySelector(`[name="${field}"], [data-field="${field}"]`);
  if (input) input.classList.add("invalid");
}

function remove(item) {
  const contents = [...parentOf.values()].filter((p) => p === item.id).length;
  const note = contents ? ` The ${contents} item(s) inside it will become unplaced.` : "";
  if (!confirm(`Delete "${item.name}"?${note}`)) return;
  try {
    Store.delete(item.id);
    loadItems();
    renderSummary();
    renderTable();
    toast("Deleted");
  } catch (e) {
    toast(e.message, true);
  }
}

function addItem(ev) {
  ev.preventDefault();
  const form = ev.target;
  form.querySelectorAll(".invalid").forEach((f) => f.classList.remove("invalid"));
  const body = Object.fromEntries(new FormData(form));
  const chosen = configs.filter((c) => body[`config:${c}`]);
  // ids are internal (used in the CSVs) and generated from the name.
  body.id = slugify(body.name);
  try {
    const created = Store.create(body);
    items.push(created);
    for (const c of chosen) setSelection(c, created.id, true);
    form.reset();
    stateOptions(form.elements.purchase_state, "pending");
    weightTypeOptions(form.elements.weight_type, "base");
    renderSummary();
    renderTable();
    updateBanner();
    form.elements.name.focus();
    toast(`Added ${created.name}`);
  } catch (e) {
    markInvalid(form, e.message);
    toast(e.message, true);
  }
}

function applyConfigurations(data) {
  configs = data.configs;
  selected = new Set(data.selections.map((s) => `${s.config}|${s.item_id}`));
}

function loadItems() {
  items = Store.items();
  applyConfigurations(Store.configurations());
  parentOf = new Map(Store.relations().map((r) => [r.child_id, r.parent_id]));
}

// ---------- configuration views ----------

let currentConfig = null;
const byCategoryThenName = (a, b) =>
  (a.category || "￿").localeCompare(b.category || "￿") || a.name.localeCompare(b.name);

function configRow(item, action) {
  const price = num(item.price);
  return el(
    "tr",
    {},
    el("td", {}, item.name),
    el("td", { class: "muted" }, item.remarks),
    el("td", { class: "muted" }, item.category),
    el("td", { class: "num" }, item.weight_g ? fmtWeight(num(item.weight_g)) : ""),
    el("td", { class: "num" }, price == null ? "" : fmtPrice(price)),
    el("td", {}, item.purchase_state ? el("span", { class: `state state-${item.purchase_state}` }, item.purchase_state) : ""),
    el("td", { class: "actions" }, action)
  );
}

const emptyRow = (text) => el("tr", {}, el("td", { class: "empty", colspan: 7 }, text));

function renderConfigView() {
  const c = currentConfig;
  const q = $("#config-search").value.trim().toLowerCase();
  const chosen = items.filter((i) => inConfig(c, i.id)).sort(byCategoryThenName);
  const available = items
    .filter((i) => !inConfig(c, i.id))
    .filter((i) => !q || [i.name, i.category, i.remarks].some((v) => v.toLowerCase().includes(q)))
    .sort(byCategoryThenName);

  $("#config-summary").replaceChildren(summaryGroup(c, chosen));
  $("#config-selected-title").textContent = `Selected for ${c} (${chosen.length})`;
  $("#config-selected tbody").replaceChildren(
    ...(chosen.length
      ? chosen.map((i) => configRow(i, el("button", { title: "Remove", onclick: () => toggleInView(i, false) }, "Remove")))
      : [emptyRow("No items selected yet. Add some from the list below.")])
  );
  $("#config-available tbody").replaceChildren(
    ...(available.length
      ? available.map((i) => configRow(i, el("button", { title: "Add", onclick: () => toggleInView(i, true) }, "Add")))
      : [emptyRow(q ? "No matching items." : "Every item is already selected.")])
  );
}

function toggleInView(item, isSelected) {
  try {
    setSelection(currentConfig, item.id, isSelected);
    renderConfigView();
    toast(`${isSelected ? "Added" : "Removed"} ${item.name}`);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- pack layout view ----------

function renderPack() {
  loadItems();
  const relations = Store.relations();
  const byId = new Map(items.map((i) => [i.id, i]));
  const children = new Map();
  const placedIn = new Map();
  const warnings = [];

  for (const { parent_id: p, child_id: c } of relations) {
    if (!byId.has(p)) { warnings.push(`Unknown parent id "${p}" (child "${c}")`); continue; }
    if (!byId.has(c)) { warnings.push(`Unknown child id "${c}" (parent "${p}")`); continue; }
    if (placedIn.has(c)) {
      warnings.push(`"${c}" is placed in both "${placedIn.get(c)}" and "${p}"; using "${placedIn.get(c)}"`);
      continue;
    }
    placedIn.set(c, p);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(c);
  }

  const roots = [...children.keys()].filter((id) => !placedIn.has(id));
  const reached = new Set();

  // Returns { node, total, incomplete } where total includes all descendants.
  function build(id, depth) {
    reached.add(id);
    const item = byId.get(id);
    const kids = (children.get(id) || []).filter((c) => !reached.has(c));
    const built = kids.map((c) => build(c, depth + 1));
    const own = num(item.weight_g);
    const total = (own || 0) + built.reduce((s, b) => s + b.total, 0);
    // Gear (anything with a purchase state) lacking a weight makes the total a lower bound.
    // Structural containers such as empty compartments have no state and are ignored.
    const missing = own == null && item.purchase_state !== "";
    const incomplete = missing || built.some((b) => b.incomplete);

    const meta = kids.length
      ? `${fmtWeight(total)}${incomplete ? "+" : ""} total` + (own != null ? ` (self ${fmtWeight(own)})` : "")
      : own == null && !missing ? "—" : fmtWeight(own);
    const node = el(
      "div",
      { class: "node" },
      el(
        "div",
        { class: "node-head" },
        el("span", { class: "node-name" }, item.name),
        el("span", { class: "node-meta" }, meta)
      ),
      el(
        "div",
        { class: "node-id" },
        item.purchase_state ? el("span", { class: `state state-${item.purchase_state}` }, item.purchase_state) : null,
        el("label", { class: "node-move" }, "in ", parentSelect(item, renderPack))
      ),
      built.length ? el("div", { class: "node-children" }, ...built.map((b) => b.node)) : null
    );
    return { node, total, incomplete };
  }

  const trees = roots.map((r) => build(r, 0));
  const cyclic = [...placedIn.keys()].filter((id) => !reached.has(id));
  if (cyclic.length) warnings.push(`Cycle detected involving: ${cyclic.join(", ")}`);

  $("#warnings").replaceChildren(...warnings.map((w) => el("div", { class: "warning" }, w)));
  $("#diagram").replaceChildren(
    ...(trees.length ? trees.map((t) => t.node) : [el("p", { class: "hint" }, "Nothing is placed in a container yet.")])
  );

  const unplaced = items.filter((i) => inConfig(HIKING, i.id) && !reached.has(i.id) && !placedIn.has(i.id));
  $("#unplaced summary").textContent = `${HIKING} items not placed in any container (${unplaced.length})`;
  $("#unplaced ul").replaceChildren(
    ...unplaced.map((i) => el("li", {}, i.name, " ", el("label", { class: "node-move" }, "put in ", parentSelect(i, renderPack))))
  );
}

// ---------- import / export ----------

function updateBanner() {
  $("#empty-banner").hidden = Store.hasData();
}

async function importFiles(ev) {
  const files = [...ev.target.files];
  ev.target.value = "";
  if (!files.length) return;
  if (Store.hasData() && !confirm(`Replace the data in this browser with ${files.map((f) => f.name).join(", ")}?`)) return;
  try {
    const imported = Store.importCsv(await Promise.all(files.map((f) => f.text())));
    // Configuration columns and tabs are built once at start-up, so start over.
    sessionStorage.setItem("gear-planner/toast", `Imported ${imported.join(", ")}`);
    location.reload();
  } catch (e) {
    toast(e.message, true);
  }
}

function exportFiles() {
  for (const { name, text } of Store.exportCsv()) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    el("a", { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  toast("Exported 3 CSV files");
}

function clearData() {
  if (!confirm("Delete all gear data stored in this browser? Export first if you want a backup.")) return;
  Store.clear();
  location.reload();
}

// ---------- wiring ----------

let currentView = "items";

function refresh() {
  loadItems();
  updateBanner();
  if (currentView === "pack") renderPack();
  else if (currentView.startsWith("config:")) renderConfigView();
  else { renderSummary(); renderTable(); }
}

function showView(view) {
  currentView = view;
  const isConfig = view.startsWith("config:");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach(
    (v) => (v.hidden = v.id !== (isConfig ? "view-config" : `view-${view}`))
  );
  location.hash = view;
  if (isConfig) {
    currentConfig = view.slice("config:".length);
    $("#config-search").value = "";
  }
  refresh();
}

function init() {
  loadItems();
  const filter = $("#state-filter");
  states.forEach((s) => filter.append(el("option", { value: s }, s)));
  configs.forEach((c) => $("#config-filter").append(el("option", { value: c }, c)));
  const stateHeader = $('th[data-sort="purchase_state"]');
  [...configs].reverse().forEach((c) => stateHeader.after(el("th", { class: "config" }, c)));
  $("#new-item-configs").replaceChildren(
    ...configs.map((c) => el("label", {}, el("input", { type: "checkbox", name: `config:${c}` }), c))
  );
  stateOptions($("#new-item").elements.purchase_state, "pending");
  weightTypeOptions($("#new-item").elements.weight_type, "base");
  const packTab = $('.tab[data-view="pack"]');
  configs.forEach((c) => packTab.before(el("button", { class: "tab", "data-view": `config:${c}` }, c)));

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  document.querySelectorAll("th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      sort = sort.key === th.dataset.sort ? { key: sort.key, dir: -sort.dir } : { key: th.dataset.sort, dir: 1 };
      renderTable();
    })
  );
  $("#search").addEventListener("input", renderTable);
  filter.addEventListener("change", renderTable);
  $("#config-filter").addEventListener("change", renderTable);
  $("#new-item").addEventListener("submit", addItem);
  $("#config-search").addEventListener("input", renderConfigView);
  $("#import-csv").addEventListener("click", () => $("#import-files").click());
  $("#import-files").addEventListener("change", importFiles);
  $("#export-csv").addEventListener("click", exportFiles);
  $("#clear-data").addEventListener("click", clearData);

  // Re-render when another tab of this page changes the data. While a field in the
  // items table is being edited, the refresh waits for the next change.
  window.addEventListener("storage", (ev) => {
    if (!Store.isVersionKey(ev.key)) return;
    if (document.activeElement?.closest("#items-table tbody")) return;
    refresh();
  });

  const hash = decodeURIComponent(location.hash.slice(1));
  const known = ["items", "pack", ...configs.map((c) => `config:${c}`)];
  showView(known.includes(hash) ? hash : "items");

  const pending = sessionStorage.getItem("gear-planner/toast");
  if (pending) { sessionStorage.removeItem("gear-planner/toast"); toast(pending); }
}

try {
  init();
} catch (e) {
  toast(e.message, true);
}
