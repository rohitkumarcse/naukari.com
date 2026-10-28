import { config } from "./config.js";
import { dismissNoise, livePage, openChrome } from "./browser.js";
import { retry } from "./retry.js";

export async function isLoggedIn(page) {
  if (!page || page.isClosed()) return false;
  const url = page.url();
  if (/nlogin|login\.naukri/i.test(url)) return false;
  if (await page.locator("#usernameField").isVisible({ timeout: 800 }).catch(() => false)) {
    return false;
  }
  if (url.includes("/mnjuser/")) {
    const loginWall = await page
      .getByText(/login to continue|sign in to naukri/i)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    return !loginWall;
  }
  return page
    .locator("text=/resume headline|key skills|profile last updated/i")
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

export async function openProfile(page) {
  if (!page || page.isClosed()) throw new Error("Browser closed before opening profile.");
  await page.goto(config.profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await dismissNoise(page);
}

async function waitUntilLoggedIn(context, page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    page = livePage(context, page);
    if (page && !page.isClosed()) {
      const url = page.url();
      if (/mnjuser/i.test(url) && (await isLoggedIn(page))) return page;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  page = livePage(context, page);
  if (page && !page.isClosed() && (await isLoggedIn(page))) return page;
  throw new Error("Still not logged in after waiting.");
}

export async function submitLogin(context, page) {
  page = livePage(context, page);
  if (!page || page.isClosed()) throw new Error("Browser closed during login.");

  if (!config.email || !config.password) {
    throw new Error("Add NAUKRI_EMAIL and NAUKRI_PASSWORD to .env");
  }

  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });
  await dismissNoise(page);

  const email = page.locator("#usernameField");
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.fill("");
  await email.fill(config.email);
  const password = page.locator("#passwordField");
  await password.fill("");
  await password.fill(config.password);

  const loginBtn = page.getByRole("button", { name: /^login$/i }).first();
  if (await loginBtn.isVisible().catch(() => false)) {
    await loginBtn.click();
  } else {
    await page.locator("button[type='submit']").first().click();
  }

  console.log("Login submitted. Complete captcha/OTP in Chrome if needed.");
  return waitUntilLoggedIn(context, page, 60_000);
}

export async function ensureLoggedIn(context, page) {
  page = livePage(context, page);
  await openProfile(page);
  page = livePage(context, page);

  if (await isLoggedIn(page)) {
    console.log("Case: already logged in → skip login, update profile.");
    return page;
  }

  console.log("Case: not logged in → login, then update profile.");
  return retry(2, "Login", async () => submitLogin(context, page));
}

async function main() {
  const { context, page } = await openChrome();
  try {
    await ensureLoggedIn(context, page);
    console.log("Login OK.");
  } finally {
    await context.close();
  }
}

const isDirectRun = process.argv[1]?.replaceAll("\\", "/").endsWith("/login.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
