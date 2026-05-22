---
name: deploy
description: Deploy current branch to the DigitalOcean production droplet
---

# Deploy to Production

Deploy the current branch to the DigitalOcean droplet.

## Steps

1. Check for uncommitted changes locally — warn if working tree is dirty
2. Push current branch to `origin/main` if needed
3. SSH into the droplet and run the deploy sequence. Use `--ff-only` on the pull — newer git refuses an implicit-strategy pull and will fail with "Need to specify how to reconcile divergent branches":

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && git pull --ff-only origin main && pm2 stop kardashev-web kardashev-position-monitor && mv node_modules node_modules.old.\$(date +%s) && rm -rf .next && npm install && npm run build && pm2 start kardashev-web kardashev-position-monitor && (rm -rf node_modules.old.* 2>/dev/null &)"
```

4. Verify PM2 started successfully (exit code 0, status `online`)
5. Report: commit deployed, build status, PM2 start status
6. If `npm install` exits non-zero with `ENOTEMPTY` mid-run, just **re-run `npm install`** (then build + start). It's transient FS contention on the deep tree; the resume completes from cache. See below.

**Sequence:** pull → stop web + position-monitor → **rename** `node_modules` aside (not delete) → wipe `.next` → reinstall → build → start both → background-clean the renamed tree.

**Why RENAME `node_modules` instead of `rm -rf` it (critical — learned from a 2026-05-21 outage):** `rm -rf node_modules` intermittently fails on this droplet with `ENOTEMPTY` on the deep nested trees (`@solana-mobile`, `@walletconnect`, `react-native` nest `node_modules` many levels). When it fails, the `&&` chain **halts after `.next` is already deleted and PM2 is stopped → site down**. Disk/inodes/dmesg are all clean — it's transient FS contention on rapid deep-tree deletes, not corruption (a retry of the same `rm` later succeeds). `mv` is an atomic rename: it can't fail on "not empty", so the destructive step can never halt the chain. The old tree is cleaned in the background after the site is back up; if that cleanup fails transiently, the next deploy's `rm -rf node_modules.old.*` sweeps it (timestamped names prevent collisions). Two outages on 2026-05-20/21 came from the `rm` form — do not revert to it.

**Why stop `kardashev-position-monitor` too (not just web):** it runs persistently and holds `node_modules` handles; also its `pm2 stop` leaves `CRON RESTART ... 0 */2 * * *` active, so it can refire mid-deploy. Stopping it reduces (doesn't fully eliminate) contention on the tree. Restart it after. Do NOT `pm2 stop all` + start all — `kardashev-resolve-markets` is a `0 */4 * * *` cron (normally `stopped` between runs); manually starting it can trigger an off-schedule market-resolution run. Leave it alone — its cron fires it.

**Why the cold reinstall is now default (not optional):** the lockfile-patch warning (`TypeError: Cannot read properties of undefined (reading 'os')` from `next/dist/lib/patch-incorrect-lockfile.js`) leaves `node_modules` in a partial state. A subsequent `npm install` reports "up to date" without repairing it, so the build then fails with `Build optimization failed: found pages without a React Component as default export` listing **every** page despite valid defaults. Three consecutive deploys have hit this — see history below. Wiping `node_modules` up front skips the doomed attempt and saves ~4 minutes of failed-build time.

**Why PM2 stops BEFORE the wipe:** deleting `.next` while PM2 is running causes crash loops. The wipe happens after the stop and before the install.

**Cold install duration:** ~4 minutes for `npm install` + ~1 minute for `next build`. Allow 5–6 minutes total. Set the Bash `timeout` to at least 600000 (10 min) to give headroom for npm cache misses.

## History of the lockfile-patch failure

| Deploy | Commit | Notes |
|---|---|---|
| 2026-04-17 | `65abf7f` | First observed; treated as one-off |
| 2026-05-19 | `4a2a4b8` (surface-system) | Second occurrence — recovery worked |
| 2026-05-20 | `2758b2e` (hero L1) | Third occurrence — pattern declared reliable, skill updated to make cold-reinstall the default sequence |

If you hit a 4th occurrence after this update, the fix is already in the default path — there is no further recovery branch to try. Skip ahead to the "Deeper recovery" section below.

## Deeper recovery — build still fails after cold reinstall

If the default sequence above fails (build error persists even with a freshly-cold-reinstalled `node_modules`), the issue is no longer the lockfile-patch transient. Likely candidates, in order:

1. **Disk-full on droplet.** `ssh root@104.248.223.48 "df -h /var/www"` — Next builds need ~2GB free.
2. **Node version drift.** `ssh root@104.248.223.48 "node --version"` — confirm the lockfile-targeted version still resolves on the droplet.
3. **Actual code regression.** Run `npm run build` locally on the deploy commit — if it fails locally too, the problem is in the source, not the deploy environment.
4. **`package-lock.json` corruption.** Last resort: regenerate locally (`rm package-lock.json && npm install`), commit, redeploy.

## Notes

- Droplet IP: `104.248.223.48` (key-based SSH, `~/.ssh/id_rsa`)
- App path: `/var/www/kardashev`
- Process manager: PM2 (`kardashev-web`)
- The lockfile-patch warning still appears in build output even on successful cold-install builds — it's a warning during the lockfile-patch attempt, harmless once `node_modules` is fully populated.
- Use `pm2 logs kardashev-web --lines 20` after deploy if the user wants to verify runtime health
- Use `/pulse-check` after deploy to verify endpoint health, Redis, and warmup status
