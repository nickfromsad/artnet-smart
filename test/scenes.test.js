import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixtureRegistry } from '../src/fixtures/registry.js'
import { buildActionDefinitions } from '../src/actions.js'
import { buildPresetDefinitions } from '../src/presets.js'

/** @param {string[]} types one profile id per patched fixture slot, in order */
function fakeInstanceWithTypes(types) {
  const config = { fixtureCount: types.length }
  types.forEach((type, i) => {
    const n = i + 1
    config[`fixture${n}Name`] = `Fixture ${n}`
    config[`fixture${n}Type`] = type
    config[`fixture${n}Universe`] = 0
    config[`fixture${n}Start`] = 1
  })
  const calls = []
  return {
    instance: {
      config,
      log: () => {},
      sender: {
        setChannels: (universe, startChannel, values) => calls.push({ universe, startChannel, values: [...values] }),
      },
      effects: {
        stop: () => {},
        start: () => {},
        stopAll: () => {},
      },
    },
    calls,
  }
}

function scenePresets(presets) {
  return Object.entries(presets).filter(([id]) => id.startsWith('scene_'))
}

test('dual-white-dimmer\'s Set Full State (All) action exposes exactly coldWhitePercent/warmWhitePercent, no dimmer/CCT/RGB leakage', () => {
  const { instance } = fakeInstanceWithTypes(['dual-white-dimmer', 'dual-white-dimmer'])
  const actions = buildActionDefinitions(instance, fixtureRegistry)
  const action = actions['dual-white-dimmer_all_set_state']
  assert.ok(action, 'dual-white-dimmer_all_set_state action should exist once 2+ are patched')
  assert.deepEqual(
    action.options.map((o) => o.id).sort(),
    ['coldWhitePercent', 'warmWhitePercent'],
  )
})

test('with nothing patched, only the Blackout scene survives (panic button, no fixture dependency)', () => {
  const { instance } = fakeInstanceWithTypes([])
  const presets = buildPresetDefinitions(instance, fixtureRegistry)
  const scenes = scenePresets(presets)
  assert.deepEqual(
    scenes.map(([id]) => id),
    ['scene_blackout'],
  )
  assert.deepEqual(presets.scene_blackout.steps[0].down, [{ actionId: 'stop_all_effects', options: {} }])
})

test('a scene is omitted entirely when none of its fixture groups are patched, not emitted with an empty action list', () => {
  // only Asteras patched — Warm Chill/Color Chase/Two-Color Sweep/Party Blink all
  // reference dual-white-dimmer and lupo-dayled-cct too, so with those absent every
  // non-Astera step drops out, but the scene itself must still fire its Astera step,
  // not disappear or emit a dead button
  const { instance } = fakeInstanceWithTypes(Array(8).fill('astera-helios-profile80'))
  const presets = buildPresetDefinitions(instance, fixtureRegistry)
  const scenes = scenePresets(presets)
  const ids = scenes.map(([id]) => id).sort()
  assert.deepEqual(ids, ['scene_blackout', 'scene_color_chase', 'scene_party_blink', 'scene_two_color_sweep', 'scene_warm_chill'])

  for (const [id, preset] of scenes) {
    if (id === 'scene_blackout') continue
    const actionIds = preset.steps[0].down.map((a) => a.actionId)
    assert.deepEqual(actionIds, ['astera-helios-profile80_start_chase'], `${id} should only touch the patched Astera group`)
  }
})

test('with every fixture group patched, each scene fires one action per group in the expected order', () => {
  const types = [
    'dual-white-dimmer',
    'dual-white-dimmer',
    'lupo-dayled-cct',
    'lupo-dayled-cct',
    ...Array(8).fill('astera-helios-profile80'),
  ]
  const { instance } = fakeInstanceWithTypes(types)
  const presets = buildPresetDefinitions(instance, fixtureRegistry)

  const warmChill = presets.scene_warm_chill
  assert.ok(warmChill, 'scene_warm_chill should exist once every group is patched')
  const actionIds = warmChill.steps[0].down.map((a) => a.actionId)
  assert.deepEqual(actionIds, [
    'dual-white-dimmer_all_set_state',
    'lupo-dayled-cct_all_set_state',
    'astera-helios-profile80_start_chase',
  ])

  const [dualWhiteStep, spotStep, asteraStep] = warmChill.steps[0].down
  assert.deepEqual(dualWhiteStep.options, { coldWhitePercent: 20, warmWhitePercent: 70 })
  assert.equal(spotStep.options.cctKelvin, 2900)
  assert.equal(spotStep.options.dimmerPercent, 40)
  assert.equal(asteraStep.options.program, 'sineDimmer')
  assert.equal(asteraStep.options.twoColorWave, true)

  const blackout = presets.scene_blackout
  const blackoutActionIds = blackout.steps[0].down.map((a) => a.actionId)
  assert.deepEqual(blackoutActionIds, [
    'stop_all_effects',
    'dual-white-dimmer_all_set_state',
    'lupo-dayled-cct_all_set_state',
    'astera-helios-profile80_all_set_state',
  ])
  for (const { actionId, options } of blackout.steps[0].down) {
    if (actionId === 'stop_all_effects') continue
    if ('dimmerPercent' in options) assert.equal(options.dimmerPercent, 0)
  }
})
