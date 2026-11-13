// Small display preferences remembered on this device (not part of any layout).

const SHOW_SECTIONS_KEY = 'seating-show-sections'

/** Whether section tints and names are drawn on the floor. On unless switched off. */
export function loadShowSections(): boolean {
  try {
    return localStorage.getItem(SHOW_SECTIONS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveShowSections(on: boolean): void {
  try {
    localStorage.setItem(SHOW_SECTIONS_KEY, on ? 'on' : 'off')
  } catch {
    // Storage unavailable: the choice just won't be remembered.
  }
}
