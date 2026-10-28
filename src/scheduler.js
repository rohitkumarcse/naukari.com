import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const updateScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "update-profile.js");

export function parseRunTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`Invalid RUN_TIME "${value}". Use 24h HH:MM, e.g. 06:00`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Current date (YYYY-MM-DD) and minutes-since-midnight in the given time zone. */
export function zonedNow(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Pure decision function (unit tested). state = { day, done, attempts, lastAttemptAt } */
export function shouldRun({ now, runTime, timeZone, state, catchUp, catchUpWindowMin, retryGapMin, maxAttempts }) {
  const runMin = parseRunTime(runTime);
  const z = zonedNow(now, timeZone);
  const today = state && state.day === z.day ? state : { day: z.day, done: false, attempts: 0, lastAttemptAt: 0 };

  if (today.done) return false;
  if (today.attempts >= maxAttempts) return false;
  if (today.attempts > 0 && now.getTime() - today.lastAttemptAt < retryGapMin * 60_000) return false;
  if (z.minutes < runMin) return false;
  if (z.minutes === runMin) return true;
  if (today.attempts > 0) return true; // retry after a failure
  return catchUp && z.minutes - runMin <= catchUpWindowMin;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(config.scheduleStateFile, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(config.scheduleStateFile, JSON.stringify(state, null, 2));
}

function runJob() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [updateScript], { stdio: "inherit", env: process.env });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function startScheduler() {
  parseRunTime(config.runTime); // fail fast on bad config
  new Intl.DateTimeFormat("en-CA", { timeZone: config.scheduleTz }); // fail fast on bad tz
  const stamp = () => new Date().toISOString();
  console.log(`[${stamp()}] Scheduler started: daily at ${config.runTime} (${config.scheduleTz}). Keep this window open. Ctrl+C to stop.`);

  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date();
    const z = zonedNow(now, config.scheduleTz);
    let state = loadState();
    if (!state || state.day !== z.day) state = { day: z.day, done: false, attempts: 0, lastAttemptAt: 0 };

    if (
      !shouldRun({
        now,
        runTime: config.runTime,
        timeZone: config.scheduleTz,
        state,
        catchUp: config.catchUpMissed,
        catchUpWindowMin: config.catchUpWindowMin,
        retryGapMin: config.retryGapMin,
        maxAttempts: config.maxAttemptsPerDay,
      })
    ) {
      return;
    }

    running = true;
    state.attempts += 1;
    state.lastAttemptAt = now.getTime();
    saveState(state);
    console.log(`[${stamp()}] Running profile update (attempt ${state.attempts}/${config.maxAttemptsPerDay} today)...`);
    const code = await runJob();
    if (code === 0) {
      state.done = true;
      console.log(`[${stamp()}] Update finished OK. Next run tomorrow at ${config.runTime}.`);
    } else {
      console.log(`[${stamp()}] Update failed (exit ${code}).` + (state.attempts < config.maxAttemptsPerDay ? ` Retrying in ${config.retryGapMin} min.` : " No more retries today."));
    }
    saveState(state);
    running = false;
  };

  await tick();
  return setInterval(tick, config.schedulePollMs);
}

const isDirectRun = process.argv[1]?.replaceAll("\\", "/").endsWith("/scheduler.js");
if (isDirectRun) {
  startScheduler().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
