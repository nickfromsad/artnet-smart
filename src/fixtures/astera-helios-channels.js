/**
 * Shared channel building blocks for the Astera Helios DMX profiles. Each Helios
 * "personality" (profile 7, 14, ...) is the same RGB/CCT/Dimmer/Index core with a
 * different footprint and optional extra channels (e.g. Strobe) tacked on, so the
 * per-channel math lives here once and each profile file just picks an offset.
 */

/** raw DMX value -> Kelvin, per the Astera formula (only meaningful for raw 4-255) */
export function cctRawToKelvin(raw) {
  return 2000 + 20 * raw
}

/** Kelvin -> raw DMX value, clamped to the effective range (4-255) */
export function cctKelvinToRaw(kelvin) {
  const raw = Math.round((kelvin - 2000) / 20)
  return Math.min(255, Math.max(4, raw))
}

export const CCT_KELVIN_MIN = cctRawToKelvin(4) // 2080K
export const CCT_KELVIN_MAX = cctRawToKelvin(255) // 7100K

/** percent (0-100) -> raw DMX value (0-255) */
export function percentToRaw(percent) {
  return Math.round((Math.min(100, Math.max(0, percent)) * 255) / 100)
}

/**
 * Variable Strobe rate, raw 7-255 -> 0.4Hz-25Hz. The Astera chart gives only the two
 * endpoints (7 -> 0.4Hz, 255 -> 25Hz) and no formula (unlike the CCT channel), so this
 * is a linear interpolation between them, not a documented formula.
 */
export const STROBE_VARIABLE_RAW_MIN = 7
export const STROBE_VARIABLE_RAW_MAX = 255
export const STROBE_HZ_MIN = 0.4
export const STROBE_HZ_MAX = 25

export function strobeRawToHz(raw) {
  const t = (raw - STROBE_VARIABLE_RAW_MIN) / (STROBE_VARIABLE_RAW_MAX - STROBE_VARIABLE_RAW_MIN)
  return STROBE_HZ_MIN + t * (STROBE_HZ_MAX - STROBE_HZ_MIN)
}

export function strobeHzToRaw(hz) {
  const clamped = Math.min(STROBE_HZ_MAX, Math.max(STROBE_HZ_MIN, hz))
  const t = (clamped - STROBE_HZ_MIN) / (STROBE_HZ_MAX - STROBE_HZ_MIN)
  const raw = Math.round(STROBE_VARIABLE_RAW_MIN + t * (STROBE_VARIABLE_RAW_MAX - STROBE_VARIABLE_RAW_MIN))
  return Math.min(STROBE_VARIABLE_RAW_MAX, Math.max(STROBE_VARIABLE_RAW_MIN, raw))
}

export function rgbChannels(startOffset) {
  return [
    { key: 'red', label: 'Red', offset: startOffset, type: 'value8' },
    { key: 'green', label: 'Green', offset: startOffset + 1, type: 'value8' },
    { key: 'blue', label: 'Blue', offset: startOffset + 2, type: 'value8' },
  ]
}

export function cctChannel(offset) {
  return {
    key: 'cct',
    label: 'Color Temperature (CCT)',
    offset,
    type: 'kelvin',
    offRaw: 0,
    rawMin: 4,
    rawMax: 255,
    rawToKelvin: cctRawToKelvin,
    kelvinToRaw: cctKelvinToRaw,
    kelvinMin: CCT_KELVIN_MIN,
    kelvinMax: CCT_KELVIN_MAX,
  }
}

export function dimmerChannel(offset) {
  return { key: 'dimmer', label: 'Dimmer', offset, type: 'percent8' }
}

export function indexColorChannel(offset) {
  return {
    key: 'indexColor',
    label: 'Index Color',
    offset,
    type: 'value8',
    note: '0-1 = no effect. Named color list not yet available; enter the raw DMX value from your Astera manual.',
  }
}

export function strobeChannel(offset) {
  return {
    key: 'strobe',
    label: 'Strobe',
    offset,
    type: 'strobe',
    offRaw: 0, // 0-3
    randomFastRaw: 4,
    randomMediumRaw: 5,
    randomSlowRaw: 6,
    variableMin: STROBE_VARIABLE_RAW_MIN,
    variableMax: STROBE_VARIABLE_RAW_MAX,
    hzMin: STROBE_HZ_MIN,
    hzMax: STROBE_HZ_MAX,
    rawToHz: strobeRawToHz,
    hzToRaw: strobeHzToRaw,
  }
}
