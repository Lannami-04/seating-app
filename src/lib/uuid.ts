// A random UUID (version 4), e.g. for new layouts and the device id.
//
// Why not crypto.randomUUID()? Browsers only offer it on "secure" pages (https:// or localhost).
// Opened from another tablet at http://192.168.x.x:5173 it doesn't exist and the app would crash.
// crypto.getRandomValues() works on every page, so the UUID is built from that instead.

export function uuid(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    // Very old browsers only: not cryptographically strong, but still unique enough for ids.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
