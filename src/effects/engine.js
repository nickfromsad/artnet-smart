import { overridesToValues } from '../fixtures/state.js'

const TICK_MS = 40 // ~25Hz — smooth enough for lighting, cheap enough to not matter
const RESOLVED_PERIOD_EPSILON_MS = 0.5 // ignore floating-point noise when deciding "did the tempo actually change"

/** Fisher-Yates shuffle, pure (returns a new array). `randomFn` is injectable so tests can seed it. */
export function shuffle(array, randomFn = Math.random) {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * The period to actually run this tick: either the fixed one set at Start, or — when
 * "Follow BPM" is on — whatever src/tap-tempo.js's TapTempo currently reports, re-read
 * every tick so retapping while the effect is already running takes effect live.
 */
function resolvePeriodMs(instance, effect) {
  if (effect.followBpm) {
    const current = instance.tapTempo?.current?.()
    if (current) {
      return Math.max(50, current.beatSeconds * 1000 * effect.beatsPerCycle)
    }
  }
  return effect.fallbackPeriodMs
}

/**
 * Drives running effects (Rainbow, Sine Breathing Dimmer, chases) by ticking every
 * TICK_MS and asking each running effect's program to compute the DMX overrides for
 * its current phase, then flushing one packet per touched universe.
 */
export class EffectsEngine {
  /**
   * @param {import('@companion-module/base').InstanceBase} instance needs `instance.sender`, `instance.config`, and (for Follow BPM) `instance.tapTempo`
   * @param {Object} [opts]
   * @param {() => number} [opts.randomFn] injectable random source (tests only; production always uses Math.random)
   */
  constructor(instance, { randomFn = Math.random } = {}) {
    this.instance = instance
    this.randomFn = randomFn
    /** @type {Map<string, object>} effectId -> running effect state */
    this.running = new Map()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
  }

  /**
   * @param {string} effectId unique id for this running effect; starting the same id again restarts its phase
   * @param {Object} opts
   * @param {Object} opts.profile fixture profile
   * @param {Object} opts.program an entry from EFFECT_PROGRAMS
   * @param {number[]} opts.fixtureIndices which patched fixtures (1-based config indices) this effect drives
   * @param {number} opts.periodSeconds seconds per full cycle, used unless Follow BPM is on (or as its fallback until a tempo has been tapped)
   * @param {number} [opts.phaseSpread] 0 = all fixtures synced, 1 = one full cycle spread evenly across fixtureIndices
   * @param {boolean} [opts.randomOrder] if true, fixtureIndices is reshuffled at the start of every lap (not just once)
   * @param {boolean} [opts.followBpm] if true, speed live-follows instance.tapTempo instead of periodSeconds
   * @param {number} [opts.beatsPerCycle] with Follow BPM on, how many tapped beats make up one full cycle
   * @param {Object} [opts.params] program-specific params (e.g. {min, max} for sineDimmer)
   * @param {number} [opts.now] override for the effect's start time (tests only; production always uses Date.now())
   */
  start(
    effectId,
    {
      profile,
      program,
      fixtureIndices,
      periodSeconds,
      phaseSpread = 0,
      randomOrder = false,
      followBpm = false,
      beatsPerCycle = 1,
      params = {},
      now = Date.now(),
    },
  ) {
    const effect = {
      profile,
      program,
      baseFixtureIndices: fixtureIndices, // the fixed set/order fixtureIndices resets to when not shuffling
      fixtureIndices: randomOrder ? shuffle(fixtureIndices, this.randomFn) : fixtureIndices,
      randomOrder,
      followBpm,
      beatsPerCycle,
      fallbackPeriodMs: Math.max(50, periodSeconds * 1000),
      lap: 0, // which lap the current shuffle belongs to, so we reshuffle once per lap, not every tick
      phaseSpread,
      params,
      startedAt: now,
    }
    effect.resolvedPeriodMs = resolvePeriodMs(this.instance, effect)
    this.running.set(effectId, effect)
  }

  stop(effectId) {
    this.running.delete(effectId)
  }

  stopAll() {
    this.running.clear()
  }

  isRunning(effectId) {
    return this.running.has(effectId)
  }

  /** Public (not just the internal timer callback) so tests can drive it with explicit timestamps. */
  tick(now = Date.now()) {
    if (this.running.size === 0) return

    for (const effect of this.running.values()) {
      const { profile, program, phaseSpread, params, randomOrder, baseFixtureIndices } = effect

      const periodMs = resolvePeriodMs(this.instance, effect)
      if (Math.abs(periodMs - effect.resolvedPeriodMs) > RESOLVED_PERIOD_EPSILON_MS) {
        // the effective speed changed since last tick (Follow BPM picked up a new tempo,
        // or a tempo was tapped for the first time) — restart the phase cleanly from 0
        // instead of jumping to an arbitrary point in the new cycle
        effect.startedAt = now
        effect.lap = 0
        effect.resolvedPeriodMs = periodMs
        if (randomOrder) {
          effect.fixtureIndices = shuffle(baseFixtureIndices, this.randomFn)
        }
      }

      const elapsed = now - effect.startedAt
      const lap = Math.floor(elapsed / periodMs)

      // reshuffle exactly once per lap (not every tick) — so the order stays fixed
      // for a full smooth sweep, then changes for the next one, instead of either
      // staying identical forever or jumping around mid-sweep
      if (randomOrder && lap !== effect.lap) {
        effect.fixtureIndices = shuffle(baseFixtureIndices, this.randomFn)
        effect.lap = lap
      }

      const basePhase = ((elapsed % periodMs) + periodMs) % periodMs / periodMs

      const orderedIndices = effect.fixtureIndices
      orderedIndices.forEach((fixtureIndex, i) => {
        const offsetFraction = orderedIndices.length > 1 ? (i / orderedIndices.length) * phaseSpread : 0
        const phase = (((basePhase + offsetFraction) % 1) + 1) % 1

        const overrides = program.tick(profile, phase, params)
        const universe = Number(this.instance.config?.[`fixture${fixtureIndex}Universe`] ?? 0)
        const startChannel = Number(this.instance.config?.[`fixture${fixtureIndex}Start`] ?? 1)
        this.instance.sender.mergeChannels(universe, startChannel, overridesToValues(profile.footprint, overrides))
      })
    }

    this.instance.sender.flushAll()
  }

  destroy() {
    clearInterval(this.timer)
    this.running.clear()
  }
}
