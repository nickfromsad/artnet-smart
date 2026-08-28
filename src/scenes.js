/**
 * "Scene" presets: one button press that drives every fixture group at once (front
 * wash dimmers + backlight spots + Astera pixel-tubes), built entirely on top of the
 * per-profile actions presets.js/actions.js already generate — Start Chase and Set
 * Full State (All) both resolve their fixture targets at call time from the instance's
 * patch list, so a scene just needs to name the right action id + options per profile,
 * no new engine mechanism.
 *
 * Not a general-purpose "macro" system — a short, curated table for one specific rig
 * shape (3x dual-white wash bars, 2x CCT backlight spots, Nx Astera Helios pixel-tubes).
 */

import { multiActionPreset, effectStartOptions, stateOptions, isProfilePatched } from './presets.js'

const DUAL_WHITE_ID = 'dual-white-dimmer'
const SPOT_ID = 'lupo-dayled-cct'
const ASTERA_ID = 'astera-helios-profile80'

function findProfile(registry, id) {
  return registry.find((p) => p.id === id)
}

/** stateOptions' baseline with any dimmer-bearing channel forced to 0 — "off", not "full" */
function offOptions(profile) {
  return { ...stateOptions(profile), dimmerPercent: 0 }
}

/** One {actionId, options} step for a scene, or undefined if its target profile has no patched fixtures */
function step(instance, registry, profileId, actionSuffix, buildOptions) {
  const profile = findProfile(registry, profileId)
  if (!profile || !isProfilePatched(instance, profile)) return undefined
  return { actionId: `${profileId}_${actionSuffix}`, options: buildOptions(profile) }
}

const SCENES = [
  {
    id: 'scene_warm_chill',
    name: 'Scene — Warm Chill',
    text: 'WARM\\nCHILL',
    bgcolor: 0x663311,
    buildSteps: (instance, registry) => [
      step(instance, registry, DUAL_WHITE_ID, 'all_set_state', (profile) => ({
        ...stateOptions(profile),
        coldWhitePercent: 20,
        warmWhitePercent: 70,
      })),
      step(instance, registry, SPOT_ID, 'all_set_state', (profile) => ({
        ...stateOptions(profile),
        cctKelvin: 2900,
        dimmerPercent: 40,
      })),
      step(instance, registry, ASTERA_ID, 'start_chase', (profile) =>
        effectStartOptions(profile, 'sineDimmer', {
          phaseSpread: 1,
          periodSeconds: 8,
          twoColorWave: true,
          color: 0xffaa33,
          backgroundColor: 0x000000,
          blankSpace: 0,
        }),
      ),
    ],
  },
  {
    id: 'scene_color_chase',
    name: 'Scene — Color Chase',
    text: 'COLOR\\nCHASE',
    bgcolor: 0x8800cc,
    buildSteps: (instance, registry) => [
      step(instance, registry, DUAL_WHITE_ID, 'all_set_state', (profile) => ({
        ...stateOptions(profile),
        coldWhitePercent: 10,
        warmWhitePercent: 10,
      })),
      step(instance, registry, SPOT_ID, 'all_set_state', (profile) => offOptions(profile)),
      step(instance, registry, ASTERA_ID, 'start_chase', (profile) =>
        effectStartOptions(profile, 'rainbow', { phaseSpread: 1, periodSeconds: 5, blankSpace: 40 }),
      ),
    ],
  },
  {
    id: 'scene_two_color_sweep',
    name: 'Scene — Two-Color Sweep',
    text: 'TWO-COLOR\\nSWEEP',
    bgcolor: 0x006666,
    buildSteps: (instance, registry) => [
      step(instance, registry, DUAL_WHITE_ID, 'all_set_state', (profile) => ({
        ...stateOptions(profile),
        coldWhitePercent: 10,
        warmWhitePercent: 10,
      })),
      step(instance, registry, SPOT_ID, 'all_set_state', (profile) => offOptions(profile)),
      step(instance, registry, ASTERA_ID, 'start_chase', (profile) =>
        effectStartOptions(profile, 'sineDimmer', {
          phaseSpread: 1,
          periodSeconds: 5,
          twoColorWave: true,
          color: 0x00ffff,
          backgroundColor: 0xff00ff,
          blankSpace: 30,
        }),
      ),
    ],
  },
  {
    id: 'scene_party_blink',
    name: 'Scene — Party Blink',
    text: 'PARTY\\nBLINK',
    bgcolor: 0x996600,
    buildSteps: (instance, registry) => [
      step(instance, registry, DUAL_WHITE_ID, 'all_set_state', (profile) => ({
        ...stateOptions(profile),
        coldWhitePercent: 80,
        warmWhitePercent: 80,
      })),
      step(instance, registry, SPOT_ID, 'all_set_state', (profile) => ({
        ...stateOptions(profile),
        cctKelvin: 4000,
        dimmerPercent: 80,
      })),
      step(instance, registry, ASTERA_ID, 'start_chase', (profile) =>
        effectStartOptions(profile, 'squareDimmer', { phaseSpread: 1, fadeWidth: 20, followBpm: true }),
      ),
    ],
  },
]

/**
 * Every fixture group off + every effect stopped, in one press. Unlike the scenes
 * above, this one always appears — even with nothing patched yet — since
 * stop_all_effects has no fixture dependency and this doubles as a panic button, same
 * as the existing bare "Stop All Effects" preset.
 */
function buildBlackoutScene(instance, registry) {
  const steps = [
    { actionId: 'stop_all_effects', options: {} },
    ...[DUAL_WHITE_ID, SPOT_ID, ASTERA_ID]
      .map((id) => step(instance, registry, id, 'all_set_state', (profile) => offOptions(profile)))
      .filter(Boolean),
  ]
  return multiActionPreset('Scene — Blackout / Stop All', 'BLACKOUT\\nSTOP ALL', 0x990000, steps, 'Scenes')
}

/** @param {import('@companion-module/base').InstanceBase} instance @param {Array} registry fixtureRegistry */
export function buildScenePresets(instance, registry) {
  const presets = {}

  for (const scene of SCENES) {
    const steps = scene.buildSteps(instance, registry).filter(Boolean)
    if (steps.length === 0) continue
    presets[scene.id] = multiActionPreset(scene.name, scene.text, scene.bgcolor, steps, 'Scenes')
  }

  presets.scene_blackout = buildBlackoutScene(instance, registry)

  return presets
}
