import { chromium } from "playwright";
import { config } from "./config.js";
import { openChrome } from "./browser.js";
import { ensureLoggedIn, isLoggedIn, openProfile, submitLogin } from "./login.js";
import { retry } from "./retry.js";
import { runUpdate } from "./update-profile.js";

async function testAlreadyLoggedIn() {
  console.log("\n######## CASE 1: already logged in ########");
  const { context, page } = await openChrome();
  try {
    await openProfile(page);
    if (!(await isLoggedIn(page))) {
      console.log("Not logged in yet. Logging in once so this case can run...");
      await retry(2, "Login for case 1", async () => submitLogin(context, page));
    }
    await ensureLoggedIn(context, page);
    await runUpdate(context, page);
    console.log("CASE 1 passed.");
  } finally {
    await context.close().catch(() => {});
  }
}

async function testLoginThenUpdate() {
  console.log("\n######## CASE 2: not logged in, then login ########");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await openProfile(page);
    if (await isLoggedIn(page)) {
      throw new Error("Expected a logged-out session for case 2.");
    }
    console.log("Confirmed logged out. Trying login up to 2 times...");
    await retry(2, "Login for case 2", async () => submitLogin(context, page));
    await runUpdate(context, page);
    console.log("CASE 2 passed.");
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  if (!config.email || !config.password) {
    throw new Error("Add NAUKRI_EMAIL and NAUKRI_PASSWORD to .env before testing.");
  }

  const caseName = (process.argv[2] || "all").toLowerCase();

  if (caseName === "logged-in" || caseName === "all") {
    await retry(2, "Case 1 already-logged-in", testAlreadyLoggedIn);
  }
  if (caseName === "login" || caseName === "all") {
    await retry(2, "Case 2 login-then-update", testLoginThenUpdate);
  }

  console.log("\nAll requested cases finished.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
