import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixtureRegistry } from '../src/fixtures/registry.js'
import { buildActionDefinitions } from '../src/actions.js'

function fakeInstanceWithFixtures(count) {
  const config = { fixtureCount: count }
  for (let i = 1; i <= count; i++) {
    config[`fixture${i}Name`] = `Tube ${i}`
    config[`fixture${i}Type`] = 'astera-helios-profile7'
    config[`fixture${i}Universe`] = 0
    config[`fixture${i}Start`] = (i - 1) * 6 + 1
  }
  const sent = []
  const effectCalls = []
  return {
    instance: {
      config,
      log: () => {},
      sender: {
        setChannels: (universe, startChannel, values) => sent.push({ universe, startChannel, values: [...values] }),
      },
      effects: {
        start: (id, opts) => effectCalls.push({ type: 'start', id, opts }),
        stop: (id) => effectCalls.push({ type: 'stop', id }),
        stopAll: () => effectCalls.push({ type: 'stopAll' }),
      },
    },
    sent,
    effectCalls,
  }
}

test('per-fixture Start/Stop Effect and per-profile Start/Stop Chase actions are generated, plus a global Stop All', () => {
  const { instance } = fakeInstanceWithFixtures(2)
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  assert.ok(actions['astera-helios-profile7_f1_start_effect'])
  assert.ok(actions['astera-helios-profile7_f1_stop_effect'])
  assert.ok(actions['astera-helios-profile7_start_chase'])
  assert.ok(actions['astera-helios-profile7_stop_chase'])
  assert.ok(actions.stop_all_effects)
})

test('Start Effect fields: program dropdown, speed, and per-program fields gated by isVisibleExpression (not isVisible)', () => {
  const { instance } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f1_start_effect']

  const programField = action.options.find((o) => o.id === 'program')
  assert.deepEqual(
    programField.choices.map((c) => c.id).sort(),
    ['rainbow', 'sineDimmer', 'squareDimmer'],
  )
  assert.ok(action.options.some((o) => o.id === 'periodSeconds'))
  assert.ok(!action.options.some((o) => o.id === 'phaseSpread'), 'phaseSpread only belongs on the Chase action')

  const dimmerPercent = action.options.find((o) => o.id === 'dimmerPercent')
  assert.equal(typeof dimmerPercent.isVisible, 'undefined')
  assert.match(dimmerPercent.isVisibleExpression, /rainbow/)

  const color = action.options.find((o) => o.id === 'color')
  assert.equal(typeof color.isVisible, 'undefined')
  assert.match(color.isVisibleExpression, /sineDimmer/)
  assert.match(color.isVisibleExpression, /squareDimmer/, 'color must also be shown for squareDimmer, not just sineDimmer')

  const dutyCycle = action.options.find((o) => o.id === 'dutyCycle')
  assert.equal(typeof dutyCycle.isVisible, 'undefined')
  assert.match(dutyCycle.isVisibleExpression, /squareDimmer/)
})

test('Start Chase has a phaseSpread field in addition to the Start Effect fields', () => {
  const { instance } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_start_chase']
  assert.ok(action.options.some((o) => o.id === 'phaseSpread'))
})

test('Start Effect (Rainbow): sends a one-shot Dimmer baseline and starts the engine with fixtureIndices=[i]', async () => {
  const { instance, sent, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f1_start_effect']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 5, dimmerPercent: 80 } })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].universe, 0)
  assert.equal(sent[0].startChannel, 1)
  const dimmerOffset = 4 // Astera Helios Profile 7 dimmer channel offset
  assert.equal(sent[0].values[dimmerOffset], Math.round((80 * 255) / 100))

  // starting an effect first stops every other program that could be running on this
  // fixture (see the "switching effects" test below), then starts the requested one
  const starts = effectCalls.filter((c) => c.type === 'start')
  assert.equal(starts.length, 1)
  assert.equal(starts[0].id, 'astera-helios-profile7_f1_rainbow')
  assert.equal(starts[0].opts.fixtureIndices.length, 1)
  assert.equal(starts[0].opts.fixtureIndices[0], 1)
  assert.equal(starts[0].opts.periodSeconds, 5)
})

test('regression: starting an effect resets CCT to off, so a previously-set CCT color does not hide the RGB effect', async () => {
  // Astera firmware quirk: a non-zero CCT value silently overrides RGB, regardless of
  // what we send afterward — so every effect start must reset CCT back to off.
  const cctOffset = 3 // Astera Helios Profile 7 CCT channel offset

  const { instance: rainbowInstance, sent: rainbowSent } = fakeInstanceWithFixtures(1)
  const rainbowAction = buildActionDefinitions(rainbowInstance, fixtureRegistry)['astera-helios-profile7_f1_start_effect']
  await rainbowAction.callback({ options: { program: 'rainbow', periodSeconds: 4, dimmerPercent: 100 } })
  assert.equal(rainbowSent[0].values[cctOffset], 0, 'Rainbow start must reset CCT to off')

  const { instance: sineInstance, sent: sineSent } = fakeInstanceWithFixtures(1)
  const sineAction = buildActionDefinitions(sineInstance, fixtureRegistry)['astera-helios-profile7_f1_start_effect']
  await sineAction.callback({ options: { program: 'sineDimmer', periodSeconds: 4, color: 0xff0000, dimmerMin: 0, dimmerMax: 100 } })
  assert.equal(sineSent[0].values[cctOffset], 0, 'Sine Dimmer start must reset CCT to off')

  const { instance: chaseInstance, sent: chaseSent } = fakeInstanceWithFixtures(2)
  const chaseAction = buildActionDefinitions(chaseInstance, fixtureRegistry)['astera-helios-profile7_start_chase']
  await chaseAction.callback({
    options: { program: 'squareDimmer', periodSeconds: 4, phaseSpread: 1, color: 0x00ff00, dimmerMin: 0, dimmerMax: 100, dutyCycle: 50 },
  })
  assert.ok(
    chaseSent.every((s) => s.values[cctOffset] === 0),
    'Chase start must reset CCT to off on every targeted fixture',
  )
})

test('Start Effect (Sine Dimmer): sends a one-shot Color baseline and starts the engine with min/max params', async () => {
  const { instance, sent, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f2_start_effect']

  await action.callback({
    options: { program: 'sineDimmer', periodSeconds: 3, color: 0x0000ff, dimmerMin: 10, dimmerMax: 90 },
  })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].startChannel, 7) // fixture 2's patched start channel
  assert.equal(sent[0].values[2], 255) // blue channel offset 2

  const start = effectCalls.find((c) => c.type === 'start')
  assert.equal(start.id, 'astera-helios-profile7_f2_sineDimmer')
  assert.deepEqual(start.opts.params, { min: 10, max: 90, blankSpace: 0, twoColorWave: false })
})

test('Stop Effect stops both possible program ids on that fixture', async () => {
  const { instance, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f1_stop_effect']

  await action.callback({ options: {} })

  const stoppedIds = effectCalls.filter((c) => c.type === 'stop').map((c) => c.id)
  assert.ok(stoppedIds.includes('astera-helios-profile7_f1_rainbow'))
  assert.ok(stoppedIds.includes('astera-helios-profile7_f1_sineDimmer'))
})

test('Start Chase targets every currently-patched fixture of the profile and sends a one-shot baseline to each', async () => {
  const { instance, sent, effectCalls } = fakeInstanceWithFixtures(3)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_start_chase']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 6, phaseSpread: 2, dimmerPercent: 100 } })

  assert.equal(sent.length, 3) // one baseline per patched fixture
  const start = effectCalls.find((c) => c.type === 'start')
  assert.equal(start.id, 'astera-helios-profile7_chase_rainbow')
  assert.deepEqual(start.opts.fixtureIndices, [1, 2, 3])
  assert.equal(start.opts.phaseSpread, 2)
})

test('Stop Chase stops both possible program ids for the chase', async () => {
  const { instance, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_stop_chase']

  await action.callback({ options: {} })

  const stoppedIds = effectCalls.filter((c) => c.type === 'stop').map((c) => c.id)
  assert.ok(stoppedIds.includes('astera-helios-profile7_chase_rainbow'))
  assert.ok(stoppedIds.includes('astera-helios-profile7_chase_sineDimmer'))
})

test('Stop All Effects calls stopAll on the engine', async () => {
  const { instance, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry).stop_all_effects

  await action.callback({ options: {} })

  assert.equal(effectCalls.length, 1)
  assert.equal(effectCalls[0].type, 'stopAll')
})

test('Start Chase always passes fixtureIndices in natural order plus a randomOrder flag — shuffling itself is the engine\'s job', async () => {
  // The action layer no longer shuffles at all (that would only reshuffle once, at
  // Start) — it just tells the engine whether to keep reshuffling every lap. See
  // test/effects.test.js for the actual per-lap reshuffling behavior.
  const { instance, effectCalls } = fakeInstanceWithFixtures(5)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_start_chase']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 4, phaseSpread: 1, dimmerPercent: 100 } })
  let start = effectCalls.find((c) => c.type === 'start')
  assert.deepEqual(start.opts.fixtureIndices, [1, 2, 3, 4, 5])
  assert.equal(start.opts.randomOrder, false)

  effectCalls.length = 0
  await action.callback({ options: { program: 'rainbow', periodSeconds: 4, phaseSpread: 1, dimmerPercent: 100, randomOrder: true } })
  start = effectCalls.find((c) => c.type === 'start')
  assert.deepEqual(start.opts.fixtureIndices, [1, 2, 3, 4, 5])
  assert.equal(start.opts.randomOrder, true)
})

test('the Random Order field only exists on the Chase action, not the per-fixture Start Effect', () => {
  const { instance } = fakeInstanceWithFixtures(2)
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  assert.ok(actions['astera-helios-profile7_start_chase'].options.some((o) => o.id === 'randomOrder'))
  assert.ok(!actions['astera-helios-profile7_f1_start_effect'].options.some((o) => o.id === 'randomOrder'))
})

test('Reverse Direction only exists on the Chase action, and negates the phaseSpread passed to the engine', async () => {
  const { instance, effectCalls } = fakeInstanceWithFixtures(5)
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  assert.ok(actions['astera-helios-profile7_start_chase'].options.some((o) => o.id === 'reverseDirection'))
  assert.ok(!actions['astera-helios-profile7_f1_start_effect'].options.some((o) => o.id === 'reverseDirection'))

  const action = actions['astera-helios-profile7_start_chase']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 4, phaseSpread: 1, dimmerPercent: 100 } })
  assert.equal(effectCalls.find((c) => c.type === 'start').opts.phaseSpread, 1)

  effectCalls.length = 0
  await action.callback({
    options: { program: 'rainbow', periodSeconds: 4, phaseSpread: 1, dimmerPercent: 100, reverseDirection: true },
  })
  assert.equal(effectCalls.find((c) => c.type === 'start').opts.phaseSpread, -1)
})

test('Follow BPM and Beats per Cycle fields exist on both Start Effect and Start Chase, with Speed hidden while Follow BPM is on', () => {
  const { instance } = fakeInstanceWithFixtures(2)
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  for (const actionId of ['astera-helios-profile7_f1_start_effect', 'astera-helios-profile7_start_chase']) {
    const action = actions[actionId]
    const followBpm = action.options.find((o) => o.id === 'followBpm')
    const beatsPerCycle = action.options.find((o) => o.id === 'beatsPerCycle')
    const periodSeconds = action.options.find((o) => o.id === 'periodSeconds')

    assert.ok(followBpm, `${actionId} missing followBpm`)
    assert.equal(followBpm.type, 'checkbox')

    assert.ok(beatsPerCycle, `${actionId} missing beatsPerCycle`)
    assert.equal(typeof beatsPerCycle.isVisible, 'undefined')
    assert.match(beatsPerCycle.isVisibleExpression, /followBpm/)

    assert.equal(typeof periodSeconds.isVisible, 'undefined')
    assert.match(periodSeconds.isVisibleExpression, /followBpm/, 'Speed must hide once Follow BPM is checked')
  }
})

test('Start Effect passes followBpm/beatsPerCycle through to the engine', async () => {
  const { instance, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f1_start_effect']

  await action.callback({
    options: { program: 'rainbow', periodSeconds: 4, dimmerPercent: 100, followBpm: true, beatsPerCycle: 2 },
  })

  const start = effectCalls.find((c) => c.type === 'start')
  assert.equal(start.opts.followBpm, true)
  assert.equal(start.opts.beatsPerCycle, 2)
})

test('Start Chase passes followBpm/beatsPerCycle through to the engine, defaulting beatsPerCycle to 1 when omitted', async () => {
  const { instance, effectCalls } = fakeInstanceWithFixtures(2)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_start_chase']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 4, phaseSpread: 1, dimmerPercent: 100, followBpm: true } })

  const start = effectCalls.find((c) => c.type === 'start')
  assert.equal(start.opts.followBpm, true)
  assert.equal(start.opts.beatsPerCycle, 1)
})

function fakeInstanceWithMixedFixtures() {
  const config = {
    fixtureCount: 2,
    fixture1Name: 'Lupo 1',
    fixture1Type: 'lupo-dayled-cct',
    fixture1Universe: 0,
    fixture1Start: 1,
    fixture2Name: 'Dimmer Pack 1',
    fixture2Type: 'generic-dimmer',
    fixture2Universe: 0,
    fixture2Start: 3,
  }
  const sent = []
  const effectCalls = []
  return {
    instance: {
      config,
      log: () => {},
      sender: { setChannels: (universe, startChannel, values) => sent.push({ universe, startChannel, values: [...values] }) },
      effects: {
        start: (id, opts) => effectCalls.push({ type: 'start', id, opts }),
        stop: (id) => effectCalls.push({ type: 'stop', id }),
        stopAll: () => effectCalls.push({ type: 'stopAll' }),
      },
    },
    sent,
    effectCalls,
  }
}

test('Lupo Dayled (no RGB, CCT overridesRgb=false): Set Full State has no cctEnabled checkbox and Kelvin always applies', async () => {
  const { instance, sent } = fakeInstanceWithMixedFixtures()
  const action = buildActionDefinitions(instance, fixtureRegistry)['lupo-dayled-cct_f1_set_state']

  assert.ok(!action.options.some((o) => o.id === 'cctEnabled'), 'Lupo has nothing for cctEnabled to toggle between')
  assert.ok(!action.options.some((o) => o.id === 'color'), 'Lupo has no RGB channels')

  await action.callback({ options: { dimmerPercent: 100, cctKelvin: 2700 } })
  assert.equal(sent[0].values[0], 255) // dimmer 100%
  assert.equal(sent[0].values[1], 255) // 2700K = warmest = raw 255
})

test('Lupo Dayled Start Effect has no "Color while running" field (nothing for it to set)', () => {
  const { instance } = fakeInstanceWithMixedFixtures()
  const action = buildActionDefinitions(instance, fixtureRegistry)['lupo-dayled-cct_f1_start_effect']

  assert.ok(!action.options.some((o) => o.id === 'color'))
  assert.ok(action.options.some((o) => o.id === 'dimmerMin'))
  assert.ok(action.options.some((o) => o.id === 'dimmerMax'))
  // Rainbow requires RGB, which Lupo doesn't have
  const programField = action.options.find((o) => o.id === 'program')
  assert.ok(!programField.choices.some((c) => c.id === 'rainbow'))
})

test('Generic Dimmer: Set Full State is just a Dimmer % field, and effects work (Breathing/Blink, no Rainbow)', async () => {
  const { instance, sent } = fakeInstanceWithMixedFixtures()
  const stateAction = buildActionDefinitions(instance, fixtureRegistry)['generic-dimmer_f2_set_state']

  assert.deepEqual(
    stateAction.options.map((o) => o.id),
    ['dimmerPercent'],
  )

  await stateAction.callback({ options: { dimmerPercent: 50 } })
  assert.equal(sent[0].universe, 0)
  assert.equal(sent[0].startChannel, 3)
  assert.equal(sent[0].values[0], 128)

  const effectAction = buildActionDefinitions(instance, fixtureRegistry)['generic-dimmer_f2_start_effect']
  const programField = effectAction.options.find((o) => o.id === 'program')
  assert.deepEqual(
    programField.choices.map((c) => c.id).sort(),
    ['sineDimmer', 'squareDimmer'],
  )
})

test('regression: switching a Lupo fixture from Sine Breathing to Set Full State stops the running effect (same fix as RGB fixtures)', async () => {
  const { instance, effectCalls } = fakeInstanceWithMixedFixtures()
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  await actions['lupo-dayled-cct_f1_start_effect'].callback({
    options: { program: 'sineDimmer', periodSeconds: 4, dimmerMin: 0, dimmerMax: 100 },
  })
  effectCalls.length = 0

  await actions['lupo-dayled-cct_f1_set_state'].callback({ options: { dimmerPercent: 100, cctKelvin: 3000 } })
  const stoppedIds = effectCalls.filter((c) => c.type === 'stop').map((c) => c.id)
  assert.ok(stoppedIds.includes('lupo-dayled-cct_f1_sineDimmer'))
})
