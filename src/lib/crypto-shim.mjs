export function getRandomValues(array) {
  return globalThis.crypto.getRandomValues(array)
}

export default { getRandomValues }
