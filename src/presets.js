/**
 * Turns fixture profile data into ready-to-drag preset buttons that call the
 * per-fixture "Set Full State" action built in actions.js. One set of
 * presets is generated per fixture patched in the instance config (so with 8
 * fixtures patched you get 8 ready-made "Full Red" buttons, one per fixture,
 * grouped by fixture name), plus one "Manual" set per profile for anyone not
 * using the patch list — its Universe/Start Channel ship as placeholders
 * (0 / 1) that you edit after dropping the button on a page.
 */

import { MAX_FIXTURES } from './config.js'
import { hasRgb, pixelCount } from './fixtures/state.js'
import { EFFECT_PROGRAMS } from './effects/programs.js'

function supportedPrograms(profile) {
  return Object.values(EFFECT_PROGRAMS).filter((p) => p.supports(profile))
}

/** Base option values for a "Start Effect"/"Start Chase" action, matching the fields built in actions.js */
function effectStartOptions(profile, programId, extra = {}) {
  const options = { program: programId, periodSeconds: 4, followBpm: false, beatsPerCycle: 1 }
  const programs = supportedPrograms(profile)
  if (programs.some((p) => p.touches === 'rgb')) options.dimmerPercent = 100
  if (programs.some((p) => p.touches === 'dimmer')) {
    if (hasRgb(profile)) options.color = 0xffffff // nothing for "Color while running" to set otherwise
    options.dimmerMin = 0
    options.dimmerMax = 100
  }
  if (programId === 'squareDimmer') options.dutyCycle = 50
  // matches the Pixel Phase Spread field's own default (actions.js) — ripples across
  // this fixture's own pixels out of the box, rather than pulsing them all in
  // lockstep. Chase presets (extra.phaseSpread set) don't get this: Chase derives its
  // own pixel spread automatically from Phase Spread, the field doesn't exist there.
  if (pixelCount(profile) > 1 && !('phaseSpread' in extra)) options.pixelPhaseSpread = 1
  return { ...options, ...extra }
}

/** Base option values for a "Set Full State" action, matching the fields built in actions.js */
function stateOptions(profile) {
  const options = {}
  const cctChannel = profile.channels.find((c) => c.type === 'kelvin')
  const strobeChannel = profile.channels.find((c) => c.type === 'strobe')

  if (hasRgb(profile)) options.color = 0x000000
  if (cctChannel) {
    if (cctChannel.overridesRgb) options.cctEnabled = false
    options.cctKelvin = cctChannel.kelvinMin
  }
  if (strobeChannel) {
    options.strobeMode = 'off'
    options.strobeHz = strobeChannel.hzMin
  }

  for (const channel of profile.channels) {
    if (['red', 'green', 'blue'].includes(channel.key) || channel.type === 'kelvin' || channel.type === 'strobe')
      continue
    if (channel.type === 'percent8') {
      options[`${channel.key}Percent`] = channel.key === 'dimmer' ? 100 : 0
    } else {
      options[channel.key] = 0
    }
  }

  return options
}

function buttonPreset(name, text, bgcolor, actionId, optionOverrides, category) {
  return {
    type: 'button',
    category,
    name,
    style: {
      text,
      size: 'auto',
      color: 0xffffff,
      bgcolor,
    },
    steps: [
      {
        down: [{ actionId, options: optionOverrides }],
        up: [],
      },
    ],
    feedbacks: [],
  }
}

/** Builds the standard set of presets (Full Red/Green/Blue, whites, dimmer, blackout) for one action/fixture */
function buildFixturePresets(profile, actionId, extraOptions, fixtureName, idPrefix, category) {
  const presets = {}
  const base = { ...stateOptions(profile), ...extraOptions }
  const cctChannel = profile.channels.find((c) => c.type === 'kelvin')
  const dimmerKey = profile.channels.find((c) => c.key === 'dimmer') ? 'dimmerPercent' : undefined

  const withBase = (overrides) => ({ ...base, ...overrides })
  const full = (extra) => (dimmerKey ? { [dimmerKey]: 100, ...extra } : extra)

  if (hasRgb(profile)) {
    presets[`${idPrefix}_full_red`] = buttonPreset(
      'Full Red',
      `${fixtureName}\\nRED`,
      0xcc0000,
      actionId,
      withBase(full({ color: 0xff0000 })),
      category,
    )
    presets[`${idPrefix}_full_green`] = buttonPreset(
      'Full Green',
      `${fixtureName}\\nGREEN`,
      0x00aa00,
      actionId,
      withBase(full({ color: 0x00ff00 })),
      category,
    )
    presets[`${idPrefix}_full_blue`] = buttonPreset(
      'Full Blue',
      `${fixtureName}\\nBLUE`,
      0x0000cc,
      actionId,
      withBase(full({ color: 0x0000ff })),
      category,
    )
  }

  if (cctChannel) {
    const cctOn = cctChannel.overridesRgb ? { cctEnabled: true } : {}
    presets[`${idPrefix}_warm_white_3000k`] = buttonPreset(
      'Warm White 3000K',
      `${fixtureName}\\nWARM 3000K`,
      0x552200,
      actionId,
      withBase(full({ ...cctOn, cctKelvin: 3000 })),
      category,
    )
    presets[`${idPrefix}_cool_white_5600k`] = buttonPreset(
      'Cool White 5600K',
      `${fixtureName}\\nCOOL 5600K`,
      0x224488,
      actionId,
      withBase(full({ ...cctOn, cctKelvin: 5600 })),
      category,
    )
  }

  if (dimmerKey) {
    presets[`${idPrefix}_dimmer_100`] = buttonPreset(
      'Dimmer 100%',
      `${fixtureName}\\nFULL`,
      0x444444,
      actionId,
      withBase({ ...(hasRgb(profile) ? { color: 0xffffff } : {}), [dimmerKey]: 100 }),
      category,
    )
    presets[`${idPrefix}_blackout`] = buttonPreset(
      'Blackout',
      `${fixtureName}\\nBLACKOUT`,
      0x000000,
      actionId,
      withBase({ [dimmerKey]: 0 }),
      category,
    )
  }

  return presets
}

/** Start Rainbow / Start Sine Breathing / Stop Effect, for one fixture (or the Manual action) */
function buildFixtureEffectPresets(profile, startActionId, stopActionId, fixtureName, idPrefix, category) {
  const presets = {}
  const programs = supportedPrograms(profile)

  if (programs.some((p) => p.id === 'rainbow')) {
    presets[`${idPrefix}_start_rainbow`] = buttonPreset(
      'Start Rainbow',
      `${fixtureName}\\nRAINBOW`,
      0x8800cc,
      startActionId,
      effectStartOptions(profile, 'rainbow'),
      category,
    )
  }

  if (programs.some((p) => p.id === 'sineDimmer')) {
    presets[`${idPrefix}_start_breathing`] = buttonPreset(
      'Start Sine Breathing',
      `${fixtureName}\\nBREATHE`,
      0x006666,
      startActionId,
      effectStartOptions(profile, 'sineDimmer'),
      category,
    )
  }

  if (programs.some((p) => p.id === 'squareDimmer')) {
    presets[`${idPrefix}_start_blink`] = buttonPreset(
      'Start Hard Blink',
      `${fixtureName}\\nBLINK`,
      0x996600,
      startActionId,
      effectStartOptions(profile, 'squareDimmer'),
      category,
    )
  }

  if (programs.length > 0) {
    presets[`${idPrefix}_stop_effect`] = buttonPreset(
      'Stop Effect',
      `${fixtureName}\\nSTOP FX`,
      0x662222,
      stopActionId,
      {},
      category,
    )
  }

  return presets
}

/** Start Rainbow Chase / Start Breathing Chase / Stop Chase, across every fixture patched under this profile */
function buildChasePresets(profile) {
  const presets = {}
  const programs = supportedPrograms(profile)
  const category = `${profile.name} — Chase`
  const idPrefix = `${profile.id}_chase`

  if (programs.some((p) => p.id === 'rainbow')) {
    presets[`${idPrefix}_start_rainbow`] = buttonPreset(
      'Start Rainbow Chase',
      'RAINBOW\\nCHASE',
      0x8800cc,
      `${profile.id}_start_chase`,
      effectStartOptions(profile, 'rainbow', { phaseSpread: 1 }),
      category,
    )
  }

  if (programs.some((p) => p.id === 'sineDimmer')) {
    presets[`${idPrefix}_start_breathing`] = buttonPreset(
      'Start Breathing Chase',
      'BREATHE\\nCHASE',
      0x006666,
      `${profile.id}_start_chase`,
      effectStartOptions(profile, 'sineDimmer', { phaseSpread: 1 }),
      category,
    )
    presets[`${idPrefix}_start_breathing_random`] = buttonPreset(
      'Start Random Breathing Chase',
      'RANDOM\\nBREATHE',
      0x004444,
      `${profile.id}_start_chase`,
      effectStartOptions(profile, 'sineDimmer', { phaseSpread: 1, randomOrder: true }),
      category,
    )
  }

  if (programs.some((p) => p.id === 'squareDimmer')) {
    presets[`${idPrefix}_start_blink`] = buttonPreset(
      'Start Hard Blink Chase',
      'BLINK\\nCHASE',
      0x996600,
      `${profile.id}_start_chase`,
      effectStartOptions(profile, 'squareDimmer', { phaseSpread: 1 }),
      category,
    )
    presets[`${idPrefix}_start_blink_random`] = buttonPreset(
      'Start Random Blink Chase',
      'RANDOM\\nBLINK',
      0x664400,
      `${profile.id}_start_chase`,
      effectStartOptions(profile, 'squareDimmer', { phaseSpread: 1, randomOrder: true }),
      category,
    )
  }

  if (programs.length > 0) {
    presets[`${idPrefix}_stop`] = buttonPreset('Stop Chase', 'STOP\\nCHASE', 0x662222, `${profile.id}_stop_chase`, {}, category)
  }

  return presets
}

function buildProfilePresets(instance, profile) {
  let presets = {}
  const count = Math.min(Number(instance.config?.fixtureCount ?? 0), MAX_FIXTURES)
  const patchedIndices = []

  for (let i = 1; i <= count; i++) {
    const type = instance.config?.[`fixture${i}Type`]
    if (type && type !== profile.id) continue
    patchedIndices.push(i)
    const name = instance.config?.[`fixture${i}Name`] || `Unedited Fixture ${i}`
    const category = `${profile.name} — ${name}`
    const idPrefix = `${profile.id}_f${i}`
    presets = {
      ...presets,
      ...buildFixturePresets(profile, `${idPrefix}_set_state`, {}, name, idPrefix, category),
      ...buildFixtureEffectPresets(profile, `${idPrefix}_start_effect`, `${idPrefix}_stop_effect`, name, idPrefix, category),
    }
  }

  // nobody has patched this profile — skip its Manual/Chase/All sets entirely instead
  // of cluttering the presets panel with categories for a profile you're not using
  if (patchedIndices.length === 0) return presets

  // only useful with 2+ fixtures of this profile — sets every one of them at once
  if (patchedIndices.length > 1) {
    presets = {
      ...presets,
      ...buildFixturePresets(
        profile,
        `${profile.id}_all_set_state`,
        {},
        'All',
        `${profile.id}_all`,
        `${profile.name} — All`,
      ),
    }
  }

  // always available for this profile, for anyone not using the patch list for it
  presets = {
    ...presets,
    ...buildFixturePresets(
      profile,
      `${profile.id}_manual_set_state`,
      { universe: 0, startChannel: 1 },
      'Manual',
      `${profile.id}_manual`,
      `${profile.name} — Manual`,
    ),
  }

  presets = { ...presets, ...buildChasePresets(profile) }

  return presets
}

/**
 * @param {import('@companion-module/base').InstanceBase} instance reads `instance.config` for the patch list
 * @param {Array} registry fixtureRegistry
 */
export function buildPresetDefinitions(instance, registry) {
  let presets = {}
  for (const profile of registry) {
    presets = { ...presets, ...buildProfilePresets(instance, profile) }
  }
  presets.stop_all_effects = buttonPreset(
    'Stop All Effects',
    'STOP ALL\\nEFFECTS',
    0x990000,
    'stop_all_effects',
    {},
    'Effects',
  )
  presets.tap_tempo = buttonPreset('Tap Tempo', 'TAP\\nTEMPO', 0x336699, 'tap_tempo', {}, 'Effects')
  return presets
}
