"use strict";

// Data layer: the three CSV files live in browser localStorage, one key per file.
// Mirrors the validation rules of the original Python server.

const ITEM_FIELDS = ["id", "name", "category", "weight_g", "weight_type", "price", "purchase_link", "purchase_state", "remarks"];
const CONTAINMENT_FIELDS = ["parent_id", "child_id"];
const CONFIG_FIELDS = ["config", "item_id"];
// Always offered in the UI; any other config names found in configurations.csv are added.
const DEFAULT_CONFIGS = ["thru-hiking", "trail-running"];
// Empty state is allowed for structural items such as pack compartments.
const PURCHASE_STATES = ["owned", "ordered", "pending"];
const WEIGHT_TYPES = ["base", "worn", "consumable"];
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

const STORAGE_PREFIX = "gear-planner/";
const FILES = {
  items: { name: "items.csv", fields: ITEM_FIELDS },
  containment: { name: "containment.csv", fields: CONTAINMENT_FIELDS },
  configurations: { name: "configurations.csv", fields: CONFIG_FIELDS },
};

class ValidationError extends Error {}

// ---------- CSV ----------

// RFC 4180: quoted fields may contain commas, quotes ("") and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvField(v) {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(fields, rows) {
  const lines = [fields, ...rows.map((r) => fields.map((f) => r[f] ?? ""))];
  return lines.map((cols) => cols.map(csvField).join(",")).join("\r\n") + "\r\n";
}

// Rows keyed by header; unknown columns are dropped and rows without the first field skipped.
function rowsFromCsv(text, fields) {
  const [header = [], ...body] = parseCsv(text);
  const index = header.map((h) => h.trim());
  return body
    .map((cols) => Object.fromEntries(fields.map((f) => [f, (cols[index.indexOf(f)] ?? "").trim()])))
    .filter((r) => r[fields[0]]);
}

// ---------- storage ----------

function storageGet(key) {
  try { return localStorage.getItem(STORAGE_PREFIX + key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch (e) {
    throw new Error(`Could not save to browser storage: ${e.message}`);
  }
}

function read(kind) {
  const { name, fields } = FILES[kind];
  const text = storageGet(name);
  return text ? rowsFromCsv(text, fields) : [];
}

function write(kind, rows) {
  const { name, fields } = FILES[kind];
  storageSet(name, toCsv(fields, rows));
  storageSet("version", String(Date.now()));
}

const Store = {
  hasData() {
    return Object.values(FILES).some((f) => storageGet(f.name));
  },

  // Changes whenever any CSV is written, in this tab or another.
  version() {
    return storageGet("version") || "0";
  },

  isVersionKey(key) {
    return key === STORAGE_PREFIX + "version";
  },

  items() {
    return read("items");
  },

  relations() {
    return read("containment");
  },

  configurations() {
    const rows = read("configurations");
    const extra = [...new Set(rows.map((r) => r.config))].filter((c) => !DEFAULT_CONFIGS.includes(c)).sort();
    return { configs: [...DEFAULT_CONFIGS, ...extra], selections: rows };
  },

  setSelection({ config, item_id: itemId, selected }) {
    config = String(config || "").trim();
    if (!ID_RE.test(config)) throw new ValidationError("config must be lowercase letters, digits, '-' or '_'");
    if (!this.items().some((i) => i.id === itemId)) throw new Error(`item '${itemId}' not found`);
    const rows = read("configurations").filter((r) => !(r.config === config && r.item_id === itemId));
    if (selected) rows.push({ config, item_id: itemId });
    write("configurations", rows);
    return this.configurations();
  },

  clean(raw) {
    const item = Object.fromEntries(ITEM_FIELDS.map((k) => [k, String(raw[k] ?? "").trim()]));
    if (!ID_RE.test(item.id)) throw new ValidationError("id must be lowercase letters, digits, '-' or '_' (e.g. kakwa55-main)");
    if (!item.name) throw new ValidationError("name is required");
    for (const field of ["weight_g", "price"]) {
      if (!item[field]) continue;
      const value = Number(item[field]);
      if (Number.isNaN(value)) throw new ValidationError(`${field} must be a number`);
      if (value < 0) throw new ValidationError(`${field} must not be negative`);
    }
    if (item.weight_type && !WEIGHT_TYPES.includes(item.weight_type))
      throw new ValidationError(`weight_type must be one of ${WEIGHT_TYPES.join(", ")} or empty`);
    if (item.purchase_state && !PURCHASE_STATES.includes(item.purchase_state))
      throw new ValidationError(`purchase_state must be one of ${PURCHASE_STATES.join(", ")} or empty`);
    return item;
  },

  create(raw) {
    const item = this.clean(raw);
    const items = this.items();
    if (items.some((i) => i.id === item.id)) throw new ValidationError(`id '${item.id}' already exists`);
    items.push(item);
    write("items", items);
    return item;
  },

  update(itemId, raw) {
    const item = this.clean({ ...raw, id: itemId });
    const items = this.items();
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx < 0) throw new Error(`item '${itemId}' not found`);
    items[idx] = item;
    write("items", items);
    return item;
  },

  // Also drops the item's containment and configuration rows; its children become unplaced.
  delete(itemId) {
    const items = this.items();
    if (!items.some((i) => i.id === itemId)) throw new Error(`item '${itemId}' not found`);
    write("items", items.filter((i) => i.id !== itemId));
    const relations = read("containment");
    const keptRelations = relations.filter((r) => r.parent_id !== itemId && r.child_id !== itemId);
    if (keptRelations.length !== relations.length) write("containment", keptRelations);
    const selections = read("configurations");
    const keptSelections = selections.filter((r) => r.item_id !== itemId);
    if (keptSelections.length !== selections.length) write("configurations", keptSelections);
  },

  // Places childId inside parentId, or takes it out of any container when parentId is empty.
  setParent(childId, parentId) {
    const items = this.items();
    const exists = (id) => items.some((i) => i.id === id);
    if (!exists(childId)) throw new Error(`item '${childId}' not found`);
    const rows = read("containment").filter((r) => r.child_id !== childId);
    if (parentId) {
      if (!exists(parentId)) throw new Error(`item '${parentId}' not found`);
      if (parentId === childId) throw new ValidationError("an item cannot go inside itself");
      const parentOf = new Map(rows.map((r) => [r.child_id, r.parent_id]));
      for (let p = parentId; p; p = parentOf.get(p)) {
        if (p === childId) throw new ValidationError("that would put an item inside its own contents");
      }
      rows.push({ parent_id: parentId, child_id: childId });
    }
    write("containment", rows);
  },

  // ---------- import / export ----------

  // Detects which file each text is from its header row. Returns the kinds imported.
  importCsv(texts) {
    const found = {};
    for (const text of texts) {
      const header = (parseCsv(text)[0] || []).map((h) => h.trim());
      // The first two columns identify the file; other missing columns import as empty.
      const kind = Object.keys(FILES).find((k) => FILES[k].fields.slice(0, 2).every((f) => header.includes(f)));
      if (!kind) throw new ValidationError(`unrecognised CSV header: ${header.join(",")}`);
      found[kind] = rowsFromCsv(text, FILES[kind].fields);
    }
    if (found.items) {
      const seen = new Set();
      found.items = found.items.map((r, n) => {
        try {
          const item = this.clean(r);
          if (seen.has(item.id)) throw new ValidationError(`duplicate id '${item.id}'`);
          seen.add(item.id);
          return item;
        } catch (e) {
          throw new ValidationError(`items.csv row ${n + 2}: ${e.message}`);
        }
      });
    }
    // Validate everything before writing anything.
    for (const [kind, rows] of Object.entries(found)) write(kind, rows);
    return Object.keys(found).map((k) => FILES[k].name);
  },

  exportCsv() {
    return Object.values(FILES).map(({ name, fields }) => ({ name, text: storageGet(name) || toCsv(fields, []) }));
  },

  clear() {
    for (const { name } of Object.values(FILES)) {
      try { localStorage.removeItem(STORAGE_PREFIX + name); } catch { /* nothing stored */ }
    }
    storageSet("version", String(Date.now()));
  },
};
