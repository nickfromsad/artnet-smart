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

/**
 * Which position index a physical pixel occupies in the sweep — pixel 0 normally
 * leads (index 0), pixel n-1 trails. When reverse is set, that's flipped (pixel n-1
 * leads instead), for fixtures whose pixel 1 is physically mounted on the opposite
 * side from the next fixture's. Note this is a genuine index remap, not just negating
 * `spread`: negating spread would keep pixel 0 anchored at offset 0 and mirror the
 * others around it, which isn't the same as actually reversing the sweep order.
 */
function pixelIndex(i, n, reverse) {
  return reverse ? n - 1 - i : i
}

/**
 * 0->1->0 breathing shape for a phase p within a hump of width waveWidth (fraction of
 * the full cycle) — 0 at the hump's start/end, 1 at its midpoint, and 0 for the rest of
 * the cycle once p passes waveWidth. Shared by sineDimmer's Dimmer curve and its
 * two-color RGB blend, since both need exactly the same 0-1-0 envelope.
 */
function waveShape(p, waveWidth) {
  return waveWidth > 0 && p < waveWidth ? 0.5 - 0.5 * Math.cos((p / waveWidth) * 2 * Math.PI) : 0
}

/**
 * squareDimmer's on/off fraction at phase p, with an optional smooth ramp at each edge
 * instead of an instant snap. `duty` = fraction of the cycle at "on" (1), matching
 * today's boundary exactly when fade=0. `fade` = fraction of the cycle each ramp
 * takes, split one ramp after the falling edge and one before the cycle wraps back to
 * "on" — both eat into what would otherwise be flat "off" time, so fade is clamped to
 * never exceed half of it (the two ramps can't overlap).
 */
function squareWave(p, duty, fade) {
  const f = Math.max(0, Math.min(fade, (1 - duty) / 2))
  if (f <= 0) return p < duty ? 1 : 0
  if (p < duty) return 1 // flat "on"
  if (p < duty + f) return 1 - (p - duty) / f // falling ramp
  if (p < 1 - f) return 0 // flat "off"
  return (p - (1 - f)) / f // rising ramp, reaches 1 exactly at the wrap
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
      const reverse = !!params.reversePixelOrder
      // fraction of the cycle the color wheel itself occupies; the rest is flat dark
      // ("Blank Space"). blankSpace=0 (the default) -> waveWidth=1 -> identical to the
      // original always-colored formula, since p/1 = p.
      const waveWidth = 1 - clampPercent(params.blankSpace ?? 0) / 100
      const groups = rgbGroups(profile)
      const overrides = []
      groups.forEach((group, i) => {
        const idx = pixelIndex(i, groups.length, reverse)
        const p = pixelPhase(phase, idx, groups.length, spread)
        // the full hue rotation compressed into [0, waveWidth), then black for the
        // rest of the cycle — a compact color wave instead of a wheel that's always
        // showing some color everywhere
        const { r, g, b } = waveWidth > 0 && p < waveWidth ? hsvToRgb((p / waveWidth) * 360, 1, 1) : { r: 0, g: 0, b: 0 }
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
      const spread = params.pixelPhaseSpread ?? 0
      const reverse = !!params.reversePixelOrder
      // fraction of the cycle the breath itself occupies; the rest is flat dark ("Blank
      // Space"). blankSpace=0 (the default) -> waveWidth=1 -> identical to the original
      // always-breathing formula, since p/1 = p.
      const waveWidth = 1 - clampPercent(params.blankSpace ?? 0) / 100

      // Two-Color Wave: instead of one color fading down to black via the Dimmer
      // channel, blend directly between two RGB colors — the breathing shape now
      // picks a point along that blend rather than scaling brightness. Dimmer itself
      // stays out of it entirely here (held at a one-shot baseline by actions.js, same
      // as Rainbow); see effectOneShotOverrides/effectParams for the other half of this.
      if (params.twoColorWave && hasRgb(profile)) {
        const fg = params.color ?? 0xffffff
        const bg = params.backgroundColor ?? 0x000000
        const fgR = (fg >> 16) & 0xff
        const fgG = (fg >> 8) & 0xff
        const fgB = fg & 0xff
        const bgR = (bg >> 16) & 0xff
        const bgG = (bg >> 8) & 0xff
        const bgB = bg & 0xff
        const groups = rgbGroups(profile)
        const overrides = []
        groups.forEach((group, i) => {
          const idx = pixelIndex(i, groups.length, reverse)
          const shape = waveShape(pixelPhase(phase, idx, groups.length, spread), waveWidth)
          overrides.push({ offset: group.red.offset, value: Math.round(bgR + (fgR - bgR) * shape) })
          overrides.push({ offset: group.green.offset, value: Math.round(bgG + (fgG - bgG) * shape) })
          overrides.push({ offset: group.blue.offset, value: Math.round(bgB + (fgB - bgB) * shape) })
        })
        return overrides
      }

      const min = clampPercent(params.min ?? 0)
      const max = clampPercent(params.max ?? 100)
      const channels = findChannels(profile, 'dimmer')
      return channels.map((channel, i) => {
        const idx = pixelIndex(i, channels.length, reverse)
        // starts at min (start of the breath), peaks at max (midway through it), back
        // to min (end of the breath), then flat dark for the rest of the cycle — a
        // compact breathing "hump" instead of a wave that never actually goes dark
        const shape = waveShape(pixelPhase(phase, idx, channels.length, spread), waveWidth)
        const percent = min + (max - min) * shape
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
      const fade = Math.max(0, params.fadeWidth ?? 0) / 100 // fraction of the cycle each edge ramps over; 0 = instant snap
      const spread = params.pixelPhaseSpread ?? 0
      const reverse = !!params.reversePixelOrder
      const channels = findChannels(profile, 'dimmer')
      return channels.map((channel, i) => {
        const idx = pixelIndex(i, channels.length, reverse)
        const p = pixelPhase(phase, idx, channels.length, spread)
        const percent = min + (max - min) * squareWave(p, duty, fade)
        return { offset: channel.offset, value: Math.round((percent * 255) / 100) }
      })
    },
  },
}
