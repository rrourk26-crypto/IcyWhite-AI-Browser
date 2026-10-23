"use strict";
/* IcyWhite password manager - the vault (main process only).
 *
 *  - One file in the app's data folder:  icywhite-vault.json   (nothing is ever written anywhere else)
 *  - Everything secret is encrypted with AES-256-GCM. The key comes from the master password with scrypt (N=65536, r=8, p=1)
 *    and a random salt. The master password itself is never stored. Forget it and the vault cannot be opened (by design).
 *  - A few harmless settings (auto-lock minutes, "fill on page load") and the "never save for this site" list (as salted hashes,
 *    not host names) are kept outside the encrypted part so they work while the vault is locked.
 *  - The key and the decrypted entries live in memory only while unlocked, and are wiped on lock / auto-lock / quit.
 *
 * This file has no Electron dependency except the few things passed in (dialog, clipboard), so it is unit-tested with plain Node. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FILE_NAME = "icywhite-vault.json";
const KDF = { N: 1 << 16, r: 8, p: 1, keyLen: 32 };
const MAX_ENTRIES = 20000;
const DEFAULT_SETTINGS = { autoLockMin: 15, autofillOnLoad: false };

// ---------- helpers ----------
function normHost(h) { return String(h || "").toLowerCase().replace(/\.$/, "").replace(/^www\./, ""); }
// Parses "example.com/login" too (people type and import urls without the scheme). Only http(s) pages can have saved logins.
function parseSite(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname) return null;
    return { protocol: u.protocol, host: normHost(u.host), hostname: normHost(u.hostname), origin: u.protocol + "//" + u.host };
  } catch (e) { return null; }
}
// A saved login may be offered on a page when the host is the same (www. ignored). https logins never go to plain http pages.
function siteMatches(entry, page) {
  if (!entry || !page) return false;
  if (normHost(entry.host) !== page.host) return false;
  return page.protocol === "https:" || entry.protocol === "http:";
}
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
function newId() { return crypto.randomBytes(9).toString("base64url"); }

function generatePassword(o = {}) {
  const length = Math.max(4, Math.min(128, Math.round(Number(o.length) || 20)));
  const sets = [];
  if (o.lower !== false) sets.push("abcdefghijkmnopqrstuvwxyz");        // no l, easy to confuse with 1 / I
  if (o.upper !== false) sets.push("ABCDEFGHJKLMNPQRSTUVWXYZ");         // no I, O
  if (o.digits !== false) sets.push("23456789");                        // no 0, 1
  if (o.symbols !== false) sets.push("!@#$%^&*-_=+?");
  if (!sets.length) sets.push("abcdefghijkmnopqrstuvwxyz");
  const all = sets.join("");
  const out = sets.map((s) => s[crypto.randomInt(s.length)]);           // at least one of each chosen kind
  while (out.length < length) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }   // shuffle
  return out.slice(0, length).join("");
}

// ---------- CSV (the format Chrome, Edge, Firefox, Bitwarden and 1Password export/import) ----------
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}
function csvCell(v) { v = String(v == null ? "" : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(entries) {
  const lines = [["name", "url", "username", "password", "note"].join(",")];
  for (const e of entries) lines.push([e.name, e.url, e.username, e.password, e.notes].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}
function entriesFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], skipped: 0 };
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));
  const iUrl = col(["url", "login_uri", "website", "web site", "origin", "hostname"]);
  const iUser = col(["username", "login_username", "user name", "login", "user", "email"]);
  const iPass = col(["password", "login_password", "pass"]);
  const iName = col(["name", "title"]);
  const iNote = col(["note", "notes", "extra"]);
  if (iPass < 0 || (iUrl < 0 && iName < 0)) throw new Error("This file doesn't look like a password export (needs url, username and password columns).");
  const items = []; let skipped = 0;
  for (const r of rows.slice(1)) {
    const site = parseSite(iUrl >= 0 ? r[iUrl] : (iName >= 0 ? r[iName] : ""));
    const password = r[iPass] || "";
    if (!site || !password) { skipped++; continue; }
    items.push({ url: site.origin, username: iUser >= 0 ? r[iUser] || "" : "", password, name: iName >= 0 ? r[iName] || "" : "", notes: iNote >= 0 ? r[iNote] || "" : "" });
  }
  return { items, skipped };
}

// ---------- the vault ----------
function createPasswordManager(opts) {
  const dir = opts.userDataDir;
  const file = path.join(dir, FILE_NAME);
  const onState = opts.onState || (() => {});
  const now = opts.now || (() => Date.now());

  let header = null;                 // the file's contents (outer, unencrypted part), or null when no vault exists yet
  let key = null, data = null;       // only while unlocked
  let lockTimer = null, fails = 0, blockedUntil = 0;

  function readFile() {
    try { const h = JSON.parse(fs.readFileSync(file, "utf8")); return h && h.v === 1 && h.kdf && h.blob ? h : null; }
    catch (e) { return null; }
  }
  header = readFile();

  function writeFile(h) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(h), { mode: 0o600 });
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak"); } catch (e) {}
    fs.renameSync(tmp, file);
    header = h;
  }
  const derive = (master, salt, kdf) => new Promise((resolve, reject) =>
    crypto.scrypt(String(master).normalize("NFKC"), salt, kdf.keyLen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }, (err, k) => (err ? reject(err) : resolve(k))));
  function seal(k, obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", k, iv);
    c.setAAD(Buffer.from("icywhite-vault-v1"));
    const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
    return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
  }
  function open(k, blob) {
    const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(blob.iv, "base64"));
    d.setAAD(Buffer.from("icywhite-vault-v1"));
    d.setAuthTag(Buffer.from(blob.tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(blob.ct, "base64")), d.final()]).toString("utf8"));
  }
  function persist() {
    if (!key || !data || !header) throw new Error("The password vault is locked.");
    writeFile(Object.assign({}, header, { blob: seal(key, data) }));
  }
  const publicState = () => ({ exists: !!header, unlocked: !!key });
  function emit() { try { onState(publicState()); } catch (e) {} }
  function touch() {
    clearTimeout(lockTimer);
    if (!key) return;
    const min = Number(header && header.settings && header.settings.autoLockMin);
    if (min > 0) { lockTimer = setTimeout(() => lock(), min * 60 * 1000); if (lockTimer.unref) lockTimer.unref(); }
  }
  function needOpen() { if (!key || !data) { const e = new Error("The password vault is locked."); e.code = "locked"; throw e; } touch(); }
  function lock() {
    const was = !!key;
    clearTimeout(lockTimer); lockTimer = null;
    if (key) key.fill(0);
    key = null; data = null;
    if (was) emit();
    return publicState();
  }

  async function setup(master) {
    master = String(master || "");
    if (header) throw new Error("A password vault already exists.");
    if (master.length < 8) throw new Error("Use at least 8 characters for the master password.");
    const salt = crypto.randomBytes(16);
    const k = await derive(master, salt, KDF);
    const settings = Object.assign({}, DEFAULT_SETTINGS);
    data = { entries: [] }; key = k;
    writeFile({ v: 1, kdf: Object.assign({ salt: salt.toString("base64") }, KDF), settings, neverSalt: crypto.randomBytes(16).toString("base64"), never: [], blob: seal(k, data) });
    fails = 0; touch(); emit();
    return publicState();
  }
  async function unlock(master) {
    if (!header) throw new Error("No password vault yet.");
    if (key) return publicState();
    if (now() < blockedUntil) { const s = Math.ceil((blockedUntil - now()) / 1000); const e = new Error("Too many wrong tries. Wait " + s + " seconds."); e.code = "rate"; throw e; }
    let k;
    try {
      k = await derive(master, Buffer.from(header.kdf.salt, "base64"), header.kdf);
      const d = open(k, header.blob);
      if (!d || !Array.isArray(d.entries)) throw new Error("bad vault");
      data = d; key = k;
    } catch (e) {
      if (k) k.fill(0);
      fails++; if (fails >= 3) blockedUntil = now() + Math.min(60, 2 ** (fails - 2)) * 1000;
      const err = new Error("Wrong master password."); err.code = "wrong"; throw err;
    }
    fails = 0; blockedUntil = 0; touch(); emit();
    return publicState();
  }
  async function verifyMaster(master) {
    if (!header) return false;
    try { const k = await derive(master, Buffer.from(header.kdf.salt, "base64"), header.kdf); try { open(k, header.blob); return true; } finally { k.fill(0); } }
    catch (e) { return false; }
  }
  async function changeMaster(oldPw, newPw) {
    needOpen();
    newPw = String(newPw || "");
    if (newPw.length < 8) throw new Error("Use at least 8 characters for the new master password.");
    if (!(await verifyMaster(oldPw))) { const e = new Error("The current master password is wrong."); e.code = "wrong"; throw e; }
    const salt = crypto.randomBytes(16);
    const k = await derive(newPw, salt, KDF);
    if (key) key.fill(0);
    key = k;
    writeFile(Object.assign({}, header, { kdf: Object.assign({ salt: salt.toString("base64") }, KDF), blob: seal(k, data) }));
    touch();
    return publicState();
  }
  function hmacHost(salt, host) { return crypto.createHmac("sha256", salt).update(normHost(host)).digest("hex"); }

  function publicEntry(e) { return { id: e.id, name: e.name, url: e.url, host: e.host, username: e.username, hasNotes: !!e.notes, modified: e.modified, lastUsed: e.lastUsed || 0 }; }
  function list() { needOpen(); return data.entries.map(publicEntry).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })); }
  function reveal(id) {
    needOpen();
    const e = data.entries.find((x) => x.id === id);
    if (!e) throw new Error("That login no longer exists.");
    return Object.assign(publicEntry(e), { password: e.password, notes: e.notes || "" });
  }
  function build(input, prev) {
    const site = parseSite(input.url != null ? input.url : prev && prev.url);
    if (!site) throw new Error("Enter the website address (for example https://example.com).");
    const password = input.password != null ? String(input.password) : prev && prev.password;
    if (!password) throw new Error("Enter a password.");
    const t = now();
    return {
      id: prev ? prev.id : newId(),
      name: clip(input.name != null ? input.name : prev && prev.name, 200).trim() || site.hostname,
      url: site.origin, host: site.host, protocol: site.protocol,
      username: clip(input.username != null ? input.username : prev && prev.username, 500),
      password: clip(password, 2000),
      notes: clip(input.notes != null ? input.notes : prev && prev.notes, 5000),
      created: prev ? prev.created : t, modified: t, lastUsed: prev ? prev.lastUsed || 0 : 0
    };
  }
  function add(input) {
    needOpen();
    if (data.entries.length >= MAX_ENTRIES) throw new Error("The vault is full.");
    const e = build(input || {}, null);
    // same site + same username = the same login: update it instead of storing a twin
    const twin = data.entries.find((x) => normHost(x.host) === e.host && x.protocol === e.protocol && x.username === e.username);
    if (twin) { e.id = twin.id; e.created = twin.created; e.lastUsed = twin.lastUsed || 0; data.entries[data.entries.indexOf(twin)] = e; }
    else data.entries.push(e);
    persist();
    return publicEntry(e);
  }
  function update(id, patch) {
    needOpen();
    const i = data.entries.findIndex((x) => x.id === id);
    if (i < 0) throw new Error("That login no longer exists.");
    data.entries[i] = build(patch || {}, data.entries[i]);
    persist();
    return publicEntry(data.entries[i]);
  }
  function remove(id) {
    needOpen();
    const n = data.entries.length;
    data.entries = data.entries.filter((x) => x.id !== id);
    if (data.entries.length !== n) persist();
    return true;
  }
  // Logins for the page that is open. Only ids and user names are returned - the password is released by getForFill.
  function find(url) {
    needOpen();
    const page = parseSite(url);
    if (!page) return [];
    return data.entries.filter((e) => siteMatches(e, page))
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || a.username.localeCompare(b.username))
      .map((e) => ({ id: e.id, username: e.username, name: e.name }));
  }
  function getForFill(id, url) {
    needOpen();
    const page = parseSite(url);
    const e = data.entries.find((x) => x.id === id);
    if (!e || !page || !siteMatches(e, page)) throw new Error("That login is for a different website.");
    e.lastUsed = now();
    try { persist(); } catch (err) {}
    return { username: e.username, password: e.password };
  }
  // After a login form was submitted: is it new, unchanged, or a changed password for a known login?
  function check(url, username, password) {
    needOpen();
    const page = parseSite(url);
    if (!page) return { status: "ignore" };
    if (isNever(url)) return { status: "never" };
    const same = data.entries.filter((e) => siteMatches(e, page) && e.username === username);
    if (!same.length) return { status: "new" };
    if (same.some((e) => e.password === password)) return { status: "same" };
    return { status: "update", id: same[0].id };
  }

  // "Never save for this site": salted hashes, kept next to the settings so it also works while the vault is locked.
  const neverSalt = () => Buffer.from(header.neverSalt || header.kdf.salt, "base64");
  function isNever(url) {
    if (!header) return false;
    const page = parseSite(url); if (!page) return false;
    return (header.never || []).includes(hmacHost(neverSalt(), page.host));
  }
  function setNever(url) {
    if (!header) throw new Error("No password vault yet.");
    const page = parseSite(url); if (!page) return false;
    const h = hmacHost(neverSalt(), page.host);
    const never = (header.never || []).slice(); if (!never.includes(h)) never.push(h);
    writeFile(Object.assign({}, header, { never }));
    return true;
  }
  function clearNever() {
    if (!header) return false;
    writeFile(Object.assign({}, header, { never: [] }));
    return true;
  }

  function getSettings() { return Object.assign({}, DEFAULT_SETTINGS, header && header.settings || {}); }
  function setSettings(patch) {
    if (!header) throw new Error("No password vault yet.");
    const s = getSettings();
    if (patch && patch.autoLockMin != null) { const n = Math.round(Number(patch.autoLockMin)); s.autoLockMin = Number.isFinite(n) ? Math.max(0, Math.min(1440, n)) : s.autoLockMin; }
    if (patch && patch.autofillOnLoad != null) s.autofillOnLoad = !!patch.autofillOnLoad;
    writeFile(Object.assign({}, header, { settings: s }));
    touch();
    return s;
  }

  function importCsv(text) {
    needOpen();
    const { items, skipped } = entriesFromCsv(text);
    let added = 0, updated = 0, same = 0;
    for (const it of items) {
      if (data.entries.length >= MAX_ENTRIES) { skipped++; continue; }
      const site = parseSite(it.url);
      const twin = data.entries.find((x) => normHost(x.host) === site.host && x.protocol === site.protocol && x.username === clip(it.username, 500));
      if (twin && twin.password === it.password) { same++; continue; }
      const e = build(it, twin || null);
      if (twin) { data.entries[data.entries.indexOf(twin)] = e; updated++; } else { data.entries.push(e); added++; }
    }
    if (added || updated) persist();
    return { added, updated, same, skipped };
  }
  async function exportCsv(master) {
    needOpen();
    if (!(await verifyMaster(master))) { const e = new Error("Wrong master password."); e.code = "wrong"; throw e; }
    return toCsv(data.entries);
  }
  async function reset(master) {
    if (!header) return publicState();
    if (key && !(await verifyMaster(master))) { const e = new Error("Wrong master password."); e.code = "wrong"; throw e; }
    lock();
    // kept as a renamed file rather than deleted, so a mistaken reset is not the end of the world
    try { fs.renameSync(file, path.join(dir, "icywhite-vault.reset-" + now() + ".json")); } catch (e) { try { fs.unlinkSync(file); } catch (x) {} }
    header = null; fails = 0; blockedUntil = 0;
    emit();
    return publicState();
  }

  return {
    status: () => Object.assign(publicState(), { settings: getSettings() }),
    setup, unlock, lock, changeMaster, verifyMaster, list, reveal, add, update, remove, find, getForFill, check,
    isNever, setNever, clearNever, getSettings, setSettings, importCsv, exportCsv, reset, generate: generatePassword,
    count: () => { needOpen(); return data.entries.length; },
    _file: file
  };
}

module.exports = { createPasswordManager, generatePassword, parseSite, siteMatches, normHost, parseCsv, toCsv, entriesFromCsv };
