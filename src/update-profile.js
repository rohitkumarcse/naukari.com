import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { livePage, openChrome } from "./browser.js";
import { ensureLoggedIn, openProfile } from "./login.js";
import { retry } from "./retry.js";

const norm = (s) => String(s || "").trim().toLowerCase();

async function screenshot(page, name) {
  if (!page || page.isClosed()) return;
  fs.mkdirSync(config.screenshotDir, { recursive: true });
  const file = path.join(config.screenshotDir, name);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  console.log(`Screenshot: ${file}`);
}

async function dump(page, name) {
  if (!page || page.isClosed()) return;
  fs.mkdirSync(config.screenshotDir, { recursive: true });
  const text = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(path.join(config.screenshotDir, name), text, "utf8");
}

async function loadLazySections(page) {
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/**
 * Finds the "Key skills" card on the profile page and clicks its edit icon.
 * On success the editor root element is tagged with data-ks-modal so the rest
 * of the code can scope every locator to it.
 */
async function openKeySkillsEditor(page) {
  const result = await page.evaluate(() => {
    const isEditEl = (el) => {
      const cls = (el.className || "").toString().toLowerCase();
      const label = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      return cls.includes("edit") || label.includes("edit") || text === "edit" || text === "editonetheme";
    };

    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, span, div, p, strong")].filter((el) => {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim();
      const full = (el.textContent || "").trim();
      return (own === "Key skills" || full === "Key skills") && el.children.length <= 1;
    });
    if (!headings.length) return "heading-not-found";

    // the real section heading, not the "Key skills" quick link in the sidebar
    const heading = headings.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
    heading.scrollIntoView({ block: "center" });

    let node = heading;
    let edit = null;
    for (let depth = 0; depth < 5 && node && !edit; depth++, node = node.parentElement) {
      edit = [...node.querySelectorAll("em, span, i, button, a, [class*='edit']")].find(isEditEl) || null;
    }
    if (!edit) return "edit-not-found";
    edit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return "clicked";
  });

  console.log("Key skills edit:", result);
  if (result !== "clicked") throw new Error(`Could not open Key skills editor (${result}).`);

  await page.waitForTimeout(1_000);

  // Tag the editor root: the smallest container holding a Save button and "Key skills".
  const tagged = await page.evaluate(() => {
    document.querySelectorAll("[data-ks-modal]").forEach((el) => el.removeAttribute("data-ks-modal"));
    const saves = [...document.querySelectorAll("button")].filter(
      (b) => (b.textContent || "").trim().toLowerCase() === "save" && b.offsetParent !== null
    );
    for (const save of saves) {
      let node = save.parentElement;
      while (node && node !== document.body) {
        const text = node.textContent || "";
        const looksLikeKeySkills = /key skills/i.test(text) && /add skills?/i.test(text + (node.innerHTML || ""));
        if (looksLikeKeySkills && !/is this your current employment/i.test(text)) {
          node.setAttribute("data-ks-modal", "1");
          return "ok";
        }
        node = node.parentElement;
      }
    }
    return "not-found";
  });

  if (tagged !== "ok") throw new Error("Key skills editor did not open.");
}

const modal = (page) => page.locator("[data-ks-modal]").first();

/** Returns the skill chips currently shown in the editor. */
async function readEditorSkills(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-ks-modal]");
    if (!root) return [];
    const isCross = (el) => {
      const cls = (el.className || "").toString().toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      return cls.includes("cross") || cls.includes("close") || cls.includes("remove") || text === "cross";
    };
    const out = [];
    const seen = new Set();
    for (const el of root.querySelectorAll("*")) {
      const cross = [...el.children].find(isCross);
      if (!cross) continue;
      const clone = el.cloneNode(true);
      [...clone.children].filter(isCross).forEach((c) => c.remove());
      const text = (clone.textContent || "").trim();
      if (text && text.length < 60 && !seen.has(el)) {
        seen.add(el);
        out.push(text);
      }
    }
    return out;
  });
}

async function removeSkill(page, skill) {
  const done = await page.evaluate((target) => {
    const root = document.querySelector("[data-ks-modal]");
    if (!root) return false;
    const isCross = (el) => {
      const cls = (el.className || "").toString().toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      return cls.includes("cross") || cls.includes("close") || cls.includes("remove") || text === "cross";
    };
    for (const el of root.querySelectorAll("*")) {
      const cross = [...el.children].find(isCross);
      if (!cross) continue;
      const clone = el.cloneNode(true);
      [...clone.children].filter(isCross).forEach((c) => c.remove());
      if ((clone.textContent || "").trim().toLowerCase() === target.toLowerCase()) {
        cross.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    return false;
  }, skill);

  if (!done) throw new Error(`Could not remove skill "${skill}".`);
  await page.waitForTimeout(400);
  const left = (await readEditorSkills(page)).map(norm);
  if (left.includes(norm(skill))) throw new Error(`Skill "${skill}" is still listed after removing it.`);
  console.log(`Removed: ${skill}`);
}

async function addSkill(page, skill) {
  const root = modal(page);
  const input = root
    .locator("input[placeholder*='skill' i], input[type='text'], input:not([type])")
    .first();
  await input.waitFor({ state: "visible", timeout: 5_000 });
  await input.click();
  await input.fill("");
  await input.pressSequentially(skill, { delay: 40 });
  await page.waitForTimeout(800);

  const re = new RegExp(`^\\s*${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const suggestion = root.locator("li, [role='option'], [class*='suggest'] div, [class*='sugg'] div").filter({ hasText: re }).first();

  if (await suggestion.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await suggestion.click();
  } else {
    await input.press("Enter");
  }
  await page.waitForTimeout(500);

  const now = (await readEditorSkills(page)).map(norm);
  if (!now.includes(norm(skill))) throw new Error(`Skill "${skill}" was not added.`);
  console.log(`Added: ${skill}`);
}

async function saveKeySkills(page) {
  const save = modal(page).getByRole("button", { name: /^save$/i }).last();
  if (!(await save.isVisible({ timeout: 5_000 }).catch(() => false))) {
    throw new Error("Save button not found.");
  }
  await save.click();
  await modal(page).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  if (await page.locator("[data-ks-modal]").count()) {
    throw new Error("Key skills editor is still open after Save (validation error?).");
  }
}

/** Reads the Key skills text of the profile page (the section after the heading). */
async function readProfileKeySkillsText(page) {
  return page.evaluate(() => {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, span, div, p, strong")].filter((el) => {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim();
      return own === "Key skills" && el.children.length <= 1;
    });
    const heading = headings.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
    if (!heading) return "";
    let node = heading;
    for (let depth = 0; depth < 4 && node; depth++, node = node.parentElement) {
      const text = (node.innerText || "").trim();
      if (text.length > "Key skills".length + 5) return text;
    }
    return "";
  });
}

export async function updateKeySkills(page) {
  await openKeySkillsEditor(page);
  await screenshot(page, "key-skills-editor.png");

  const before = await readEditorSkills(page);
  console.log(`Current key skills (${before.length}): ${before.join(", ")}`);

  const beforeSet = new Set(before.map(norm));
  const toAdd = config.keySkillsAdd.filter((s) => !beforeSet.has(norm(s)));
  const toRemove = config.keySkillsRemove.filter((s) => beforeSet.has(norm(s)));
  const expected = new Set(beforeSet);
  let refreshed = null;

  for (const skill of toRemove) {
    await removeSkill(page, skill);
    expected.delete(norm(skill));
  }
  for (const skill of toAdd) {
    await addSkill(page, skill);
    expected.add(norm(skill));
  }

  if (!toAdd.length && !toRemove.length) {
    // Refresh mode: take one existing skill out and put it back, so Save is
    // meaningful but the final list is identical.
    if (!before.length) throw new Error("No key skills found to refresh. Set KEY_SKILLS_ADD in .env.");
    refreshed = before[before.length - 1];
    console.log(`Refresh mode: re-adding "${refreshed}"`);
    await removeSkill(page, refreshed);
    await addSkill(page, refreshed);
  }

  await saveKeySkills(page);
  console.log("Key skills saved.");
  return { before, expected: [...expected], refreshed };
}

async function verifyKeySkills(page, expected) {
  const text = norm(await readProfileKeySkillsText(page));
  if (!text) throw new Error("Could not read Key skills section after saving.");
  const missing = expected.filter((s) => !text.includes(norm(s)));
  if (missing.length) throw new Error(`Skills missing from profile after save: ${missing.join(", ")}`);
  for (const skill of config.keySkillsRemove) {
    const wasExpected = expected.includes(norm(skill));
    if (!wasExpected && text.includes(norm(skill))) {
      throw new Error(`Skill "${skill}" is still on the profile after removal.`);
    }
  }
  console.log("Verified: Key skills on profile match the expected list.");
}

export async function runUpdate(context, page) {
  page = await ensureLoggedIn(context, page);
  page = livePage(context, page);
  await openProfile(page);
  page = livePage(context, page);

  await page.locator("text=/resume headline|key skills|employment/i").first().waitFor({ timeout: 30_000 });
  await loadLazySections(page);
  await screenshot(page, "before-update.png");

  let result;
  await retry(2, "Key skills update", async (attempt) => {
    page = livePage(context, page);
    if (attempt > 1) {
      // a failed attempt may have left the editor open: start from a clean page
      await openProfile(page);
      await loadLazySections(page);
    }
    result = await updateKeySkills(page);
  });

  await openProfile(page);
  await loadLazySections(page);
  await verifyKeySkills(page, result.expected);
  await screenshot(page, "after-update.png");
  await dump(page, "profile-text.txt");
  console.log("Done.");
  return page;
}

async function main() {
  await retry(2, "Full run", async (attempt) => {
    const { context, page } = await openChrome();
    try {
      await runUpdate(context, page);
    } catch (err) {
      await screenshot(page, `run-failed-${attempt}.png`);
      throw err;
    } finally {
      await context.close().catch(() => {});
    }
  });
}

const isDirectRun = process.argv[1]?.replaceAll("\\", "/").endsWith("update-profile.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
