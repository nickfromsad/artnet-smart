/**
 * Classic tap-tempo: call tap() once per beat and it averages the recent intervals
 * into a BPM. Pure and instance-independent.
 *
 * Two ways this gets used:
 *  - main.js exposes the result as Companion variables (`bpm`, `beat_seconds`) you can
 *    reference as an expression in any manual field.
 *  - Actions/effects with "Follow BPM" checked call current() every tick (via
 *    src/effects/engine.js) to live-follow whatever tempo was last tapped, including
 *    tempo changes made while the effect is already running.
 */

const TAP_RESET_MS = 2000 // a gap longer than this starts a fresh sequence instead of averaging against a stale one
const MAX_TAPS = 8 // rolling window — recent taps matter more than ones from a while ago

export class TapTempo {
  constructor() {
    this.taps = []
    this.lastResult = null
  }

  /**
   * Record one tap.
   * @param {number} [now] override for the current time (tests only; production always uses Date.now())
   * @returns {{bpm: number, beatSeconds: number} | null} null until there have been at least 2 taps to average
   */
  tap(now = Date.now()) {
    const last = this.taps.at(-1)
    if (last !== undefined && now - last > TAP_RESET_MS) {
      this.taps = []
    }

    this.taps.push(now)
    if (this.taps.length > MAX_TAPS) this.taps.shift()

    if (this.taps.length < 2) {
      this.lastResult = null
      return null
    }

    const intervals = []
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1])
    }
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length

    this.lastResult = { bpm: 60000 / avgMs, beatSeconds: avgMs / 1000 }
    return this.lastResult
  }

  /** The most recently computed tempo, or null if there isn't one yet (or after reset()). */
  current() {
    return this.lastResult
  }

  reset() {
    this.taps = []
    this.lastResult = null
  }
}
