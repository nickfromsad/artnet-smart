import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hsvToRgb, EFFECT_PROGRAMS } from '../src/effects/programs.js'
import { EffectsEngine, shuffle } from '../src/effects/engine.js'
import { asteraHeliosProfile7 } from '../src/fixtures/astera-helios-profile7.js'
import { TapTempo } from '../src/tap-tempo.js'
import { fixtureRegistry } from '../src/fixtures/registry.js'
import { buildActionDefinitions } from '../src/actions.js'

test('shuffle() is a permutation of its input and is deterministic given an injected random source', () => {
  const input = [1, 2, 3, 4, 5]

  const result = shuffle(input, () => 0.5) // fixed source -> deterministic output
  assert.deepEqual([...result].sort((a, b) => a - b), input, 'must contain exactly the same elements')
  assert.equal(result.length, input.length)

  const again = shuffle(input, () => 0.5)
  assert.deepEqual(result, again, 'same random source must produce the same order')

  assert.deepEqual(input, [1, 2, 3, 4, 5], 'must not mutate the input array')
})

test('hsvToRgb hits the primary colors at the standard hue angles', () => {
  assert.deepEqual(hsvToRgb(0, 1, 1), { r: 255, g: 0, b: 0 })
  assert.deepEqual(hsvToRgb(120, 1, 1), { r: 0, g: 255, b: 0 })
  assert.deepEqual(hsvToRgb(240, 1, 1), { r: 0, g: 0, b: 255 })
  assert.deepEqual(hsvToRgb(360, 1, 1), hsvToRgb(0, 1, 1)) // wraps
})

test('rainbow program overrides only the RGB channels', () => {
  const overrides = EFFECT_PROGRAMS.rainbow.tick(asteraHeliosProfile7, 0)
  const offsets = overrides.map((o) => o.offset).sort()
  assert.deepEqual(offsets, [0, 1, 2]) // red, green, blue offsets on profile 7
  const red = overrides.find((o) => o.offset === 0)
  assert.equal(red.value, 255)
})

test('rainbow Blank Space=0 is identical to no blank space at all (regression: must not change the existing default look)', () => {
  const rgbAt = (phase, params) => {
    const o = EFFECT_PROGRAMS.rainbow.tick(asteraHeliosProfile7, phase, params)
    return { r: o.find((c) => c.offset === 0).value, g: o.find((c) => c.offset === 1).value, b: o.find((c) => c.offset === 2).value }
  }
  for (const phase of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    assert.deepEqual(rgbAt(phase, { blankSpace: 0 }), rgbAt(phase, {}))
  }
})

test('rainbow Blank Space compresses the color wheel into a shorter hump, leaving the rest of the cycle black', () => {
  const rgbAt = (phase, params) => {
    const o = EFFECT_PROGRAMS.rainbow.tick(asteraHeliosProfile7, phase, params)
    return { r: o.find((c) => c.offset === 0).value, g: o.find((c) => c.offset === 1).value, b: o.find((c) => c.offset === 2).value }
  }
  const params = { blankSpace: 50 } // the color wheel now only occupies the first half of the cycle

  // the compressed wheel still starts at hue 0 (red) and runs a full rotation, just squeezed into [0, 0.5)
  assert.deepEqual(rgbAt(0, params), { r: 255, g: 0, b: 0 })
  assert.deepEqual(rgbAt(0.25, params), rgbAt(0.5, {})) // 0.25 of a 0-0.5 window = the same hue as phase 0.5 unscaled (green)

  // flat black for the rest of the cycle, where the old formula would still show a color
  assert.deepEqual(rgbAt(0.5, params), { r: 0, g: 0, b: 0 })
  assert.deepEqual(rgbAt(0.75, params), { r: 0, g: 0, b: 0 })
  assert.deepEqual(rgbAt(0.99, params), { r: 0, g: 0, b: 0 })
})

test('sineDimmer program overrides only the Dimmer channel, breathing between min and max', () => {
  const at = (phase) => EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile7, phase, { min: 0, max: 100})[0]

  const dimmerOffset = asteraHeliosProfile7.channels.find((c) => c.key === 'dimmer').offset
  assert.equal(at(0).offset, dimmerOffset)
  assert.equal(at(0).value, 0) // phase 0 = min
  assert.equal(at(0.5).value, 255) // phase 0.5 = max
  assert.ok(at(0.25).value > 0 && at(0.25).value < 255) // somewhere in between, not a hard on/off
})

test('sineDimmer respects a narrower min/max range', () => {
  const overrides = EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile7, 0.5, { min: 20, max: 60 })
  const raw = overrides[0].value
  assert.equal(raw, Math.round((60 * 255) / 100))
})

test('sineDimmer Blank Space=0 is identical to no blank space at all (regression: must not change the existing default look)', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile7, phase, params)[0].value
  for (const phase of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    assert.equal(at(phase, { min: 0, max: 100, blankSpace: 0 }), at(phase, { min: 0, max: 100 }))
  }
})

test('sineDimmer Blank Space compresses the breath into a shorter hump, leaving the rest of the cycle flat dark', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile7, phase, params)[0].value
  const params = { min: 0, max: 100, blankSpace: 50 } // the breath now only occupies the first half of the cycle

  // the compressed breath still starts at min and peaks at max, just squeezed into [0, 0.5)
  assert.equal(at(0, params), 0)
  assert.equal(at(0.25, params), 255) // midpoint of the hump (0.5 of a 0-0.5 window) -> peak
  assert.ok(at(0.4, params) > 0 && at(0.4, params) < 255, 'still fading back down within the hump')

  // flat dark for the rest of the cycle, where the old formula would still be breathing
  assert.equal(at(0.5, params), 0)
  assert.equal(at(0.75, params), 0)
  assert.equal(at(0.99, params), 0)
})

test('sineDimmer Blank Space=99 (the max allowed) still produces a nonzero-width, visible breath', () => {
  const at = (phase) => EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile7, phase, { min: 0, max: 100, blankSpace: 99 })[0].value
  assert.ok(at(0.005) > 0, 'somewhere inside the 1%-wide hump the breath must be audible/visible')
  assert.equal(at(0.5), 0) // well outside the tiny hump -> dark
})

test('squareDimmer program overrides only the Dimmer channel, snapping hard between min and max (no fade)', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.squareDimmer.tick(asteraHeliosProfile7, phase, params)[0]
  const dimmerOffset = asteraHeliosProfile7.channels.find((c) => c.key === 'dimmer').offset

  // default 50% duty cycle: on for the first half of the cycle, off for the second
  assert.equal(at(0, {}).offset, dimmerOffset)
  assert.equal(at(0, {}).value, 255) // just after the start of the cycle -> fully on
  assert.equal(at(0.49, {}).value, 255) // still on, right up to the edge
  assert.equal(at(0.51, {}).value, 0) // snapped straight to off, no fade in between
  assert.equal(at(0.99, {}).value, 0) // still off, right up to wraparound

  // every value must be either min or max, never in between (that's the "hard" part)
  for (const phase of [0, 0.1, 0.24, 0.26, 0.5, 0.75, 0.99]) {
    const v = at(phase, { min: 0, max: 100 }).value
    assert.ok(v === 0 || v === 255, `expected a hard on/off value at phase ${phase}, got ${v}`)
  }
})

test('squareDimmer respects a custom duty cycle and a narrower min/max range', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.squareDimmer.tick(asteraHeliosProfile7, phase, params)[0]

  // 25% duty cycle: only on for the first quarter of the cycle
  assert.equal(at(0.2, { dutyCycle: 25 }).value, 255)
  assert.equal(at(0.3, { dutyCycle: 25 }).value, 0)

  // narrower range: "off" isn't necessarily 0, "on" isn't necessarily 255
  const on = at(0, { min: 20, max: 80, dutyCycle: 50 })
  const off = at(0.9, { min: 20, max: 80, dutyCycle: 50 })
  assert.equal(on.value, Math.round((80 * 255) / 100))
  assert.equal(off.value, Math.round((20 * 255) / 100))
})

test('squareDimmer Fade Width=0 is identical to no fade at all (regression: must not change the existing default look)', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.squareDimmer.tick(asteraHeliosProfile7, phase, params)[0].value
  for (const phase of [0, 0.1, 0.49, 0.5, 0.51, 0.75, 0.99]) {
    assert.equal(at(phase, { dutyCycle: 50, fadeWidth: 0 }), at(phase, { dutyCycle: 50 }))
  }
})

test('squareDimmer Fade Width ramps smoothly between max and min at each edge instead of snapping', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.squareDimmer.tick(asteraHeliosProfile7, phase, params)[0].value
  const params = { dutyCycle: 50, fadeWidth: 10, min: 0, max: 100 } // 10% of the cycle ramps at each edge

  // flat "on" well before the falling edge
  assert.equal(at(0, params), 255)
  assert.equal(at(0.4, params), 255)
  // falling ramp: strictly between max and min partway through the 10% ramp (0.5-0.6)
  const midFall = at(0.55, params)
  assert.ok(midFall > 0 && midFall < 255, `expected a mid-fade value, got ${midFall}`)
  // flat "off" once the ramp finishes, well before the rising ramp starts
  assert.equal(at(0.7, params), 0)
  assert.equal(at(0.85, params), 0)
  // rising ramp: strictly between min and max partway through the final 10% before wrap
  const midRise = at(0.95, params)
  assert.ok(midRise > 0 && midRise < 255, `expected a mid-rise value, got ${midRise}`)
  // and back to full "on" right at the wrap, continuous with phase 0 above
  assert.equal(at(0.999, params) > 200, true, 'must be nearly back to full brightness just before the wrap')
})

test('squareDimmer Fade Width is clamped so the two ramps never overlap, however wide it\'s set', () => {
  const at = (phase, params) => EFFECT_PROGRAMS.squareDimmer.tick(asteraHeliosProfile7, phase, params)[0].value
  // duty=90 leaves only 10% of the cycle for "off" — even an extreme fadeWidth must not
  // produce a negative or NaN result, or a value outside [0, 255]
  for (const phase of [0, 0.3, 0.5, 0.7, 0.9, 0.92, 0.95, 0.98, 0.999]) {
    const v = at(phase, { dutyCycle: 90, fadeWidth: 50, min: 0, max: 100 })
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 255, `expected a valid 0-255 value at phase ${phase}, got ${v}`)
  }
})


function fakeInstance() {
  const calls = []
  return {
    instance: {
      config: { fixture1Universe: 0, fixture1Start: 1, fixture2Universe: 0, fixture2Start: 7 },
      sender: {
        mergeChannels: (universe, startChannel, values) => calls.push({ universe, startChannel, values: [...values] }),
        flushAll: () => calls.push({ flush: true }),
      },
    },
    calls,
  }
}

test('a running effect sends nothing until tick() is called, and stop() halts further sends', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer) // don't let the real 40ms timer interfere with this test

  engine.start('e1', { profile: asteraHeliosProfile7, program: EFFECT_PROGRAMS.rainbow, fixtureIndices: [1], periodSeconds: 1 })
  assert.equal(calls.length, 0)

  engine.tick(0)
  assert.ok(calls.some((c) => c.flush))
  const before = calls.length

  engine.stop('e1')
  calls.length = 0
  engine.tick(1000)
  assert.equal(calls.length, 0, 'no merge/flush calls once stopped')

  engine.destroy()
})

test('single-fixture rainbow progresses through phase as time advances', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)

  engine.start('e1', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1],
    periodSeconds: 1, // 1000ms period
    now: 0,
  })

  engine.tick(0) // phase 0 -> red
  let merge = calls.find((c) => !c.flush)
  assert.equal(merge.universe, 0)
  assert.equal(merge.startChannel, 1)
  assert.equal(merge.values[0], 255) // red channel full at phase 0

  calls.length = 0
  engine.tick(500) // half a period later -> phase 0.5 -> cyan-ish (no red)
  merge = calls.find((c) => !c.flush)
  assert.equal(merge.values[0], 0)

  engine.destroy()
})

test('chase spreads phase evenly across multiple fixtures, so each one differs at the same tick', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)

  engine.start('chase', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1, 2],
    periodSeconds: 1,
    phaseSpread: 1,
    now: 0,
  })

  engine.tick(0)
  const merges = calls.filter((c) => !c.flush)
  assert.equal(merges.length, 2)
  // fixture 1 at offset 0 -> phase 0 -> red; fixture 2 at offset 0.5 -> phase 0.5 -> no red
  const fixture1 = merges.find((m) => m.startChannel === 1)
  const fixture2 = merges.find((m) => m.startChannel === 7)
  assert.equal(fixture1.values[0], 255)
  assert.equal(fixture2.values[0], 0)
  assert.notDeepEqual(fixture1.values, fixture2.values)

  engine.destroy()
})

test('negative phaseSpread reverses which fixture leads the sweep', () => {
  // 2 fixtures are a degenerate case (a 0.5 offset wraps to the same point whichever
  // way you go), so use 4 to actually distinguish forward from reverse.
  const config = {}
  for (let i = 1; i <= 4; i++) {
    config[`fixture${i}Universe`] = 0
    config[`fixture${i}Start`] = (i - 1) * 6 + 1
  }
  const runOnce = (phaseSpread) => {
    const calls = []
    const instance = { config, sender: { mergeChannels: (u, s, v) => calls.push({ startChannel: s, values: [...v] }), flushAll: () => {} } }
    const engine = new EffectsEngine(instance)
    clearInterval(engine.timer)
    engine.start('chase', {
      profile: asteraHeliosProfile7,
      program: EFFECT_PROGRAMS.rainbow,
      fixtureIndices: [1, 2, 3, 4],
      periodSeconds: 1,
      phaseSpread,
      now: 0,
    })
    engine.tick(250) // basePhase 0.25, away from the 0/1 wrap point so direction is distinguishable
    engine.destroy()
    return Object.fromEntries(calls.map((c) => [c.startChannel, c.values[0]])) // startChannel -> red value
  }

  const forward = runOnce(1)
  const reverse = runOnce(-1)

  assert.equal(forward[1], reverse[1], 'the first fixture (offset 0) is unaffected by direction')
  assert.notDeepEqual(forward, reverse, 'reversing direction must change the pattern across the other fixtures')
  // reversing swaps fixture 2 (offset +0.25) and fixture 4 (offset +0.75, i.e. -0.25 mirrored)
  assert.equal(forward[7], reverse[19], 'fixture 2 forward (channel 7) should match fixture 4 reverse (channel 19)')
})

test('flushAll is called exactly once per tick, regardless of how many fixtures/effects ran', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)

  engine.start('e1', { profile: asteraHeliosProfile7, program: EFFECT_PROGRAMS.rainbow, fixtureIndices: [1, 2], periodSeconds: 1 })
  engine.start('e2', { profile: asteraHeliosProfile7, program: EFFECT_PROGRAMS.sineDimmer, fixtureIndices: [1], periodSeconds: 2 })

  engine.tick(0)
  assert.equal(calls.filter((c) => c.flush).length, 1)

  engine.destroy()
})

test('stopping one per-fixture effect does not affect a separately-running chase on the same profile', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)

  engine.start('astera-helios-profile7_f1_rainbow', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1],
    periodSeconds: 1,
  })
  engine.start('astera-helios-profile7_chase_rainbow', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1, 2],
    periodSeconds: 1,
  })

  engine.stop('astera-helios-profile7_f1_rainbow')
  assert.equal(engine.isRunning('astera-helios-profile7_f1_rainbow'), false)
  assert.equal(engine.isRunning('astera-helios-profile7_chase_rainbow'), true)

  calls.length = 0
  engine.tick(0)
  const merges = calls.filter((c) => !c.flush)
  assert.equal(merges.length, 2) // the chase's two fixtures still ticked

  engine.destroy()
})

test('randomOrder=false keeps the same fixture order across laps', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)

  engine.start('chase', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1, 2],
    periodSeconds: 1, // 1000ms period
    phaseSpread: 1,
    randomOrder: false,
    now: 0,
  })

  calls.length = 0
  engine.tick(100) // lap 0
  const lap0 = calls.filter((c) => !c.flush).map((c) => c.startChannel)

  calls.length = 0
  engine.tick(1500) // lap 1
  const lap1 = calls.filter((c) => !c.flush).map((c) => c.startChannel)

  assert.deepEqual(lap0, lap1, 'order must not change across laps when randomOrder is off')

  engine.destroy()
})

function fakeInstanceWithFixtures(count) {
  const config = {}
  for (let i = 1; i <= count; i++) {
    config[`fixture${i}Universe`] = 0
    config[`fixture${i}Start`] = (i - 1) * 6 + 1
  }
  const calls = []
  return {
    instance: {
      config,
      sender: {
        mergeChannels: (universe, startChannel, values) => calls.push({ universe, startChannel, values: [...values] }),
        flushAll: () => calls.push({ flush: true }),
      },
    },
    calls,
  }
}

/** deterministic but varying sequence (golden-ratio low-discrepancy), so successive shuffle() calls differ */
function seededRandom() {
  let n = 0
  return () => {
    n++
    return (n * 0.6180339887) % 1
  }
}

test('randomOrder=true keeps the order fixed within a lap, and reshuffles automatically at the start of the next lap — without needing to press Start again', () => {
  const { instance, calls } = fakeInstanceWithFixtures(5)
  const engine = new EffectsEngine(instance, { randomFn: seededRandom() })
  clearInterval(engine.timer)

  engine.start('chase', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1, 2, 3, 4, 5],
    periodSeconds: 1, // 1000ms period
    phaseSpread: 1,
    randomOrder: true,
    now: 0,
  })

  calls.length = 0
  engine.tick(100) // lap 0, early
  const lap0a = calls.filter((c) => !c.flush).map((c) => c.startChannel)

  calls.length = 0
  engine.tick(900) // still lap 0, later in the same sweep — must be identical to lap0a
  const lap0b = calls.filter((c) => !c.flush).map((c) => c.startChannel)
  assert.deepEqual(lap0a, lap0b, 'order must stay fixed for the whole lap, not jump around mid-sweep')

  calls.length = 0
  engine.tick(1200) // now in lap 1 — a fresh reshuffle happens automatically
  const lap1 = calls.filter((c) => !c.flush).map((c) => c.startChannel)
  assert.deepEqual([...lap1].sort(), [...lap0a].sort(), 'still the same 5 fixtures')
  assert.notDeepEqual(lap1, lap0a, 'order must actually change on the new lap, not stay identical forever')

  engine.destroy()
})

test('stopAll clears every running effect', () => {
  const { instance, calls } = fakeInstance()
  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)

  engine.start('e1', { profile: asteraHeliosProfile7, program: EFFECT_PROGRAMS.rainbow, fixtureIndices: [1], periodSeconds: 1 })
  engine.start('e2', { profile: asteraHeliosProfile7, program: EFFECT_PROGRAMS.sineDimmer, fixtureIndices: [2], periodSeconds: 1 })

  engine.stopAll()
  calls.length = 0
  engine.tick(0)
  assert.equal(calls.length, 0)

  engine.destroy()
})

test('followBpm=false (default) ignores instance.tapTempo entirely and always uses the fixed Speed', () => {
  const { instance } = fakeInstance()
  instance.tapTempo = new TapTempo()
  instance.tapTempo.tap(0)
  instance.tapTempo.tap(200) // an established, very fast 300 BPM tempo — must be ignored

  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)
  engine.start('e1', { profile: asteraHeliosProfile7, program: EFFECT_PROGRAMS.rainbow, fixtureIndices: [1], periodSeconds: 4 })
  engine.tick(0)

  const effect = engine.running.get('e1')
  assert.equal(effect.resolvedPeriodMs, 4000)

  engine.destroy()
})

test('followBpm=true with no tempo tapped yet falls back to the fixed Speed', () => {
  const { instance } = fakeInstance()
  instance.tapTempo = new TapTempo() // never tapped -> current() is null

  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)
  engine.start('e1', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1],
    periodSeconds: 4,
    followBpm: true,
    beatsPerCycle: 1,
  })
  engine.tick(0)

  assert.equal(engine.running.get('e1').resolvedPeriodMs, 4000)

  engine.destroy()
})

test('followBpm=true picks up the tapped tempo (beatSeconds * beatsPerCycle) as the period', () => {
  const { instance } = fakeInstance()
  instance.tapTempo = new TapTempo()
  instance.tapTempo.tap(0)
  instance.tapTempo.tap(500) // 120 BPM -> beatSeconds = 0.5

  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)
  engine.start('e1', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1],
    periodSeconds: 4, // irrelevant once a tempo is tapped
    followBpm: true,
    beatsPerCycle: 4, // one full cycle every 4 beats
    now: 0,
  })
  engine.tick(0)

  assert.equal(engine.running.get('e1').resolvedPeriodMs, 2000) // 0.5s * 4 beats

  engine.destroy()
})

test('followBpm=true live-follows: retapping a new tempo while the effect is already running changes its speed on the next tick, restarting phase cleanly from 0', () => {
  const { instance, calls } = fakeInstance()
  instance.tapTempo = new TapTempo()

  const engine = new EffectsEngine(instance)
  clearInterval(engine.timer)
  engine.start('e1', {
    profile: asteraHeliosProfile7,
    program: EFFECT_PROGRAMS.rainbow,
    fixtureIndices: [1],
    periodSeconds: 4, // fallback, since nothing has been tapped yet
    followBpm: true,
    beatsPerCycle: 1,
    now: 0,
  })

  engine.tick(1000) // still on the 4s fallback -> 1000ms in is phase 0.25, nothing special
  let effect = engine.running.get('e1')
  assert.equal(effect.resolvedPeriodMs, 4000)

  // now the operator taps a tempo *while the chase is already running*
  instance.tapTempo.tap(5000)
  instance.tapTempo.tap(5500) // 120 BPM -> beatSeconds 0.5 -> periodMs 500

  calls.length = 0
  engine.tick(2000) // engine's own clock — unrelated to the tapTempo timestamps above
  effect = engine.running.get('e1')
  assert.equal(effect.resolvedPeriodMs, 500, 'must switch to the newly tapped tempo without needing Start pressed again')
  assert.equal(effect.startedAt, 2000, 'phase restarts cleanly from the moment the tempo changed')

  calls.length = 0
  engine.tick(2200) // 200ms into the new 500ms period -> progressing normally on the new speed
  assert.equal(engine.running.get('e1').resolvedPeriodMs, 500, 'stays on the new tempo tick after tick')

  engine.destroy()
})

test('regression: switching from Rainbow to Blink on the same fixture actually stops Rainbow, instead of it silently continuing to drive RGB underneath', async () => {
  const config = { fixtureCount: 1, fixture1Name: 'Tube 1', fixture1Type: 'astera-helios-profile7', fixture1Universe: 0, fixture1Start: 1 }
  const sent = []
  const instance = {
    config,
    log: () => {},
    sender: {
      setChannels: (universe, startChannel, values) => sent.push({ universe, startChannel, values: [...values] }),
      mergeChannels: (universe, startChannel, values) => sent.push({ universe, startChannel, values: [...values], merged: true }),
      flushAll: () => {},
    },
  }
  instance.effects = new EffectsEngine(instance)
  clearInterval(instance.effects.timer)

  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f1_start_effect']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 4, dimmerPercent: 100 } })
  assert.ok(instance.effects.isRunning('astera-helios-profile7_f1_rainbow'), 'Rainbow should be running after Start')

  await action.callback({
    options: { program: 'squareDimmer', periodSeconds: 1, color: 0xff0000, dimmerMin: 0, dimmerMax: 100, dutyCycle: 50 },
  })
  assert.ok(!instance.effects.isRunning('astera-helios-profile7_f1_rainbow'), 'starting Blink must stop the old Rainbow effect')
  assert.ok(instance.effects.isRunning('astera-helios-profile7_f1_squareDimmer'))

  // tick a few times across what would have been several Rainbow color-rotation steps —
  // Blink never touches Red/Green/Blue itself, so if nothing ever writes to Red again,
  // that proves Rainbow isn't still running underneath (if it were, its ticks would
  // keep writing a rotating — and changing — red value)
  sent.length = 0
  instance.effects.tick(0)
  instance.effects.tick(1000)
  instance.effects.tick(2500)
  const redWrites = sent.filter((s) => s.merged && s.values[0] !== undefined).map((s) => s.values[0])
  assert.deepEqual(redWrites, [], `expected no further writes to Red at all; got ${redWrites}`)

  instance.effects.destroy()
})

test('regression: pressing a static "Full Red" (Set Full State) while Rainbow is running actually stops Rainbow, instead of it overwriting the color back on its next tick', async () => {
  const config = { fixtureCount: 1, fixture1Name: 'Tube 1', fixture1Type: 'astera-helios-profile7', fixture1Universe: 0, fixture1Start: 1 }
  const sent = []
  const instance = {
    config,
    log: () => {},
    sender: {
      setChannels: (universe, startChannel, values) => sent.push({ universe, startChannel, values: [...values] }),
      mergeChannels: (universe, startChannel, values) => sent.push({ universe, startChannel, values: [...values], merged: true }),
      flushAll: () => {},
    },
  }
  instance.effects = new EffectsEngine(instance)
  clearInterval(instance.effects.timer)

  const actions = buildActionDefinitions(instance, fixtureRegistry)

  await actions['astera-helios-profile7_f1_start_effect'].callback({ options: { program: 'rainbow', periodSeconds: 4, dimmerPercent: 100 } })
  assert.ok(instance.effects.isRunning('astera-helios-profile7_f1_rainbow'), 'Rainbow should be running after Start')

  await actions['astera-helios-profile7_f1_set_state'].callback({
    options: { color: 0xff0000, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0 },
  })
  assert.ok(!instance.effects.isRunning('astera-helios-profile7_f1_rainbow'), 'Full Red must stop the running Rainbow effect')

  // if Rainbow were still (silently) running, its next tick would overwrite red again
  sent.length = 0
  instance.effects.tick(0)
  instance.effects.tick(1000)
  const redWrites = sent.filter((s) => s.merged && s.values[0] !== undefined).map((s) => s.values[0])
  assert.deepEqual(redWrites, [], `expected no further writes to Red after Full Red stopped Rainbow; got ${redWrites}`)

  instance.effects.destroy()
})

test('regression: "Set Full State (All)" while a Rainbow Chase is running stops the chase on every targeted fixture', async () => {
  const config = { fixtureCount: 2 }
  for (let i = 1; i <= 2; i++) {
    config[`fixture${i}Name`] = `Tube ${i}`
    config[`fixture${i}Type`] = 'astera-helios-profile7'
    config[`fixture${i}Universe`] = 0
    config[`fixture${i}Start`] = (i - 1) * 6 + 1
  }
  const instance = {
    config,
    log: () => {},
    sender: { setChannels: () => {}, mergeChannels: () => {}, flushAll: () => {} },
  }
  instance.effects = new EffectsEngine(instance)
  clearInterval(instance.effects.timer)

  const actions = buildActionDefinitions(instance, fixtureRegistry)

  await actions['astera-helios-profile7_start_chase'].callback({
    options: { program: 'rainbow', periodSeconds: 4, phaseSpread: 1, dimmerPercent: 100 },
  })
  assert.ok(instance.effects.isRunning('astera-helios-profile7_chase_rainbow'))

  await actions['astera-helios-profile7_all_set_state'].callback({
    options: { color: 0x00ff00, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0 },
  })
  assert.ok(!instance.effects.isRunning('astera-helios-profile7_chase_rainbow'), 'Set Full State (All) must stop the running chase')

  instance.effects.destroy()
})
