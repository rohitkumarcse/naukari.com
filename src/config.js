import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const list = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const base = (process.env.NAUKRI_BASE_URL || "https://www.naukri.com").replace(/\/+$/, "");

export const config = {
  email: process.env.NAUKRI_EMAIL || "",
  password: process.env.NAUKRI_PASSWORD || "",

  // Key skills update
  keySkillsAdd: list(process.env.KEY_SKILLS_ADD),
  keySkillsRemove: list(process.env.KEY_SKILLS_REMOVE),

  // Scheduler
  runTime: (process.env.RUN_TIME).trim(),
  scheduleTz: (process.env.SCHEDULE_TZ || "Asia/Kolkata").trim(),
  catchUpMissed: (process.env.CATCH_UP_MISSED || "true").toLowerCase() !== "false",
  catchUpWindowMin: Number(process.env.CATCH_UP_WINDOW_MIN || 360),
  schedulePollMs: Number(process.env.SCHEDULE_POLL_MS || 20_000),
  retryGapMin: Number(process.env.RETRY_GAP_MIN || 10),
  maxAttemptsPerDay: Number(process.env.MAX_ATTEMPTS_PER_DAY || 3),
  scheduleStateFile: process.env.SCHEDULE_STATE_FILE || path.join(root, ".schedule-state.json"),

  loginUrl: `${base}/nlogin/login`,
  profileUrl: `${base}/mnjuser/profile`,

  // Browser behaviour (overridable so the script can be tested headless)
  headless: process.env.HEADLESS === "true",
  browserChannel: process.env.BROWSER_CHANNEL === undefined ? "chrome" : process.env.BROWSER_CHANNEL,

  userDataDir: process.env.USER_DATA_DIR || path.join(root, "user-data"),
  screenshotDir: process.env.SCREENSHOT_DIR || path.join(root, "screenshots"),
};
