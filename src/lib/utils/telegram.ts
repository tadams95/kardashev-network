// Telegram alert helper
//
// Single function: sendTelegramAlert(text). Fails-soft if env vars are missing
// or HTTP call fails — never throws. Used by the position risk monitor and
// (potentially) other operational alerts going forward.
//
// Setup (one-time):
//   1. Talk to @BotFather on Telegram, /newbot, get TELEGRAM_BOT_TOKEN
//   2. Send /start to your new bot
//   3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates to find your chat ID
//   4. Add to droplet .env.local:
//        TELEGRAM_BOT_TOKEN=...
//        TELEGRAM_CHAT_ID=...
//   5. pm2 reload kardashev-web --update-env (or restart relevant cron)

const TELEGRAM_API = 'https://api.telegram.org'

let _warnedNoCreds = false

/** POST a message to the configured Telegram chat. Returns true on success,
 *  false on any failure (including missing creds). Never throws. */
export async function sendTelegramAlert(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    if (!_warnedNoCreds) {
      console.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured — alerts will console-log only')
      _warnedNoCreds = true
    }
    return false
  }
  try {
    const url = `${TELEGRAM_API}/bot${token}/sendMessage`
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[telegram] HTTP ${res.status}: ${errText.slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[telegram] fetch failed:', (err as Error).message)
    return false
  }
}
