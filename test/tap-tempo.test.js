import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TapTempo } from '../src/tap-tempo.js'
import { fixtureRegistry } from '../src/fixtures/registry.js'
import { buildActionDefinitions } from '../src/actions.js'

test('a single tap is not enough to compute a tempo', () => {
  const tt = new TapTempo()
  assert.equal(tt.tap(0), null)
})

test('two taps compute BPM from the interval between them', () => {
  const tt = new TapTempo()
  tt.tap(0)
  const result = tt.tap(500) // 500ms apart -> 120 BPM
  assert.equal(result.bpm, 120)
  assert.equal(result.beatSeconds, 0.5)
})

test('several evenly-spaced taps average to the same steady BPM', () => {
  const tt = new TapTempo()
  tt.tap(0)
  tt.tap(500)
  tt.tap(1000)
  const result = tt.tap(1500) // steady 120 BPM throughout
  assert.equal(result.bpm, 120)
})

test('taps that drift slightly are averaged, not just taking the last interval', () => {
  const tt = new TapTempo()
  tt.tap(0)
  tt.tap(490) // slightly fast
  const result = tt.tap(1000) // slightly slow — average of 490 and 510 = 500ms -> 120 BPM
  assert.equal(Math.round(result.bpm), 120)
})

test('a long gap since the last tap starts a fresh sequence instead of averaging against a stale tempo', () => {
  const tt = new TapTempo()
  tt.tap(0)
  tt.tap(500) // establishes ~120 BPM
  tt.tap(10000) // way later — a new tempo starting, not a continuation
  const result = tt.tap(10600) // 600ms since the "reset" tap -> should reflect ~100 BPM, not blend with the old 120
  assert.equal(Math.round(result.bpm), 100)
})

test('reset() clears history so the next tap starts fresh', () => {
  const tt = new TapTempo()
  tt.tap(0)
  tt.tap(500)
  tt.reset()
  assert.equal(tt.tap(1000), null) // treated as the first tap again
})

test('only the most recent taps are kept (rolling window), so a very old outlier interval eventually ages out', () => {
  const tt = new TapTempo()
  tt.tap(0)
  tt.tap(100) // one fast outlier interval (100ms)
  // now tap steadily at 500ms for a while — long enough to push the outlier out of the window
  let result
  for (let t = 600; t <= 100 + 500 * 10; t += 500) {
    result = tt.tap(t)
  }
  assert.equal(Math.round(result.bpm), 120) // settles back to the steady 500ms-interval tempo
})

test('the Tap Tempo action publishes bpm/beat_seconds as Companion variables after the second tap', async () => {
  const varUpdates = []
  const instance = {
    config: {},
    tapTempo: new TapTempo(),
    setVariableValues: (values) => varUpdates.push(values),
  }
  const action = buildActionDefinitions(instance, fixtureRegistry).tap_tempo

  const now = { t: 0 }
  const originalDateNow = Date.now
  Date.now = () => now.t

  try {
    await action.callback({ options: {} })
    assert.equal(varUpdates.length, 0, 'first tap alone has nothing to publish yet')

    now.t = 500
    await action.callback({ options: {} })
    assert.equal(varUpdates.length, 1)
    assert.equal(varUpdates[0].bpm, 120)
    assert.equal(varUpdates[0].beat_seconds, 0.5)
  } finally {
    Date.now = originalDateNow
  }
})
