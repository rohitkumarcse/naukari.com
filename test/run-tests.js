import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockServer } from "./mock-server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINAL = ["Hooks", "Ajax", "jQuery", "Redux", "React.js", "MySQL", "MongoDB", "nodejs"];

function run(baseUrl, userDataDir, extraEnv = {}, email = "test@example.com", password = "secret") {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      NAUKRI_BASE_URL: baseUrl,
      NAUKRI_EMAIL: email,
      NAUKRI_PASSWORD: password,
      HEADLESS: "true",
      BROWSER_CHANNEL: "",
      USER_DATA_DIR: userDataDir,
      SCREENSHOT_DIR: path.join(userDataDir, "shots"),
      KEY_SKILLS_ADD: "",
      KEY_SKILLS_REMOVE: "",
      ...extraEnv,
    };
    const child = spawn(process.execPath, ["src/update-profile.js"], { cwd: root, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const sorted = (a) => [...a].sort((x, y) => x.localeCompare(y));
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push([name, false]);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "naukri-test-"));
  console.log("Running Key skills update tests against local mock Naukri...\n");

  // 1) Not logged in -> logs in -> refresh mode leaves skills unchanged
  {
    const mock = createMockServer();
    const base = await mock.start();
    const dir = path.join(tmp, "case1");
    await test("logged out: logs in, then refresh keeps skills unchanged and saves once", async () => {
      const r = await run(base, dir);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /not logged in/i);
      assert.equal(mock.state.logins, 1);
      assert.equal(mock.state.saves, 1);
      assert.deepEqual(sorted(mock.state.skills), sorted(ORIGINAL));
    });

    // 2) Same browser profile -> already logged in -> skips login
    await test("already logged in: skips login and saves again", async () => {
      const r = await run(base, dir);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /already logged in/i);
      assert.equal(mock.state.logins, 1, "should not log in a second time");
      assert.equal(mock.state.saves, 2);
      assert.deepEqual(sorted(mock.state.skills), sorted(ORIGINAL));
    });

    // 3) Add skills (picked from suggestions)
    await test("KEY_SKILLS_ADD adds new skills", async () => {
      const r = await run(base, dir, { KEY_SKILLS_ADD: "Next.js, TypeScript" });
      assert.equal(r.code, 0, r.out);
      assert.deepEqual(sorted(mock.state.skills), sorted([...ORIGINAL, "Next.js", "TypeScript"]));
    });

    // 4) Remove a skill
    await test("KEY_SKILLS_REMOVE removes a skill", async () => {
      const r = await run(base, dir, { KEY_SKILLS_REMOVE: "jQuery" });
      assert.equal(r.code, 0, r.out);
      assert.ok(!mock.state.skills.includes("jQuery"));
      assert.equal(mock.state.skills.length, ORIGINAL.length + 2 - 1);
    });

    // 5) Add + remove together, add of an already present skill is not duplicated
    await test("add + remove together; existing skill is not duplicated", async () => {
      const r = await run(base, dir, { KEY_SKILLS_ADD: "AWS, React.js", KEY_SKILLS_REMOVE: "Ajax" });
      assert.equal(r.code, 0, r.out);
      assert.ok(mock.state.skills.includes("AWS"));
      assert.ok(!mock.state.skills.includes("Ajax"));
      assert.equal(mock.state.skills.filter((s) => s === "React.js").length, 1);
    });

    // 6) Employment type (the old Full-time / Contractual feature) is never touched
    await test("Employment / job type is never modified", async () => {
      assert.equal(mock.state.employmentType, "Full-time");
      const src = fs.readFileSync(path.join(root, "src", "update-profile.js"), "utf8");
      assert.ok(!/contractual/i.test(src), "update-profile.js must not mention Contractual");
      assert.ok(!/Career profile/.test(src), "update-profile.js must not touch Career profile");
    });
    await mock.stop();
  }

  // 7) First save fails server-side -> retry recovers
  {
    const mock = createMockServer({ failFirstSave: true });
    const base = await mock.start();
    await test("retry: first save fails, second attempt succeeds", async () => {
      const r = await run(base, path.join(tmp, "case7"), { KEY_SKILLS_ADD: "TypeScript" });
      assert.equal(r.code, 0, r.out);
      assert.ok(mock.state.skills.includes("TypeScript"));
      assert.ok(mock.state.saves >= 2);
    });
    await mock.stop();
  }

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} tests passed.`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main();
