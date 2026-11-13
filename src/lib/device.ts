// A random id for this tablet, kept in the browser. It is sent with every database request
// (header x-device-id), so "Recent changes" can tell changes made here from changes made on
// another device, even when every tablet logs in with the same shared staff account.

import { uuid } from './uuid'

const KEY = 'seating-device-id'

function makeId(): string {
  return uuid().slice(0, 8)
}

function loadId(): string {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return saved
    const id = makeId()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    return makeId() // storage unavailable: a new id each time the app opens
  }
}

export const DEVICE_ID = loadId()
