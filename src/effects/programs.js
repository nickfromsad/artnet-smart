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

function wrapPhase(phase) {
  return ((phase % 1) + 1) % 1
}

/**
 * Phase for the i-th of n same-fixture "pixels", offset from the fixture's own base
 * phase by `spread` — same formula src/effects/engine.js uses to spread phase across
 * separate fixtures in a Chase, just applied within one fixture's repeated pixel
 * channels instead. spread=0 (or n<=1) always returns basePhase unchanged, so this is a
 * no-op for every single-pixel profile regardless of what params.pixelPhaseSpread is.
 */
function pixelPhase(basePhase, i, n, spread) {
  const offsetFraction = n > 1 ? (i / n) * spread : 0
  return wrapPhase(basePhase + offsetFraction)
}

export const EFFECT_PROGRAMS = {
  rainbow: {
    id: 'rainbow',
    label: 'Color Rainbow',
    // which channel(s) this program owns each tick — lets actions.js know which
    // one-shot baseline field(s) (Dimmer, or Color) it needs to send once at start
    touches: 'rgb',
    supports: (profile) => hasRgb(profile),
    tick: (profile, phase, params = {}) => {
      const spread = params.pixelPhaseSpread ?? 0
      const groups = rgbGroups(profile)
      const overrides = []
      groups.forEach((group, i) => {
        const { r, g, b } = hsvToRgb(pixelPhase(phase, i, groups.length, spread) * 360, 1, 1)
        overrides.push({ offset: group.red.offset, value: r })
        overrides.push({ offset: group.green.offset, value: g })
        overrides.push({ offset: group.blue.offset, value: b })
      })
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
      const spread = params.pixelPhaseSpread ?? 0
      const channels = findChannels(profile, 'dimmer')
      return channels.map((channel, i) => {
        const p = pixelPhase(phase, i, channels.length, spread)
        // starts at min (phase 0), peaks at max (phase 0.5), back to min (phase 1) — a smooth breath
        const percent = min + (max - min) * (0.5 - 0.5 * Math.cos(p * 2 * Math.PI))
        return { offset: channel.offset, value: Math.round((percent * 255) / 100) }
      })
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
      const spread = params.pixelPhaseSpread ?? 0
      const channels = findChannels(profile, 'dimmer')
      return channels.map((channel, i) => {
        const p = pixelPhase(phase, i, channels.length, spread)
        // no fade — snaps straight from max to min, unlike sineDimmer's smooth curve
        const percent = p < duty ? max : min
        return { offset: channel.offset, value: Math.round((percent * 255) / 100) }
      })
    },
  },
  comet: {
    id: 'comet',
    label: 'Comet',
    touches: 'rgb',
    supports: (profile) => hasRgb(profile),
    tick: (profile, phase, params = {}) => {
      const hue = Number(params.hue ?? 0)
      // how much of the cycle the bright comet (head + fading tail) occupies; the rest
      // is fully dark. blankSpace is expected to stay < 100 (see the Comet Blank Space
      // field's max in actions.js) so cometWidth never hits exactly 0.
      const cometWidth = 1 - clampPercent(params.blankSpace ?? 70) / 100
      const spread = params.pixelPhaseSpread ?? 0
      const groups = rgbGroups(profile)
      const overrides = []
      groups.forEach((group, i) => {
        const p = pixelPhase(phase, i, groups.length, spread)
        // full brightness at the comet's leading edge (p=0), fading linearly to 0 by
        // p=cometWidth, then flat dark for the rest of the cycle until it wraps
        const brightness = cometWidth > 0 && p < cometWidth ? 1 - p / cometWidth : 0
        const { r, g, b } = hsvToRgb(hue, 1, brightness)
        overrides.push({ offset: group.red.offset, value: r })
        overrides.push({ offset: group.green.offset, value: g })
        overrides.push({ offset: group.blue.offset, value: b })
      })
      return overrides
    },
  },
}
