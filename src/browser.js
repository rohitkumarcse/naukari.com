import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "./config.js";

function clearLocks(dir) {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // ignore
    }
  }
}

export async function openChrome() {
  fs.mkdirSync(config.userDataDir, { recursive: true });
  clearLocks(config.userDataDir);

  const options = {
    headless: config.headless,
    viewport: { width: 1366, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: 30_000,
  };

  try {
    const context = await chromium.launchPersistentContext(config.userDataDir, {
      ...options,
      ...(config.browserChannel ? { channel: config.browserChannel } : {}),
    });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(30_000);
    return { context, page };
  } catch (err) {
    console.warn("Could not attach to Google Chrome (profile in use). Using Playwright Chromium instead.");
    console.warn(String(err.message || err).split("\n")[0]);
    const context = await chromium.launchPersistentContext(config.userDataDir + "-chromium", {
      ...options,
    });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(30_000);
    return { context, page };
  }
}

export function livePage(context, page) {
  if (page && !page.isClosed()) return page;
  const pages = context.pages();
  return pages[pages.length - 1] || pages[0];
}

export async function dismissNoise(page) {
  if (!page || page.isClosed()) return;
  const noise = [
    page.getByRole("button", { name: /got it/i }),
    page.getByRole("button", { name: /accept cookie/i }),
    page.getByRole("button", { name: /later/i }),
    page.getByRole("button", { name: /not now/i }),
    page.locator(".crossIcon, .chatbot-close, [class*='close-icon']"),
  ];

  for (const locator of noise) {
    try {
      const target = locator.first();
      if (await target.isVisible({ timeout: 400 })) {
        await target.click({ timeout: 800 }).catch(() => {});
      }
    } catch {
      // optional
    }
  }
}
