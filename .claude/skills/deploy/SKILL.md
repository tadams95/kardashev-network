---
name: deploy
description: Deploy current branch to the DigitalOcean production droplet
---

# Deploy to Production

Deploy the current branch to the DigitalOcean droplet.

## Steps

1. Check for uncommitted changes locally — warn if working tree is dirty
2. Push current branch to `origin/main` if needed
3. SSH into the droplet and run the deploy sequence:

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && git pull origin main && npm install && npm run build && pm2 reload kardashev-web"
```

4. Verify PM2 reloaded successfully (exit code 0)
5. Report: commit deployed, build status, PM2 reload status

## Build Failure Recovery

If the build fails with "pages without a React Component as default export", the `.next` cache is stale. Recovery:

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && pm2 stop kardashev-web && rm -rf .next && npm run build && pm2 start kardashev-web"
```

**IMPORTANT:** Always `pm2 stop` BEFORE `rm -rf .next` — deleting `.next` while PM2 is running causes crash loops until the build completes. Stop first, delete, build, then start.

## Notes

- Droplet IP: `104.248.223.48` (key-based SSH, `~/.ssh/id_rsa`)
- App path: `/var/www/kardashev`
- Process manager: PM2 (`kardashev-web`)
- The lockfile SWC warning is benign — build still succeeds
- Use `pm2 logs kardashev-web --lines 20` after deploy if the user wants to verify runtime health
- Use `/pulse-check` after deploy to verify endpoint health, Redis, and warmup status
