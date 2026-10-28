# Naukri profile updater (Playwright + Chrome)

Opens **Google Chrome**, logs into **naukri.com** and refreshes the **Key skills**
section of your profile. It no longer touches Employment type / Job type
(Full-time / Contractual) in any way.

## Setup

```powershell
cd h:\naukari-update
copy .env.example .env
npm install
npx playwright install chrome
```

Edit `.env` with your Naukri email and password. Do not commit that file.

## Run

First login (saves cookies in `user-data/`):

```powershell
npm run login
```

If Naukri shows captcha or OTP, complete it in the Chrome window. Then:

```powershell
npm run update
```

## What the update does

| `.env` values | Behaviour |
| --- | --- |
| `KEY_SKILLS_ADD` / `KEY_SKILLS_REMOVE` empty | **Refresh**: removes one existing skill and adds the same one back, then saves. Net change: none, profile is re-saved. |
| `KEY_SKILLS_ADD=Next.js,TypeScript` | Adds those skills (skipped if already present). |
| `KEY_SKILLS_REMOVE=jQuery` | Removes those skills. |

After saving, the script reloads the profile and verifies the Key skills list
matches what it expects. Screenshots go to `screenshots/`.

## Tests

```powershell
npm test
```

Runs 7 automated tests against a local mock of Naukri (no real account needed):
login / already-logged-in, refresh, add, remove, add+remove, no Employment
changes, and retry after a failed save. Set `HEADLESS=false` to watch them.

`npm run test:live` runs the same update against the real Naukri site.

## Run automatically every morning (6 AM)

Set the time in `.env` (24-hour `HH:MM`):

```
RUN_TIME=06:00
SCHEDULE_TZ=Asia/Kolkata
CATCH_UP_MISSED=true
CATCH_UP_WINDOW_MIN=360
```

Then start the scheduler and leave the window open:

```powershell
npm run schedule
```

- Runs the Key skills update once a day at `RUN_TIME`.
- If the PC was off or asleep at 6:00, it runs once when it comes back, as long as that is within `CATCH_UP_WINDOW_MIN` minutes (default 6 hours) after `RUN_TIME`. Set `CATCH_UP_MISSED=false` to turn this off.
- If a run fails it retries up to 3 times, 10 minutes apart.
- To start it automatically at Windows login, use Task Scheduler with the action `npm run schedule` and "Start in" set to the project folder.
# naukari.com
