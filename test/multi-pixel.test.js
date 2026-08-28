import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixtureRegistry } from '../src/fixtures/registry.js'
import { buildActionDefinitions } from '../src/actions.js'
import { EFFECT_PROGRAMS } from '../src/effects/programs.js'
import { asteraHeliosProfile80 } from '../src/fixtures/astera-helios-profile80.js'

/**
 * Astera Helios Profile 80 (4 pixels, 1 shared Strobe) is the first fixture whose
 * channels repeat per "pixel" — these tests cover the fan-out mechanism added for it
 * (src/fixtures/state.js's rgbGroups/findChannels/groupedOtherChannels): one Companion
 * field controls all 4 pixels together, and the write lands on every pixel's channel,
 * not just the first.
 */

function fakeInstanceWithProfile80() {
  const config = {
    fixtureCount: 1,
    fixture1Name: 'Batten 1',
    fixture1Type: 'astera-helios-profile80',
    fixture1Universe: 0,
    fixture1Start: 1,
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
        stopAll: () => {},
      },
    },
    sent,
    effectCalls,
  }
}

const PIXEL_STARTS = [0, 6, 12, 18] // red offset of pixel 1..4

test('Set Full State has exactly one Color/CCT/Dimmer/Index/Strobe field, not one per pixel', () => {
  const { instance } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_set_state']

  const ids = action.options.map((o) => o.id)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate option ids (Companion rejects those)')
  for (const id of ['color', 'cctEnabled', 'cctKelvin', 'dimmerPercent', 'indexColor', 'strobeMode', 'strobeHz']) {
    assert.equal(ids.filter((i) => i === id).length, 1, `expected exactly one "${id}" field, got ${ids.filter((i) => i === id).length}`)
  }
})

test('Set Full State: Color fans out to all 4 pixels\' Red/Green/Blue channels', async () => {
  const { instance, sent } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_set_state']

  await action.callback({
    options: { color: 0x00ff00, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0, strobeMode: 'off', strobeHz: 1 },
  })

  const values = sent.at(-1).values
  for (const start of PIXEL_STARTS) {
    assert.equal(values[start], 0, `pixel at offset ${start}: red`)
    assert.equal(values[start + 1], 255, `pixel at offset ${start}: green`)
    assert.equal(values[start + 2], 0, `pixel at offset ${start}: blue`)
  }
})

test('Set Full State: CCT, Dimmer, and Index Color each fan out to all 4 pixels', async () => {
  const { instance, sent } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_set_state']

  await action.callback({
    options: { color: 0x000000, cctEnabled: true, cctKelvin: 3000, dimmerPercent: 50, indexColor: 42, strobeMode: 'off', strobeHz: 1 },
  })

  const values = sent.at(-1).values
  const expectedCctRaw = asteraHeliosProfile80.channels.find((c) => c.key === 'cct').kelvinToRaw(3000)
  for (const start of PIXEL_STARTS) {
    assert.equal(values[start + 3], expectedCctRaw, `pixel at offset ${start}: CCT`)
    assert.equal(values[start + 4], Math.round((50 * 255) / 100), `pixel at offset ${start}: Dimmer`)
    assert.equal(values[start + 5], 42, `pixel at offset ${start}: Index Color`)
  }
})

test('Set Full State: Strobe writes only the single shared channel (offset 24), not once per pixel', async () => {
  const { instance, sent } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_set_state']

  await action.callback({
    options: { color: 0x000000, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 0, indexColor: 0, strobeMode: 'randomFast', strobeHz: 1 },
  })

  const values = sent.at(-1).values
  assert.equal(values[24], 4) // randomFast raw code
  assert.equal(values.length, 25)
})

test('Rainbow effect tick colors all 4 pixels in sync', () => {
  const overrides = EFFECT_PROGRAMS.rainbow.tick(asteraHeliosProfile80, 0)
  assert.equal(overrides.length, 12) // 4 pixels x (red, green, blue)
  for (const start of PIXEL_STARTS) {
    assert.equal(overrides.find((o) => o.offset === start).value, 255) // red at phase 0
    assert.equal(overrides.find((o) => o.offset === start + 1).value, 0)
    assert.equal(overrides.find((o) => o.offset === start + 2).value, 0)
  }
})

test('Sine Breathing Dimmer effect tick drives all 4 pixels\' Dimmer channels together', () => {
  const overrides = EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile80, 0.5, { min: 0, max: 100 })
  assert.equal(overrides.length, 4)
  for (const start of PIXEL_STARTS) {
    assert.equal(overrides.find((o) => o.offset === start + 4).value, 255) // phase 0.5 = max
  }
})

test('regression: starting an effect resets CCT to off on all 4 pixels, not just the first', async () => {
  const { instance, sent } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_start_effect']

  await action.callback({ options: { program: 'rainbow', periodSeconds: 4, dimmerPercent: 100 } })

  const values = sent[0].values
  for (const start of PIXEL_STARTS) {
    assert.equal(values[start + 3], 0, `pixel at offset ${start}: CCT must reset to off`)
  }
})

/**
 * "Pixel Phase Spread" ripples an effect across one fixture's own repeated pixels
 * (e.g. Sine Breathing sweeping down the 4 segments of one tube) instead of pulsing
 * them all in perfect sync — the within-fixture counterpart to the existing chase-level
 * Phase Spread, which ripples across separate physical fixtures.
 */

test('Pixel Phase Spread field only exists for multi-pixel profiles (Profile 80), not single-pixel ones (Profile 7)', () => {
  const { instance } = fakeInstanceWithProfile80()
  instance.config.fixture2Name = 'Tube 2'
  instance.config.fixture2Type = 'astera-helios-profile7'
  instance.config.fixture2Universe = 0
  instance.config.fixture2Start = 30
  instance.config.fixtureCount = 2
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  assert.ok(actions['astera-helios-profile80_f1_start_effect'].options.some((o) => o.id === 'pixelPhaseSpread'))
  assert.ok(!actions['astera-helios-profile7_f2_start_effect'].options.some((o) => o.id === 'pixelPhaseSpread'))
})

test('Pixel Phase Spread defaults to 1 (rippling), so the field exists ready to use without extra setup', () => {
  const { instance } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_start_effect']
  const field = action.options.find((o) => o.id === 'pixelPhaseSpread')
  assert.equal(field.default, 1)
})

test('Start Effect passes pixelPhaseSpread through to the engine as a program param', async () => {
  const { instance, effectCalls } = fakeInstanceWithProfile80()
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile80_f1_start_effect']

  await action.callback({ options: { program: 'sineDimmer', periodSeconds: 4, dimmerMin: 0, dimmerMax: 100, pixelPhaseSpread: 1 } })

  const start = effectCalls.find((c) => c.type === 'start')
  assert.equal(start.opts.params.pixelPhaseSpread, 1)
})

test('sineDimmer with pixelPhaseSpread=1: the 4 pixels are out of phase with each other, not identical', () => {
  const overrides = EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile80, 0.1, { min: 0, max: 100, pixelPhaseSpread: 1 })
  const values = PIXEL_STARTS.map((start) => overrides.find((o) => o.offset === start + 4).value)
  assert.ok(new Set(values).size > 1, `expected pixels to differ at phase 0.1 with full spread, got ${values}`)
})

test('sineDimmer with pixelPhaseSpread=0: the 4 pixels stay perfectly in sync (same as before this feature existed)', () => {
  const overrides = EFFECT_PROGRAMS.sineDimmer.tick(asteraHeliosProfile80, 0.1, { min: 0, max: 100, pixelPhaseSpread: 0 })
  const values = PIXEL_STARTS.map((start) => overrides.find((o) => o.offset === start + 4).value)
  assert.ok(new Set(values).size === 1, `expected all 4 pixels identical with zero spread, got ${values}`)
})

test('rainbow with pixelPhaseSpread=1: each pixel shows a different hue, not the same color', () => {
  const overrides = EFFECT_PROGRAMS.rainbow.tick(asteraHeliosProfile80, 0, { pixelPhaseSpread: 1 })
  const reds = PIXEL_STARTS.map((start) => overrides.find((o) => o.offset === start).value)
  assert.ok(new Set(reds).size > 1, `expected differing red values across pixels, got ${reds}`)
})

test('pixelPhaseSpread has no effect on single-pixel profiles (only one pixel to spread across)', () => {
  const withSpread = EFFECT_PROGRAMS.sineDimmer.tick(fixtureRegistry.find((p) => p.id === 'astera-helios-profile7'), 0.1, {
    min: 0,
    max: 100,
    pixelPhaseSpread: 1,
  })
  const withoutSpread = EFFECT_PROGRAMS.sineDimmer.tick(fixtureRegistry.find((p) => p.id === 'astera-helios-profile7'), 0.1, {
    min: 0,
    max: 100,
    pixelPhaseSpread: 0,
  })
  assert.deepEqual(withSpread, withoutSpread)
})
