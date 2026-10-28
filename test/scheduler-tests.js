import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockServer } from "./mock-server.js";
import { parseRunTime, shouldRun, zonedNow } from "../src/scheduler.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const TZ = "Asia/Kolkata";
const base = { runTime: "06:00", timeZone: TZ, catchUp: true, catchUpWindowMin: 360, retryGapMin: 10, maxAttempts: 3 };
// IST = UTC+5:30 -> 06:00 IST = 00:30 UTC
const at = (iso) => new Date(iso);
const fresh = { day: "2026-10-29", done: false, attempts: 0, lastAttemptAt: 0 };

console.log("Scheduler unit tests...\n");
await test("parseRunTime accepts 06:00 and 6:05, rejects bad values", () => {
  assert.equal(parseRunTime("06:00"), 360);
  assert.equal(parseRunTime("6:05"), 365);
  for (const bad of ["25:00", "06:60", "6am", "", "06-00"]) assert.throws(() => parseRunTime(bad));
});
await test("zonedNow converts to Asia/Kolkata", () => {
  assert.deepEqual(zonedNow(at("2026-10-29T00:30:00Z"), TZ), { day: "2026-10-29", minutes: 360 });
  assert.deepEqual(zonedNow(at("2026-10-28T20:00:00Z"), TZ), { day: "2026-10-29", minutes: 90 });
});
await test("does not run before 06:00 IST", () => {
  assert.equal(shouldRun({ ...base, now: at("2026-10-29T00:29:00Z"), state: fresh }), false);
});
await test("runs exactly at 06:00 IST", () => {
  assert.equal(shouldRun({ ...base, now: at("2026-10-29T00:30:10Z"), state: fresh }), true);
});
await test("does not run again once done today", () => {
  assert.equal(shouldRun({ ...base, now: at("2026-10-29T00:31:00Z"), state: { ...fresh, done: true } }), false);
});
await test("catch-up: PC woke at 08:00 IST and nothing ran yet -> runs", () => {
  assert.equal(shouldRun({ ...base, now: at("2026-10-29T02:30:00Z"), state: fresh }), true);
});
await test("catch-up respects window (13:00 IST is too late) and can be disabled", () => {
  assert.equal(shouldRun({ ...base, now: at("2026-10-29T07:30:00Z"), state: fresh }), false);
  assert.equal(shouldRun({ ...base, catchUp: false, now: at("2026-10-29T02:30:00Z"), state: fresh }), false);
});
await test("retry after failure waits retry gap and stops at max attempts", () => {
  const t = at("2026-10-29T00:40:00Z").getTime();
  const failed = { ...fresh, attempts: 1, lastAttemptAt: t };
  assert.equal(shouldRun({ ...base, now: new Date(t + 5 * 60_000), state: failed }), false);
  assert.equal(shouldRun({ ...base, now: new Date(t + 11 * 60_000), state: failed }), true);
  assert.equal(shouldRun({ ...base, now: new Date(t + 60 * 60_000), state: { ...failed, attempts: 3 } }), false);
});
await test("new day resets state", () => {
  const old = { day: "2026-10-28", done: true, attempts: 1, lastAttemptAt: 0 };
  assert.equal(shouldRun({ ...base, now: at("2026-10-29T00:30:10Z"), state: old }), true);
});

console.log("\nScheduler end-to-end test (waits for the next minute, ~1 min)...\n");
await test("scheduler fires at RUN_TIME, runs the update once, marks day done", async () => {
  const mock = createMockServer();
  const url = await mock.start();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "naukri-sched-"));
  const stateFile = path.join(tmp, "state.json");

  // RUN_TIME = start of the next minute in the schedule time zone
  const target = new Date(Math.ceil((Date.now() + 5_000) / 60_000) * 60_000);
  const z = zonedNow(target, TZ);
  const runTime = `${String(Math.floor(z.minutes / 60)).padStart(2, "0")}:${String(z.minutes % 60).padStart(2, "0")}`;

  const child = spawn(process.execPath, ["src/scheduler.js"], {
    cwd: root,
    env: {
      ...process.env,
      NAUKRI_BASE_URL: url,
      NAUKRI_EMAIL: "test@example.com",
      NAUKRI_PASSWORD: "secret",
      HEADLESS: "true",
      BROWSER_CHANNEL: "",
      USER_DATA_DIR: path.join(tmp, "ud"),
      SCREENSHOT_DIR: path.join(tmp, "shots"),
      KEY_SKILLS_ADD: "TypeScript",
      RUN_TIME: runTime,
      SCHEDULE_TZ: TZ,
      CATCH_UP_MISSED: "false",
      SCHEDULE_POLL_MS: "1000",
      SCHEDULE_STATE_FILE: stateFile,
    },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !/Update finished OK/.test(out)) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 4_000)); // make sure it does not run a second time
  child.kill();
  await mock.stop();

  try {
    assert.match(out, /Scheduler started: daily at/);
    assert.match(out, /Update finished OK/, out);
    assert.equal((out.match(/Running profile update/g) || []).length, 1, "must run exactly once");
    assert.ok(mock.state.skills.includes("TypeScript"), "skills were updated on the mock site");
    assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).done, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} scheduler tests passed.`);
process.exit(failed ? 1 : 0);
