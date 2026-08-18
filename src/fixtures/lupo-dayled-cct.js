/**
 * Lupo Dayled, 8-bit "CCT" mode (2 channels):
 *
 *   ch1 Dimmer             0-255 -> 0-100%
 *   ch2 Color Temperature  0-255 -> 6500K-2700K (linear, inverted: 0=coolest, 255=warmest)
 *
 * Unlike the Astera Helios, CCT here is the fixture's only color control (no RGB to
 * fall back to), and it's active across the full 0-255 range — no "off"/dead zone.
 */

const KELVIN_AT_RAW_0 = 6500
const KELVIN_AT_RAW_255 = 2700

/** raw DMX value (0-255) -> Kelvin */
export function cctRawToKelvin(raw) {
  const t = Math.min(255, Math.max(0, raw)) / 255
  return KELVIN_AT_RAW_0 + t * (KELVIN_AT_RAW_255 - KELVIN_AT_RAW_0)
}

/** Kelvin -> raw DMX value (0-255), clamped to the fixture's range */
export function cctKelvinToRaw(kelvin) {
  const t = (kelvin - KELVIN_AT_RAW_0) / (KELVIN_AT_RAW_255 - KELVIN_AT_RAW_0)
  return Math.min(255, Math.max(0, Math.round(t * 255)))
}

export const CCT_KELVIN_MIN = KELVIN_AT_RAW_255 // 2700K
export const CCT_KELVIN_MAX = KELVIN_AT_RAW_0 // 6500K

export const lupoDayledCct = {
  id: 'lupo-dayled-cct',
  manufacturer: 'Lupo',
  name: 'Lupo Dayled CCT', // kept short on purpose — see astera-helios-profile7.js
  footprint: 2,
  channels: [
    { key: 'dimmer', label: 'Dimmer', offset: 0, type: 'percent8' },
    {
      key: 'cct',
      label: 'Color Temperature (CCT)',
      offset: 1,
      type: 'kelvin',
      overridesRgb: false, // no RGB on this fixture — CCT is always directly applied, no enable checkbox
      rawToKelvin: cctRawToKelvin,
      kelvinToRaw: cctKelvinToRaw,
      kelvinMin: CCT_KELVIN_MIN,
      kelvinMax: CCT_KELVIN_MAX,
    },
  ],
}
