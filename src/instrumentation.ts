// Next.js Instrumentation Hook — delegates to runtime-specific file.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node')
  }
}
