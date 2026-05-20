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
ssh root@104.248.223.48 "cd /var/www/kardashev && git pull --ff-only origin main && pm2 stop kardashev-web && rm -rf node_modules .next && npm install && npm run build && pm2 start kardashev-web"
```

4. Verify PM2 started successfully (exit code 0, status `online`)
5. Report: commit deployed, build status, PM2 start status

**Sequence:** pull → stop PM2 → wipe `node_modules` + `.next` → reinstall → build → start.

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
