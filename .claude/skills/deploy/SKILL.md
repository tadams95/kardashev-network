---
name: deploy
description: Deploy current branch to the DigitalOcean production droplet
---

# Deploy to Production

Deploy the current branch to the DigitalOcean droplet.

## Steps

1. Check for uncommitted changes locally — warn if working tree is dirty
2. Push current branch to `origin/main` if needed
3. SSH into the droplet and run the deploy sequence (always clean-builds to avoid stale `.next` cache errors). Use `--ff-only` on the pull — newer git refuses an implicit-strategy pull and will fail with "Need to specify how to reconcile divergent branches":

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && git pull --ff-only origin main && npm install && pm2 stop kardashev-web && rm -rf .next && npm run build && pm2 start kardashev-web"
```

4. Verify PM2 started successfully (exit code 0, status `online`)
5. Report: commit deployed, build status, PM2 start status

**IMPORTANT:** The deploy always stops PM2 BEFORE `rm -rf .next` — deleting `.next` while PM2 is running causes crash loops. The sequence is: stop → clean → build → start.

## Recovery — build fails with "page-without-default-export"

Symptom: `npm run build` reports `Build optimization failed: found pages without a React Component as default export in pages/...` listing **every** page, even though the page files clearly have valid default exports and the build succeeds locally.

Root cause: the lockfile-patch warning (`Cannot read properties of undefined (reading 'os')`) can leave `node_modules` in a partial state on the droplet — `npm install` then reports "up to date" without actually fixing it.

Fix: cold-reinstall `node_modules`.

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && rm -rf node_modules && npm install && rm -rf .next && npm run build && pm2 start kardashev-web"
```

Cold install takes ~4 min. After that the build proceeds normally and all 7 pages generate. Observed once on 2026-04-17 deploy (`65abf7f`); not yet seen on a stock npm-install attempt that wasn't preceded by a previous failed build, but worth trying first if this symptom appears.

## Notes

- Droplet IP: `104.248.223.48` (key-based SSH, `~/.ssh/id_rsa`)
- App path: `/var/www/kardashev`
- Process manager: PM2 (`kardashev-web`)
- The lockfile SWC warning is *usually* benign — build still succeeds. See Recovery section above when it isn't.
- Use `pm2 logs kardashev-web --lines 20` after deploy if the user wants to verify runtime health
- Use `/pulse-check` after deploy to verify endpoint health, Redis, and warmup status
