import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixtureRegistry } from '../src/fixtures/registry.js'
import { buildActionDefinitions } from '../src/actions.js'
import { buildPresetDefinitions } from '../src/presets.js'
import { getConfigFields, MAX_FIXTURES } from '../src/config.js'

function fakeInstanceWithFixtures(count) {
  const config = { fixtureCount: count }
  for (let i = 1; i <= count; i++) {
    config[`fixture${i}Name`] = `Tube ${i}`
    config[`fixture${i}Type`] = 'astera-helios-profile7'
    config[`fixture${i}Universe`] = 0
    config[`fixture${i}Start`] = (i - 1) * 6 + 1
  }
  const calls = []
  const effectStops = []
  return {
    instance: {
      config,
      log: () => {},
      sender: {
        setChannels: (universe, startChannel, values) => calls.push({ universe, startChannel, values: [...values] }),
      },
      effects: {
        stop: (id) => effectStops.push(id),
        start: () => {},
        stopAll: () => {},
      },
    },
    calls,
    effectStops,
  }
}

test('config fields are capped at MAX_FIXTURES', () => {
  const fields = getConfigFields(fixtureRegistry)
  assert.ok(fields.some((f) => f.id === `fixture${MAX_FIXTURES}Start`))
  assert.ok(!fields.some((f) => f.id === `fixture${MAX_FIXTURES + 1}Start`))
})

function defaultStartOf(fields, i) {
  return fields.find((f) => f.id === `fixture${i}Start`).default
}

test('regression: a new fixture\'s default Name is generic and obviously a placeholder ("Unedited Fixture N"), not hardcoded to a specific brand ("Helios N")', () => {
  // The Name field used to default to "Helios N" — a leftover from when Astera Helios
  // was the only fixture type. Now that Lupo/Generic Dimmer/etc exist too, that default
  // was actively wrong (and confusingly showed up in every action/preset label) for
  // anything you patched that wasn't a Helios. "Unedited" also makes it obvious at a
  // glance, right in the action/preset names, that this fixture hasn't been named yet.
  const fields = getConfigFields(fixtureRegistry)
  const name1 = fields.find((f) => f.id === 'fixture1Name').default
  const name2 = fields.find((f) => f.id === 'fixture2Name').default
  assert.equal(name1, 'Unedited Fixture 1')
  assert.equal(name2, 'Unedited Fixture 2')
  assert.ok(!name1.includes('Helios'))
})

test('a brand new fixture defaults to starting right after the previous one, using its real footprint (regression: used to always add 6, ignoring the actual profile/footprint)', () => {
  const noSavedConfig = getConfigFields(fixtureRegistry, {})
  assert.equal(defaultStartOf(noSavedConfig, 1), 1)
  assert.equal(defaultStartOf(noSavedConfig, 2), 7) // fixture 1 defaults to Profile 7 (6ch): 1 + 6

  // Profile 14 is 7 channels, not 6 — the next fixture's default must reflect that
  const withProfile14First = getConfigFields(fixtureRegistry, {
    fixture1Type: 'astera-helios-profile14',
    fixture1Start: 1,
  })
  assert.equal(defaultStartOf(withProfile14First, 2), 8) // 1 + 7, not 1 + 6

  // the exact scenario reported: fixture 1 manually moved to start=3
  const movedFixture1 = getConfigFields(fixtureRegistry, {
    fixture1Type: 'astera-helios-profile7',
    fixture1Start: 3,
  })
  assert.equal(defaultStartOf(movedFixture1, 2), 9) // continues from 3 + 6, not a blind 7
})

test('the default-start chain carries through multiple already-saved fixtures of mixed profiles', () => {
  const fields = getConfigFields(fixtureRegistry, {
    fixture1Type: 'astera-helios-profile14',
    fixture1Start: 1, // occupies 1-7
    fixture2Type: 'astera-helios-profile7',
    fixture2Start: 8, // occupies 8-13
  })
  assert.equal(defaultStartOf(fields, 3), 14) // 8 + 6
})

test('one "Set Full State" action is generated per patched fixture, named after it', () => {
  const { instance } = fakeInstanceWithFixtures(8)
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  for (let i = 1; i <= 8; i++) {
    const action = actions[`astera-helios-profile7_f${i}_set_state`]
    assert.ok(action, `missing action for fixture ${i}`)
    assert.equal(action.name, `Tube ${i} — Set Full State`)
    // no Fixture/Universe/Start Channel fields — those are baked in, not user-editable
    assert.ok(!action.options.some((o) => o.id === 'fixture'))
    assert.ok(!action.options.some((o) => o.id === 'universe'))
    assert.ok(!action.options.some((o) => o.id === 'startChannel'))
  }
})

test('a per-fixture action sends to that fixture\'s patched universe/start channel, with no way to override it', async () => {
  const { instance, calls } = fakeInstanceWithFixtures(8)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f3_set_state']

  await action.callback({
    options: { color: 0x00ff00, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0 },
  })

  assert.equal(calls.at(-1).universe, 0)
  assert.equal(calls.at(-1).startChannel, 13) // (3-1)*6+1, per the fake patch list
})

test('renaming or re-patching a fixture in config changes the action next time it is rebuilt, without changing its id', async () => {
  const { instance, calls } = fakeInstanceWithFixtures(8)
  instance.config.fixture3Start = 200 // simulate re-patching Tube 3 in the config UI
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_f3_set_state']

  await action.callback({
    options: { color: 0x00ff00, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0 },
  })

  assert.equal(calls.at(-1).startChannel, 200)
})

test('the Manual action has editable Universe/Start Channel fields, unlike the per-fixture actions', async () => {
  const { instance, calls } = fakeInstanceWithFixtures(8)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_manual_set_state']

  assert.ok(action.options.some((o) => o.id === 'universe'))
  assert.ok(action.options.some((o) => o.id === 'startChannel'))

  await action.callback({
    options: {
      universe: 5,
      startChannel: 100,
      color: 0xff0000,
      cctEnabled: false,
      cctKelvin: 3000,
      dimmerPercent: 100,
      indexColor: 0,
    },
  })

  assert.equal(calls.at(-1).universe, 5)
  assert.equal(calls.at(-1).startChannel, 100)
})

test('the raw fallback action always has an editable, always-visible Universe field', () => {
  const { instance } = fakeInstanceWithFixtures(8)
  const rawAction = buildActionDefinitions(instance, fixtureRegistry).raw_set_channel
  const universeField = rawAction.options.find((o) => o.id === 'universe')
  assert.ok(universeField)
  assert.ok(!universeField.isVisible)
  assert.ok(!universeField.isVisibleExpression)
})

test('no action or config field uses a closure-capturing isVisible function (they silently fail to show)', () => {
  // Regression guard for a bug we hit: isVisible functions that reference an outer
  // variable get skipped by Companion because `.toString()` doesn't carry the
  // closure. Fail the build if this pattern creeps back in anywhere.
  const { instance } = fakeInstanceWithFixtures(8)
  const configFields = getConfigFields(fixtureRegistry)
  const actionFields = Object.values(buildActionDefinitions(instance, fixtureRegistry)).flatMap((a) => a.options)

  for (const field of [...configFields, ...actionFields]) {
    assert.equal(
      typeof field.isVisible,
      'undefined',
      `field "${field.id}" uses a deprecated isVisible function instead of isVisibleExpression`,
    )
  }
})

test('fixtures of a non-matching type do not get an action or preset under the wrong profile', () => {
  const { instance } = fakeInstanceWithFixtures(2)
  instance.config.fixture2Type = 'astera-helios-profile14'
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  assert.ok(actions['astera-helios-profile7_f1_set_state'])
  assert.ok(!actions['astera-helios-profile7_f2_set_state'])
  assert.ok(actions['astera-helios-profile14_f2_set_state'])
  assert.ok(!actions['astera-helios-profile14_f1_set_state'])
})

test('a profile with zero patched fixtures gets no actions at all — not even Manual/Chase', () => {
  const { instance } = fakeInstanceWithFixtures(8) // all 8 patched as astera-helios-profile7, none as profile14
  const actions = buildActionDefinitions(instance, fixtureRegistry)

  assert.ok(actions['astera-helios-profile7_manual_set_state'])
  assert.ok(actions['astera-helios-profile7_start_chase'])
  assert.ok(!actions['astera-helios-profile14_manual_set_state'])
  assert.ok(!actions['astera-helios-profile14_start_chase'])
  assert.ok(!actions['astera-helios-profile14_stop_chase'])
  // the fixture-independent fallbacks are always present regardless
  assert.ok(actions.raw_set_channel)
  assert.ok(actions.stop_all_effects)
})

test('zero fixtures configured at all leaves only the fixture-independent fallback actions/presets', () => {
  const { instance } = fakeInstanceWithFixtures(0)
  const actions = buildActionDefinitions(instance, fixtureRegistry)
  const presets = buildPresetDefinitions(instance, fixtureRegistry)

  assert.deepEqual(Object.keys(actions).sort(), ['raw_set_channel', 'stop_all_effects', 'tap_tempo'])
  assert.deepEqual(Object.keys(presets).sort(), ['stop_all_effects', 'tap_tempo'])
})

test('presets are generated per patched fixture, plus one Manual and one Chase set for profiles actually in use — nothing for unused profiles', () => {
  const { instance } = fakeInstanceWithFixtures(8) // all 8 patched as astera-helios-profile7, none as profile14
  const presets = buildPresetDefinitions(instance, fixtureRegistry)
  const categories = new Set(Object.values(presets).map((p) => p.category))

  // 8 profile7 fixtures + profile7's All + Manual + Chase + the global "Effects"
  // category. Profile 14 contributes nothing since no fixture is patched as it.
  assert.equal(categories.size, 8 + 3 + 1)
  assert.ok(![...categories].some((c) => c.includes('Profile 14')), 'an unused profile must not appear in the presets panel at all')

  for (const preset of Object.values(presets)) {
    assert.ok(typeof preset.steps[0].down[0].actionId === 'string')
  }
})

test('a fixture preset points at that fixture\'s own action id, not the Manual one', () => {
  const { instance } = fakeInstanceWithFixtures(8)
  const presets = buildPresetDefinitions(instance, fixtureRegistry)
  assert.equal(presets['astera-helios-profile7_f3_full_red'].steps[0].down[0].actionId, 'astera-helios-profile7_f3_set_state')
})

test('Profile 14 Set Full State: strobe modes resolve to the right raw channel value', async () => {
  const { instance, calls } = fakeInstanceWithFixtures(1)
  instance.config.fixture1Type = 'astera-helios-profile14'
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile14_f1_set_state']

  const baseOptions = {
    color: 0x000000,
    cctEnabled: false,
    cctKelvin: 3000,
    dimmerPercent: 100,
    indexColor: 0,
    strobeHz: 12,
  }

  await action.callback({ options: { ...baseOptions, strobeMode: 'off' } })
  assert.equal(calls.at(-1).values[6], 0)

  await action.callback({ options: { ...baseOptions, strobeMode: 'randomFast' } })
  assert.equal(calls.at(-1).values[6], 4)

  await action.callback({ options: { ...baseOptions, strobeMode: 'randomMedium' } })
  assert.equal(calls.at(-1).values[6], 5)

  await action.callback({ options: { ...baseOptions, strobeMode: 'randomSlow' } })
  assert.equal(calls.at(-1).values[6], 6)

  await action.callback({ options: { ...baseOptions, strobeMode: 'variable', strobeHz: 25 } })
  assert.equal(calls.at(-1).values[6], 255)
})

test('the Strobe Rate (Hz) field only shows in variable mode', () => {
  const { instance } = fakeInstanceWithFixtures(1)
  instance.config.fixture1Type = 'astera-helios-profile14'
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile14_f1_set_state']
  const hzField = action.options.find((o) => o.id === 'strobeHz')
  assert.equal(typeof hzField.isVisible, 'undefined')
  assert.match(hzField.isVisibleExpression, /\$\(options:strobeMode\)/)
})

test('"Set Full State (All)" is only generated with 2+ patched fixtures of a profile', () => {
  const one = fakeInstanceWithFixtures(1)
  assert.ok(!buildActionDefinitions(one.instance, fixtureRegistry)['astera-helios-profile7_all_set_state'])

  const eight = fakeInstanceWithFixtures(8)
  assert.ok(buildActionDefinitions(eight.instance, fixtureRegistry)['astera-helios-profile7_all_set_state'])
})

test('"Set Full State (All)" sends the same values to every currently-patched fixture of that profile', async () => {
  const { instance, calls } = fakeInstanceWithFixtures(8)
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_all_set_state']

  await action.callback({
    options: { color: 0x00ff00, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0 },
  })

  assert.equal(calls.length, 8)
  for (let i = 0; i < 8; i++) {
    assert.equal(calls[i].universe, 0)
    assert.equal(calls[i].startChannel, i * 6 + 1) // fixture (i+1)'s patched start channel
    assert.equal(calls[i].values[1], 255) // green channel, same on every fixture
  }
})

test('"Set Full State (All)" only touches fixtures actually patched as this profile, not others', async () => {
  const { instance, calls } = fakeInstanceWithFixtures(3)
  instance.config.fixture2Type = 'astera-helios-profile14' // fixture 2 is a different profile now
  const action = buildActionDefinitions(instance, fixtureRegistry)['astera-helios-profile7_all_set_state']

  await action.callback({
    options: { color: 0xff0000, cctEnabled: false, cctKelvin: 3000, dimmerPercent: 100, indexColor: 0 },
  })

  assert.equal(calls.length, 2) // fixtures 1 and 3, not 2
  assert.deepEqual(
    calls.map((c) => c.startChannel).sort((a, b) => a - b),
    [1, 13],
  )
})
