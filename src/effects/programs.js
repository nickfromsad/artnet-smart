/**
 * Pure effect math: given a fixture profile, a phase in [0, 1), and program-specific
 * params, compute the {offset, value} overrides for that instant. No Companion or
 * instance knowledge here — src/effects/engine.js drives these over time, and
 * src/actions.js exposes them as Start/Stop actions.
 */

import { findChannels, hasRgb, rgbGroups } from '../fixtures/state.js'

/** h in [0, 360), s and v in [0, 1] -> {r, g, b} each 0-255 */
export function hsvToRgb(h, s, v) {
  const hue = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = v - c
  let r1, g1, b1
  if (hue < 60) [r1, g1, b1] = [c, x, 0]
  else if (hue < 120) [r1, g1, b1] = [x, c, 0]
  else if (hue < 180) [r1, g1, b1] = [0, c, x]
  else if (hue < 240) [r1, g1, b1] = [0, x, c]
  else if (hue < 300) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value))
}

export const EFFECT_PROGRAMS = {
  rainbow: {
    id: 'rainbow',
    label: 'Color Rainbow',
    // which channel(s) this program owns each tick — lets actions.js know which
    // one-shot baseline field(s) (Dimmer, or Color) it needs to send once at start
    touches: 'rgb',
    supports: (profile) => hasRgb(profile),
    tick: (profile, phase) => {
      const { r, g, b } = hsvToRgb(phase * 360, 1, 1)
      const overrides = []
      for (const group of rgbGroups(profile)) {
        overrides.push({ offset: group.red.offset, value: r })
        overrides.push({ offset: group.green.offset, value: g })
        overrides.push({ offset: group.blue.offset, value: b })
      }
      return overrides
    },
  },
  sineDimmer: {
    id: 'sineDimmer',
    label: 'Sine Breathing Dimmer',
    touches: 'dimmer',
    supports: (profile) => findChannels(profile, 'dimmer').length > 0,
    tick: (profile, phase, params = {}) => {
      const min = clampPercent(params.min ?? 0)
      const max = clampPercent(params.max ?? 100)
      // starts at min (phase 0), peaks at max (phase 0.5), back to min (phase 1) — a smooth breath
      const percent = min + (max - min) * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI))
      const raw = Math.round((percent * 255) / 100)
      return findChannels(profile, 'dimmer').map((channel) => ({ offset: channel.offset, value: raw }))
    },
  },
  squareDimmer: {
    id: 'squareDimmer',
    label: 'Hard On/Off Blink',
    touches: 'dimmer',
    supports: (profile) => findChannels(profile, 'dimmer').length > 0,
    tick: (profile, phase, params = {}) => {
      const min = clampPercent(params.min ?? 0)
      const max = clampPercent(params.max ?? 100)
      const duty = clampPercent(params.dutyCycle ?? 50) / 100 // fraction of the cycle spent "on" (at max)
      // no fade — snaps straight from max to min, unlike sineDimmer's smooth curve
      const percent = phase < duty ? max : min
      const raw = Math.round((percent * 255) / 100)
      return findChannels(profile, 'dimmer').map((channel) => ({ offset: channel.offset, value: raw }))
    },
  },
}
