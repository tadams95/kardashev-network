// PM2 Ecosystem Configuration
// https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: 'kardashev-web',
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1, // Start with 1; switch to 2 after Redis is confirmed working (Phase 2.24)
      exec_mode: 'fork', // Switch to 'cluster' when instances > 1
      node_args: '--max-http-header-size=32768', // x402 payment headers
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Restart policies
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 10,
      // Logging
      error_file: '/var/log/pm2/kardashev-web-error.log',
      out_file: '/var/log/pm2/kardashev-web-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'kardashev-resolve-markets',
      script: 'scripts/resolve-markets.ts',
      interpreter: 'node_modules/.bin/tsx',
      // --env-file loads .env.local BEFORE any user module runs (Node 20+).
      // Necessary because src/lib/api/{accuweather,tomorrow}.ts capture their
      // API keys at module top level; explicit `dotenv.config()` inside the
      // script runs too late (import hoisting). Without this the cron silently
      // ran with 3/5 sources, falling back to static weights.
      node_args: '--env-file=.env.local',
      cron_restart: '0 */4 * * *', // Every 4 hours
      autorestart: false, // Script exits after completion; PM2 cron handles scheduling
      kill_timeout: 120000, // Allow up to 2 minutes for Kalshi API calls
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      error_file: '/var/log/pm2/kardashev-cron-error.log',
      out_file: '/var/log/pm2/kardashev-cron-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'kardashev-position-monitor',
      script: 'scripts/monitor-position-risk.ts',
      interpreter: 'node_modules/.bin/tsx',
      // See kardashev-resolve-markets — same env-loading rationale.
      node_args: '--env-file=.env.local',
      cron_restart: '0 */2 * * *', // Every 2 hours, top of hour
      autorestart: false, // Script exits after completion; PM2 cron handles scheduling
      kill_timeout: 60000, // 1 min — fewer external calls than resolve-markets
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      error_file: '/var/log/pm2/kardashev-position-monitor-error.log',
      out_file: '/var/log/pm2/kardashev-position-monitor-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}
