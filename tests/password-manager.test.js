/* Run with:   node --test tests/password-manager.test.js     (Node 18+) */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPasswordManager, generatePassword, parseSite, siteMatches, parseCsv, toCsv, entriesFromCsv } = require("../password-manager.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "icy-vault-"));
const MASTER = "correct horse battery";

test("setup, add, lock, wrong password, unlock again", async () => {
  const dir = tmp(); const states = [];
  const pm = createPasswordManager({ userDataDir: dir, onState: (s) => states.push(s) });
  assert.deepEqual({ e: pm.status().exists, u: pm.status().unlocked }, { e: false, u: false });
  await assert.rejects(() => pm.setup("short"), /8 characters/);
  await pm.setup(MASTER);
  assert.equal(pm.status().unlocked, true);
  pm.add({ url: "https://www.example.com/login", username: "ann", password: "S3cret!pw", name: "Example" });
  pm.lock();
  assert.throws(() => pm.list(), /locked/);
  await assert.rejects(() => pm.unlock("nope nope nope"), /Wrong master password/);
  const pm2 = createPasswordManager({ userDataDir: dir });            // a fresh process reading the same file
  assert.equal(pm2.status().exists, true);
  await pm2.unlock(MASTER);
  const l = pm2.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].host, "example.com");
  assert.equal(pm2.reveal(l[0].id).password, "S3cret!pw");
  assert.ok(states.length >= 2);
});

test("the file never contains the passwords, user names or sites in clear text", async () => {
  const dir = tmp();
  const pm = createPasswordManager({ userDataDir: dir });
  await pm.setup(MASTER);
  pm.add({ url: "https://bank.example.org", username: "visible-user-name", password: "p@ssw0rd-unique-123" });
  pm.setNever("https://never.example.net");
  const raw = fs.readFileSync(pm._file, "utf8");
  for (const s of ["visible-user-name", "p@ssw0rd-unique-123", "bank.example.org", "never.example.net", MASTER]) assert.ok(!raw.includes(s), "leaked: " + s);
  assert.ok(!(fs.statSync(pm._file).mode & 0o077) || process.platform === "win32");
});

test("tampering with the file is detected", async () => {
  const dir = tmp();
  const pm = createPasswordManager({ userDataDir: dir });
  await pm.setup(MASTER); pm.add({ url: "https://a.com", username: "u", password: "pw" }); pm.lock();
  const h = JSON.parse(fs.readFileSync(pm._file, "utf8"));
  const ct = Buffer.from(h.blob.ct, "base64"); ct[0] ^= 1; h.blob.ct = ct.toString("base64");
  fs.writeFileSync(pm._file, JSON.stringify(h));
  const pm2 = createPasswordManager({ userDataDir: dir });
  await assert.rejects(() => pm2.unlock(MASTER), /Wrong master password/);
});

test("matching: same host only, www ignored, https logins never offered on http pages", async () => {
  const pm = createPasswordManager({ userDataDir: tmp() });
  await pm.setup(MASTER);
  const a = pm.add({ url: "https://example.com", username: "ann", password: "1" });
  pm.add({ url: "https://other.com", username: "bob", password: "2" });
  const h = pm.add({ url: "http://intranet.local:8080", username: "carl", password: "3" });
  assert.deepEqual(pm.find("https://www.example.com/a/b?x=1").map((x) => x.username), ["ann"]);
  assert.equal(pm.find("https://evil-example.com/").length, 0);
  assert.equal(pm.find("https://example.com.evil.net/").length, 0);
  assert.equal(pm.find("https://sub.example.com/").length, 0);
  assert.equal(pm.find("http://example.com/").length, 0);                       // downgrade: nothing offered
  assert.equal(pm.find("http://intranet.local:8080/x").length, 1);
  assert.equal(pm.find("file:///C:/x.html").length, 0);
  assert.throws(() => pm.getForFill(a.id, "https://other.com/"), /different website/);
  assert.deepEqual(pm.getForFill(a.id, "https://example.com/login"), { username: "ann", password: "1" });
  assert.ok(h.id);
});

test("add() merges the same site + user; check() says new / same / update", async () => {
  const pm = createPasswordManager({ userDataDir: tmp() });
  await pm.setup(MASTER);
  assert.equal(pm.check("https://a.com/login", "u", "p1").status, "new");
  pm.add({ url: "https://a.com", username: "u", password: "p1" });
  pm.add({ url: "https://a.com", username: "u", password: "p1b" });
  assert.equal(pm.count(), 1);
  assert.equal(pm.check("https://a.com/x", "u", "p1b").status, "same");
  const c = pm.check("https://a.com/x", "u", "p2");
  assert.equal(c.status, "update");
  pm.update(c.id, { password: "p2" });
  assert.equal(pm.reveal(c.id).password, "p2");
  assert.equal(pm.check("https://a.com/", "someone-else", "p").status, "new");
});

test("never-save list works while locked and survives a master password change", async () => {
  const dir = tmp();
  const pm = createPasswordManager({ userDataDir: dir });
  await pm.setup(MASTER);
  pm.setNever("https://www.skip.com/login");
  pm.lock();
  assert.equal(pm.isNever("https://skip.com/"), true);
  assert.equal(pm.isNever("https://keep.com/"), false);
  await pm.unlock(MASTER);
  await pm.changeMaster(MASTER, "another long master");
  assert.equal(pm.isNever("https://skip.com/"), true);
  assert.equal(pm.check("https://skip.com/", "u", "p").status, "never");
});

test("changing the master password re-encrypts everything", async () => {
  const dir = tmp();
  const pm = createPasswordManager({ userDataDir: dir });
  await pm.setup(MASTER);
  pm.add({ url: "https://a.com", username: "u", password: "pw" });
  await assert.rejects(() => pm.changeMaster("wrong wrong", "new master pw"), /wrong/);
  await pm.changeMaster(MASTER, "new master pw");
  pm.lock();
  const pm2 = createPasswordManager({ userDataDir: dir });
  await assert.rejects(() => pm2.unlock(MASTER), /Wrong/);
  await pm2.unlock("new master pw");
  assert.equal(pm2.count(), 1);
});

test("repeated wrong tries are slowed down", async () => {
  let t = 1000;
  const dir = tmp();
  const pm = createPasswordManager({ userDataDir: dir, now: () => t });
  await pm.setup(MASTER); pm.lock();
  for (let i = 0; i < 3; i++) await assert.rejects(() => pm.unlock("bad bad bad bad"), /Wrong/);
  await assert.rejects(() => pm.unlock(MASTER), /Too many/);
  t += 120000;
  await pm.unlock(MASTER);
});

test("auto-lock", async () => {
  const pm = createPasswordManager({ userDataDir: tmp() });
  await pm.setup(MASTER);
  assert.equal(pm.getSettings().autoLockMin, 15);
  pm.setSettings({ autoLockMin: 0 });
  assert.equal(pm.status().settings.autoLockMin, 0);
  pm.setSettings({ autofillOnLoad: true, autoLockMin: 5 });
  assert.deepEqual(pm.getSettings(), { autoLockMin: 5, autofillOnLoad: true });
});

test("CSV round trip with quotes, commas and line breaks", async () => {
  const pm = createPasswordManager({ userDataDir: tmp() });
  await pm.setup(MASTER);
  pm.add({ url: "https://a.com", username: "u,1", password: 'pa"ss', name: "A, Inc", notes: "line1\nline2" });
  const csv = await pm.exportCsv(MASTER);
  await assert.rejects(() => pm.exportCsv("wrong wrong"), /Wrong/);
  const pm2 = createPasswordManager({ userDataDir: tmp() });
  await pm2.setup(MASTER);
  const r = pm2.importCsv(csv);
  assert.deepEqual(r, { added: 1, updated: 0, same: 0, skipped: 0 });
  const e = pm2.reveal(pm2.list()[0].id);
  assert.equal(e.password, 'pa"ss'); assert.equal(e.username, "u,1"); assert.equal(e.notes, "line1\nline2"); assert.equal(e.name, "A, Inc");
  assert.deepEqual(pm2.importCsv(csv), { added: 0, updated: 0, same: 1, skipped: 0 });
});

test("imports Chrome, Firefox, Bitwarden and 1Password style files", () => {
  const chrome = "name,url,username,password,note\nex,https://ex.com/login,me,pw1,\n";
  const bw = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Site,,,0,https://bw.com,bwuser,bwpass,\n";
  const op = "Title,Url,Username,Password,Notes,Type\nOne,onepw.com,opuser,oppass,hi,Login\n";
  assert.equal(entriesFromCsv(chrome).items[0].url, "https://ex.com");
  assert.equal(entriesFromCsv(bw).items[0].username, "bwuser");
  assert.equal(entriesFromCsv(op).items[0].url, "https://onepw.com");
  assert.throws(() => entriesFromCsv("a,b\n1,2\n"), /doesn't look like/);
  assert.equal(entriesFromCsv("name,url,username,password\nx,chrome://settings,u,p\ny,https://ok.com,u,\n").skipped, 2);
});

test("generator honours length and character classes", () => {
  for (let i = 0; i < 50; i++) {
    const p = generatePassword({ length: 16 });
    assert.equal(p.length, 16);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/); assert.match(p, /[^a-zA-Z0-9]/);
  }
  assert.match(generatePassword({ length: 30, upper: false, symbols: false, digits: false }), /^[a-z]{30}$/);
  assert.equal(generatePassword({ length: 1000 }).length, 128);
});

test("reset keeps a renamed copy and allows a fresh setup", async () => {
  const dir = tmp();
  const pm = createPasswordManager({ userDataDir: dir });
  await pm.setup(MASTER);
  await assert.rejects(() => pm.reset("wrong wrong"), /Wrong/);
  await pm.reset(MASTER);
  assert.equal(pm.status().exists, false);
  assert.ok(fs.readdirSync(dir).some((f) => /^icywhite-vault\.reset-/.test(f)));
  await pm.setup("brand new master");
  assert.equal(pm.status().unlocked, true);
});

test("parseSite / siteMatches / parseCsv basics", () => {
  assert.equal(parseSite("example.com/x").origin, "https://example.com");
  assert.equal(parseSite("javascript:alert(1)"), null);
  assert.equal(parseSite(""), null);
  assert.equal(siteMatches({ host: "a.com", protocol: "https:" }, parseSite("http://a.com")), false);
  assert.deepEqual(parseCsv('a,"b,c"\r\n1,2\r\n'), [["a", "b,c"], ["1", "2"]]);
  assert.equal(toCsv([]).trim(), "name,url,username,password,note");
});
