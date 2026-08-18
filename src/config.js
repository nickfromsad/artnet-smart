import { Regex } from '@companion-module/base'

/**
 * Upper bound on how many fixtures the patch list can hold. Companion's config
 * fields are static (not a dynamically-growable list), so we declare this many
 * up front and hide the unused ones via isVisible. Raise this if you outgrow it.
 */
export const MAX_FIXTURES = 16

function footprintForType(registry, typeId) {
  return (registry.find((p) => p.id === typeId) ?? registry[0])?.footprint ?? 1
}

function fixturePatchFields(registry, index, defaultStart) {
  const typeChoices = registry.map((p) => ({ id: p.id, label: p.name }))
  // NOTE: must be a string expression, not an `isVisible` function — functions get
  // serialized via `.toString()` and lose any closed-over variables (like `index`
  // here), so they silently fail to compile and the field never shows.
  const isVisibleExpression = `$(options:fixtureCount) >= ${index}`

  return [
    {
      id: `fixture${index}Header`,
      type: 'static-text',
      label: `— Fixture ${index} —`,
      value: '',
      isVisibleExpression,
    },
    {
      id: `fixture${index}Name`,
      type: 'textinput',
      label: 'Name',
      width: 4,
      // generic on purpose — matches the same fallback actions.js/presets.js use when
      // this field is left blank, and doesn't assume any particular brand (this used
      // to default to "Helios N", a leftover from when Astera Helios was the only
      // fixture type; now that there are others, that default was actively wrong for
      // anything else you patched). "Unedited" makes it obvious at a glance, in the
      // action/preset names themselves, that you haven't named this one yet.
      default: `Unedited Fixture ${index}`,
      isVisibleExpression,
    },
    {
      id: `fixture${index}Type`,
      type: 'dropdown',
      label: 'Fixture Type',
      width: 4,
      choices: typeChoices,
      default: typeChoices[0]?.id,
      isVisibleExpression,
    },
    {
      id: `fixture${index}Universe`,
      type: 'number',
      label: 'Universe',
      width: 2,
      min: 0,
      max: 32767,
      default: 0,
      isVisibleExpression,
    },
    {
      id: `fixture${index}Start`,
      type: 'number',
      label: 'Start Ch.',
      width: 2,
      min: 1,
      max: 512,
      default: defaultStart,
      isVisibleExpression,
    },
  ]
}

/**
 * @param {Array} fixtureRegistry
 * @param {Object} [savedConfig] the instance's last-saved config — used to make a new
 *   fixture row's default Start Channel continue where the previous *real* fixture
 *   ends (using its actual saved type's footprint), instead of a blind index*6 formula
 *   that ignores what's actually patched before it or which profile it uses.
 */
export function getConfigFields(fixtureRegistry, savedConfig = {}) {
  const fields = [
    {
      id: 'host',
      type: 'textinput',
      label: 'Target IP',
      width: 6,
      default: '255.255.255.255',
      regex: Regex.IP,
      tooltip: 'Use 255.255.255.255 for broadcast, or the Art-Net node/fixture IP for unicast.',
    },
    {
      id: 'port',
      type: 'number',
      label: 'Port',
      width: 3,
      default: 6454,
      min: 1,
      max: 65535,
    },
    {
      id: 'broadcast',
      type: 'checkbox',
      label: 'Enable UDP broadcast',
      width: 3,
      default: true,
      tooltip: 'Turn on if Target IP is a broadcast address (e.g. 255.255.255.255 or x.x.x.255).',
    },
    {
      id: 'refreshIntervalMs',
      type: 'number',
      label: 'Refresh Interval (ms, 0 = off)',
      width: 4,
      default: 1000,
      min: 0,
      max: 60000,
      tooltip: 'Periodically re-sends the last known state of every universe, in case a packet is missed.',
    },
    {
      id: 'fixturePatchHeader',
      type: 'static-text',
      label: 'Fixture Patch List',
      width: 12,
      value:
        'Patch each physical fixture once here — name it, pick its type, and set where it starts in DMX. ' +
        'Actions and presets then let you pick a fixture by name instead of typing Universe/Start Channel every time.',
    },
    {
      id: 'fixtureCount',
      type: 'number',
      label: 'Number of Fixtures',
      width: 4,
      min: 0,
      max: MAX_FIXTURES,
      default: 8,
    },
  ]

  // Chains each fixture's default Start Channel to right after the previous one's real
  // end (its saved-or-default start + its saved-or-default type's real footprint), so
  // e.g. a Profile 14 fixture (7ch) is correctly followed by a default 7 channels
  // later, not a blind assumption that every fixture is Profile 7's 6 channels.
  let nextStart = 1
  for (let i = 1; i <= MAX_FIXTURES; i++) {
    const defaultStart = nextStart
    fields.push(...fixturePatchFields(fixtureRegistry, i, defaultStart))

    const effectiveStart = savedConfig[`fixture${i}Start`] ?? defaultStart
    const effectiveFootprint = footprintForType(fixtureRegistry, savedConfig[`fixture${i}Type`])
    nextStart = effectiveStart + effectiveFootprint
  }

  return fields
}
