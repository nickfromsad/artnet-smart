/**
 * Turns fixture profile data (src/fixtures/*) into Companion action
 * definitions. This file has no fixture-specific logic — everything about
 * "what channels does this fixture have" comes from the profile object, so
 * adding a new fixture to the registry is enough to get its actions.
 *
 * One "Set Full State" action is generated per fixture patched in the
 * instance config (e.g. "Tube 3 — Set Full State"), with that fixture's
 * Universe/Start Channel baked in — no Fixture dropdown, no Universe/Start
 * Channel fields to fill in, nothing to accidentally leave pointed at the
 * wrong fixture. A "Manual" variant (with editable Universe/Start Channel)
 * and a raw per-channel fallback are always available too.
 */

import { MAX_FIXTURES } from './config.js'
import { findChannels, hasRgb, rgbGroups, groupedOtherChannels, overridesToValues, pixelCount } from './fixtures/state.js'
import { EFFECT_PROGRAMS } from './effects/programs.js'

const STROBE_MODE_CHOICES = [
  { id: 'off', label: 'Off' },
  { id: 'randomFast', label: 'Random Fast' },
  { id: 'randomMedium', label: 'Random Medium' },
  { id: 'randomSlow', label: 'Random Slow' },
  { id: 'variable', label: 'Variable Rate (Hz)' },
]

function strobeModeField() {
  return { id: 'strobeMode', type: 'dropdown', label: 'Strobe', choices: STROBE_MODE_CHOICES, default: 'off' }
}

function strobeHzField(channel) {
  return {
    id: 'strobeHz',
    type: 'number',
    label: `Strobe Rate (${channel.hzMin}-${channel.hzMax} Hz)`,
    min: channel.hzMin,
    max: channel.hzMax,
    default: channel.hzMin,
    step: 0.1,
    isVisibleExpression: "$(options:strobeMode) == 'variable'",
  }
}

function strobeRawValue(channel, options) {
  switch (options.strobeMode) {
    case 'randomFast':
      return channel.randomFastRaw
    case 'randomMedium':
      return channel.randomMediumRaw
    case 'randomSlow':
      return channel.randomSlowRaw
    case 'variable':
      return channel.hzToRaw(Number(options.strobeHz))
    default:
      return channel.offRaw
  }
}

function decodeColor(colorNumber) {
  return {
    r: (colorNumber >> 16) & 0xff,
    g: (colorNumber >> 8) & 0xff,
    b: colorNumber & 0xff,
  }
}

function sendFixtureBytes(instance, profile, universe, startChannel, overrides) {
  if (startChannel < 1 || startChannel + profile.footprint - 1 > 512) {
    instance.log?.(
      'warn',
      `${profile.name}: start channel ${startChannel} + footprint ${profile.footprint} exceeds universe size (512), values will be truncated`,
    )
  }

  instance.sender.setChannels(universe, startChannel, overridesToValues(profile.footprint, overrides))
}

/** The Color/CCT/Dimmer/Index/Strobe fields shared by every "Set Full State" action, regardless of fixture */
function stateFields(profile) {
  const fields = []
  const cctChannel = profile.channels.find((c) => c.type === 'kelvin')
  const strobeChannel = profile.channels.find((c) => c.type === 'strobe')

  if (hasRgb(profile)) {
    fields.push({ id: 'color', type: 'colorpicker', label: 'Color (RGB)', default: 0x000000, returnType: 'number' })
  }

  if (cctChannel) {
    if (cctChannel.overridesRgb) {
      fields.push({
        id: 'cctEnabled',
        type: 'checkbox',
        label: `Set ${cctChannel.label} (overrides RGB on the fixture)`,
        default: false,
      })
    }
    fields.push({
      id: 'cctKelvin',
      type: 'number',
      label: 'Kelvin',
      min: cctChannel.kelvinMin,
      max: cctChannel.kelvinMax,
      default: cctChannel.kelvinMin,
      step: 10,
      // fixtures where CCT overrides RGB expose it as opt-in (hidden until the
      // checkbox is on); fixtures with no RGB to override just always apply it
      ...(cctChannel.overridesRgb ? { isVisibleExpression: '$(options:cctEnabled)' } : {}),
    })
  }

  if (strobeChannel) {
    fields.push(strobeModeField())
    fields.push(strobeHzField(strobeChannel))
  }

  for (const group of groupedOtherChannels(profile)) {
    const channel = group.channel
    if (channel.type === 'kelvin' || channel.type === 'strobe') continue
    if (channel.type === 'percent8') {
      fields.push({
        id: `${channel.key}Percent`,
        type: 'number',
        label: `${channel.label} (%)`,
        min: 0,
        max: 100,
        default: channel.key === 'dimmer' ? 100 : 0,
        step: 1,
      })
    } else {
      fields.push({
        id: channel.key,
        type: 'number',
        label: channel.note ? `${channel.label} (0-255; ${channel.note})` : `${channel.label} (0-255)`,
        min: 0,
        max: 255,
        default: 0,
        step: 1,
      })
    }
  }

  return fields
}

/** Turns a Set Full State action's option values into {offset, value} overrides for sendFixtureBytes */
function stateOverrides(profile, options) {
  const overrides = []
  const cctChannel = profile.channels.find((c) => c.type === 'kelvin')
  const strobeChannel = profile.channels.find((c) => c.type === 'strobe')

  if (hasRgb(profile)) {
    const { r, g, b } = decodeColor(Number(options.color))
    for (const group of rgbGroups(profile)) {
      overrides.push({ offset: group.red.offset, value: r })
      overrides.push({ offset: group.green.offset, value: g })
      overrides.push({ offset: group.blue.offset, value: b })
    }
  }

  if (cctChannel) {
    const value = cctChannel.overridesRgb
      ? options.cctEnabled
        ? cctChannel.kelvinToRaw(Number(options.cctKelvin))
        : cctChannel.offRaw
      : cctChannel.kelvinToRaw(Number(options.cctKelvin))
    for (const channel of profile.channels.filter((c) => c.type === 'kelvin')) {
      overrides.push({ offset: channel.offset, value })
    }
  }

  if (strobeChannel) {
    overrides.push({ offset: strobeChannel.offset, value: strobeRawValue(strobeChannel, options) })
  }

  for (const group of groupedOtherChannels(profile)) {
    const channel = group.channel
    if (channel.type === 'kelvin' || channel.type === 'strobe') continue
    const value =
      channel.type === 'percent8'
        ? Math.round((Number(options[`${channel.key}Percent`]) * 255) / 100)
        : Number(options[channel.key])
    for (const c of group.channels) {
      overrides.push({ offset: c.offset, value })
    }
  }

  return overrides
}

/** One action per patched fixture: Universe/Start Channel are baked in from the config, not options */
function buildFixtureStateAction(instance, profile, fixtureIndex, fixtureName) {
  return {
    name: `${fixtureName} — Set Full State`,
    options: stateFields(profile),
    callback: async (event) => {
      const universe = Number(instance.config?.[`fixture${fixtureIndex}Universe`] ?? 0)
      const startChannel = Number(instance.config?.[`fixture${fixtureIndex}Start`] ?? 1)
      // a still-running effect (e.g. Rainbow) would otherwise keep overwriting this
      // right back on its next tick, ~40ms later — same reasoning as switching effects
      stopAllPrograms(instance, `${profile.id}_f${fixtureIndex}`)
      sendFixtureBytes(instance, profile, universe, startChannel, stateOverrides(profile, event.options))
    },
  }
}

/** For anything not in the patch list: same controls, plus editable Universe/Start Channel */
function buildManualStateAction(instance, profile) {
  return {
    name: `${profile.name} — Set Full State (Manual)`,
    options: [
      { id: 'universe', type: 'number', label: 'Universe (0-32767)', min: 0, max: 32767, default: 0, step: 1 },
      {
        id: 'startChannel',
        type: 'number',
        label: `Start Channel (1-${513 - profile.footprint})`,
        min: 1,
        max: 513 - profile.footprint,
        default: 1,
        step: 1,
      },
      ...stateFields(profile),
    ],
    callback: async (event) => {
      const { universe, startChannel } = event.options
      sendFixtureBytes(instance, profile, Number(universe), Number(startChannel), stateOverrides(profile, event.options))
    },
  }
}

/** Sets every currently-patched fixture of this profile to the same values in one press */
function buildAllStateAction(instance, profile) {
  return {
    name: `${profile.name} — Set Full State (All)`,
    options: stateFields(profile),
    callback: async (event) => {
      const overrides = stateOverrides(profile, event.options)
      const fixtureIndices = patchedFixtureIndices(instance, profile)
      // stop the profile's chase and every targeted fixture's individual effect first,
      // for the same reason as the per-fixture action above
      stopAllPrograms(instance, `${profile.id}_chase`)
      for (const i of fixtureIndices) {
        stopAllPrograms(instance, `${profile.id}_f${i}`)
      }
      for (const i of fixtureIndices) {
        const universe = Number(instance.config?.[`fixture${i}Universe`] ?? 0)
        const startChannel = Number(instance.config?.[`fixture${i}Start`] ?? 1)
        sendFixtureBytes(instance, profile, universe, startChannel, overrides)
      }
    },
  }
}

function supportedPrograms(profile) {
  return Object.values(EFFECT_PROGRAMS).filter((p) => p.supports(profile))
}

function patchedFixtureIndices(instance, profile) {
  const count = Math.min(Number(instance.config?.fixtureCount ?? 0), MAX_FIXTURES)
  const indices = []
  for (let i = 1; i <= count; i++) {
    const type = instance.config?.[`fixture${i}Type`]
    if (type && type !== profile.id) continue
    indices.push(i)
  }
  return indices
}

/** Fields shared by every "Start Effect" / "Start Chase" action */
function effectStartFields(profile, { includePhaseSpread }) {
  const programs = supportedPrograms(profile)
  const fields = [
    {
      id: 'program',
      type: 'dropdown',
      label: 'Effect',
      choices: programs.map((p) => ({ id: p.id, label: p.label })),
      default: programs[0]?.id,
    },
    {
      id: 'periodSeconds',
      type: 'number',
      label: 'Speed (seconds per cycle)',
      min: 0.2,
      max: 60,
      default: 4,
      step: 0.1,
      isVisibleExpression: '$(options:followBpm) == false',
    },
    {
      id: 'followBpm',
      type: 'checkbox',
      label: 'Follow BPM (Tap Tempo) instead of a fixed Speed — updates live, even while already running, as you keep tapping',
      default: false,
    },
    {
      id: 'beatsPerCycle',
      type: 'number',
      label: 'Beats per Cycle (how many taps make up one full cycle)',
      min: 1,
      max: 32,
      default: 1,
      step: 1,
      isVisibleExpression: '$(options:followBpm)',
    },
  ]

  if (includePhaseSpread) {
    fields.push({
      id: 'phaseSpread',
      type: 'number',
      label: 'Phase Spread (0 = synced, 1 = one full cycle spread across all fixtures)',
      min: 0,
      max: 4,
      default: 1,
      step: 0.1,
    })
    fields.push({
      id: 'reverseDirection',
      type: 'checkbox',
      label: 'Reverse Direction (sweep runs the other way down the line)',
      default: false,
    })
    fields.push({
      id: 'randomOrder',
      type: 'checkbox',
      label: 'Random Order (shuffle which fixture leads the sweep — reshuffled every lap while it runs, not just once at Start)',
      default: false,
    })
  }

  // Only fixtures with multiple repeated pixels (e.g. Astera Helios Profile 80) get
  // this — same idea as Phase Spread above, but rippling across one fixture's own
  // pixels instead of across separate fixtures. Start Effect only: on a Chase this is
  // derived automatically from Phase Spread and the fixture count (see
  // buildChaseStartAction) so the cross-fixture sweep and each fixture's own pixel
  // ripple form one continuous flattened wave — showing this field there too would
  // just be silently overridden.
  const pixels = pixelCount(profile)
  if (pixels > 1 && !includePhaseSpread) {
    fields.push({
      id: 'pixelPhaseSpread',
      type: 'number',
      label: `Pixel Phase Spread (0 = synced, 1 = one full cycle spread across this fixture's own ${pixels} pixels)`,
      min: 0,
      max: 4,
      default: 1,
      step: 0.1,
    })
  }

  // A program only ever touches one channel group (RGB or Dimmer) per tick — without a
  // one-shot baseline for the group it doesn't own, the fixture could end up looking
  // off (Dimmer stuck at 0) or black (RGB never set) while the effect runs.
  const rgbPrograms = programs.filter((p) => p.touches === 'rgb')
  const dimmerPrograms = programs.filter((p) => p.touches === 'dimmer')

  if (rgbPrograms.length > 0) {
    fields.push({
      id: 'dimmerPercent',
      type: 'number',
      label: 'Dimmer while running (%)',
      min: 0,
      max: 100,
      default: 100,
      step: 1,
      isVisibleExpression: anyProgramExpression(rgbPrograms),
    })
  }

  if (dimmerPrograms.length > 0) {
    const dimmerVisible = anyProgramExpression(dimmerPrograms)
    // only meaningful on fixtures that actually have RGB — a Dimmer-only fixture (or
    // one whose only color control is CCT, like the Lupo Dayled) has nothing for this
    // field to set
    if (hasRgb(profile)) {
      fields.push({
        id: 'color',
        type: 'colorpicker',
        label: 'Color while running',
        default: 0xffffff,
        returnType: 'number',
        isVisibleExpression: dimmerVisible,
      })
    }
    fields.push({
      id: 'dimmerMin',
      type: 'number',
      label: 'Dimmer Min (%)',
      min: 0,
      max: 100,
      default: 0,
      step: 1,
      isVisibleExpression: dimmerVisible,
    })
    fields.push({
      id: 'dimmerMax',
      type: 'number',
      label: 'Dimmer Max (%)',
      min: 0,
      max: 100,
      default: 100,
      step: 1,
      isVisibleExpression: dimmerVisible,
    })
  }

  if (programs.some((p) => p.id === 'squareDimmer')) {
    fields.push({
      id: 'dutyCycle',
      type: 'number',
      label: 'On Time (% of each cycle spent fully on)',
      min: 1,
      max: 99,
      default: 50,
      step: 1,
      isVisibleExpression: "$(options:program) == 'squareDimmer'",
    })
  }

  return fields
}

/** Companion expression matching if `program` is any of the given programs' ids */
function anyProgramExpression(programs) {
  return programs.map((p) => `$(options:program) == '${p.id}'`).join(' || ')
}

/** The one-shot overrides for the channel(s) the selected program doesn't own, sent once at start */
function effectOneShotOverrides(profile, options) {
  const program = EFFECT_PROGRAMS[options.program]
  if (!program) return []

  const overrides = []

  // On fixtures where CCT overrides RGB at the firmware level (e.g. Astera), a
  // leftover non-zero CCT from a previous "Set Full State" would keep showing that
  // white balance instead of the effect — every effect here relies on RGB being
  // visible (continuously for Rainbow, or via the one-shot Color baseline for the
  // Dimmer-only programs). Reset CCT every time an effect starts, but only on fixtures
  // where that's actually meaningful — a fixture like the Lupo Dayled has no RGB to
  // reveal, so resetting its CCT would just needlessly change its color temperature
  // every time an unrelated Dimmer effect starts.
  const cctChannels = profile.channels.filter((c) => c.type === 'kelvin')
  if (cctChannels.length > 0 && cctChannels[0].overridesRgb) {
    for (const channel of cctChannels) {
      overrides.push({ offset: channel.offset, value: channel.offRaw })
    }
  }

  if (program.touches === 'rgb') {
    const dimmerChannels = findChannels(profile, 'dimmer')
    if (dimmerChannels.length > 0) {
      const percent = Number(options.dimmerPercent)
      const raw = Math.round((percent * 255) / 100)
      for (const channel of dimmerChannels) {
        overrides.push({ offset: channel.offset, value: raw })
      }
    }
  }

  if (program.touches === 'dimmer') {
    if (hasRgb(profile)) {
      const { r, g, b } = decodeColor(Number(options.color))
      for (const group of rgbGroups(profile)) {
        overrides.push({ offset: group.red.offset, value: r })
        overrides.push({ offset: group.green.offset, value: g })
        overrides.push({ offset: group.blue.offset, value: b })
      }
    }
  }

  return overrides
}

function effectParams(profile, options) {
  const program = EFFECT_PROGRAMS[options.program]
  const params = {}
  if (pixelCount(profile) > 1) params.pixelPhaseSpread = Number(options.pixelPhaseSpread ?? 0)
  if (program?.touches === 'dimmer') {
    params.min = Number(options.dimmerMin)
    params.max = Number(options.dimmerMax)
    if (program.id === 'squareDimmer') params.dutyCycle = Number(options.dutyCycle ?? 50)
  }
  return params
}

/** Start Effect for one specific patched fixture — Universe/Start Channel baked in, like Set Full State */
function buildFixtureStartEffectAction(instance, profile, fixtureIndex, fixtureName) {
  return {
    name: `${fixtureName} — Start Effect`,
    options: effectStartFields(profile, { includePhaseSpread: false }),
    callback: async (event) => {
      const options = event.options
      const program = EFFECT_PROGRAMS[options.program]
      if (!program) return

      const universe = Number(instance.config?.[`fixture${fixtureIndex}Universe`] ?? 0)
      const startChannel = Number(instance.config?.[`fixture${fixtureIndex}Start`] ?? 1)
      const oneShot = effectOneShotOverrides(profile, options)
      if (oneShot.length > 0) sendFixtureBytes(instance, profile, universe, startChannel, oneShot)

      // starting a new effect replaces whatever was running on this fixture before — a
      // still-running old program (e.g. Rainbow) would otherwise keep overwriting its
      // channel every tick, right after the new one's one-shot baseline sets it, and
      // the old effect would silently keep showing through
      stopAllPrograms(instance, `${profile.id}_f${fixtureIndex}`)

      instance.effects.start(`${profile.id}_f${fixtureIndex}_${program.id}`, {
        profile,
        program,
        fixtureIndices: [fixtureIndex],
        periodSeconds: Number(options.periodSeconds),
        followBpm: !!options.followBpm,
        beatsPerCycle: Number(options.beatsPerCycle ?? 1),
        params: effectParams(profile, options),
      })
    },
  }
}

/** Stops every possible program under this id prefix (e.g. every program that could be running on one fixture, or on a chase) */
function stopAllPrograms(instance, idPrefix) {
  for (const programId of Object.keys(EFFECT_PROGRAMS)) {
    instance.effects.stop(`${idPrefix}_${programId}`)
  }
}

function buildFixtureStopEffectAction(instance, profile, fixtureIndex, fixtureName) {
  return {
    name: `${fixtureName} — Stop Effect`,
    options: [],
    callback: async () => {
      stopAllPrograms(instance, `${profile.id}_f${fixtureIndex}`)
    },
  }
}

/** Runs one program across every currently-patched fixture of this profile, phase-offset so it "rolls" */
function buildChaseStartAction(instance, profile) {
  return {
    name: `${profile.name} — Start Chase`,
    options: effectStartFields(profile, { includePhaseSpread: true }),
    callback: async (event) => {
      const options = event.options
      const program = EFFECT_PROGRAMS[options.program]
      if (!program) return

      const fixtureIndices = patchedFixtureIndices(instance, profile)
      if (fixtureIndices.length === 0) return

      const oneShot = effectOneShotOverrides(profile, options)
      if (oneShot.length > 0) {
        for (const i of fixtureIndices) {
          const universe = Number(instance.config?.[`fixture${i}Universe`] ?? 0)
          const startChannel = Number(instance.config?.[`fixture${i}Start`] ?? 1)
          sendFixtureBytes(instance, profile, universe, startChannel, oneShot)
        }
      }

      // same reasoning as the per-fixture Start Effect above: stop whatever chase
      // program was previously running here, and any per-fixture effect running
      // individually on one of these fixtures — otherwise it would keep overwriting
      // its channel after this chase's one-shot baseline sets it
      stopAllPrograms(instance, `${profile.id}_chase`)
      for (const i of fixtureIndices) {
        stopAllPrograms(instance, `${profile.id}_f${i}`)
      }

      // negative phaseSpread reverses which direction the sweep travels — the engine's
      // phase math already wraps negative offsets correctly, no engine changes needed
      const phaseSpread = Number(options.phaseSpread ?? 1) * (options.reverseDirection ? -1 : 1)

      const params = effectParams(profile, options)
      // Flatten "fixtures x their own pixels" into one continuous line: dividing the
      // same Phase Spread by how many fixtures are in this chase gives each fixture's
      // own pixels exactly the right slice of the cycle to continue where the previous
      // fixture's last pixel left off, instead of each fixture separately re-rippling
      // through its own full cycle. See HANDOFF.md for the derivation.
      if (pixelCount(profile) > 1) params.pixelPhaseSpread = phaseSpread / fixtureIndices.length

      // shuffling itself (including reshuffling every lap when Random Order is on)
      // is the engine's job, not this callback's — it needs to keep reshuffling for as
      // long as the effect keeps running, well after this callback has returned
      instance.effects.start(`${profile.id}_chase_${program.id}`, {
        profile,
        program,
        fixtureIndices,
        periodSeconds: Number(options.periodSeconds),
        phaseSpread,
        randomOrder: !!options.randomOrder,
        followBpm: !!options.followBpm,
        beatsPerCycle: Number(options.beatsPerCycle ?? 1),
        params,
      })
    },
  }
}

function buildChaseStopAction(instance, profile) {
  return {
    name: `${profile.name} — Stop Chase`,
    options: [],
    callback: async () => {
      for (const programId of Object.keys(EFFECT_PROGRAMS)) {
        instance.effects.stop(`${profile.id}_chase_${programId}`)
      }
    },
  }
}

function buildStopAllEffectsAction(instance) {
  return {
    name: 'Effects — Stop All',
    options: [],
    callback: async () => {
      instance.effects.stopAll()
    },
  }
}

/**
 * Records one tap and publishes the resulting BPM/seconds-per-beat as Companion
 * variables (`bpm`, `beat_seconds`) — reference `$(<your connection name>:beat_seconds)`
 * as an expression in any effect's Speed field instead of typing a fixed number.
 */
function buildTapTempoAction(instance) {
  return {
    name: 'Tap Tempo',
    options: [],
    callback: async () => {
      const result = instance.tapTempo.tap()
      if (!result) return // first tap only — nothing to average yet
      instance.setVariableValues({
        bpm: Math.round(result.bpm * 10) / 10,
        beat_seconds: Math.round(result.beatSeconds * 1000) / 1000,
      })
    },
  }
}

function buildRawFallbackAction(instance) {
  return {
    name: 'Raw — Set DMX Channel',
    options: [
      { id: 'universe', type: 'number', label: 'Universe (0-32767)', min: 0, max: 32767, default: 0, step: 1 },
      { id: 'channel', type: 'number', label: 'Channel (1-512)', min: 1, max: 512, default: 1, step: 1 },
      { id: 'value', type: 'number', label: 'Value (0-255)', min: 0, max: 255, default: 0, step: 1 },
    ],
    callback: async (event) => {
      const { universe, channel, value } = event.options
      instance.sender.setChannels(Number(universe), Number(channel), [Number(value)])
    },
  }
}

/**
 * @param {import('@companion-module/base').InstanceBase} instance must have `instance.sender` (ArtnetSender) and `instance.config`
 * @param {Array} registry fixtureRegistry
 */
export function buildActionDefinitions(instance, registry) {
  const actions = {}

  for (const profile of registry) {
    const patchedIndices = patchedFixtureIndices(instance, profile)
    // nobody has patched this profile — don't clutter Browse Actions with its Manual/Chase actions either
    if (patchedIndices.length === 0) continue

    const hasEffects = supportedPrograms(profile).length > 0

    for (const i of patchedIndices) {
      const name = instance.config?.[`fixture${i}Name`] || `Unedited Fixture ${i}`
      actions[`${profile.id}_f${i}_set_state`] = buildFixtureStateAction(instance, profile, i, name)

      if (hasEffects) {
        actions[`${profile.id}_f${i}_start_effect`] = buildFixtureStartEffectAction(instance, profile, i, name)
        actions[`${profile.id}_f${i}_stop_effect`] = buildFixtureStopEffectAction(instance, profile, i, name)
      }
    }

    actions[`${profile.id}_manual_set_state`] = buildManualStateAction(instance, profile)

    // only useful with 2+ fixtures of this profile — with just one it's identical to that fixture's own action
    if (patchedIndices.length > 1) {
      actions[`${profile.id}_all_set_state`] = buildAllStateAction(instance, profile)
    }

    if (hasEffects) {
      actions[`${profile.id}_start_chase`] = buildChaseStartAction(instance, profile)
      actions[`${profile.id}_stop_chase`] = buildChaseStopAction(instance, profile)
    }
  }

  actions.raw_set_channel = buildRawFallbackAction(instance)
  actions.stop_all_effects = buildStopAllEffectsAction(instance)
  actions.tap_tempo = buildTapTempoAction(instance)

  return actions
}
