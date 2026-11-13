/** "7:42 PM" (in the tablet's own language and time zone). */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
