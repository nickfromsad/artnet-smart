/**
 * Small, pure, profile-only helpers shared between src/actions.js and
 * src/effects/* — no Companion or instance knowledge here, just fixture data.
 */

export function findChannel(profile, key) {
  return profile.channels.find((c) => c.key === key)
}

/** Every channel sharing this key — multi-pixel fixtures (e.g. Astera's per-pixel
 *  modes) repeat the same key once per pixel so one Companion field can fan its value
 *  out to all of them, instead of exposing N near-identical fields. */
export function findChannels(profile, key) {
  return profile.channels.filter((c) => c.key === key)
}

export function hasRgb(profile) {
  return ['red', 'green', 'blue'].every((k) => findChannel(profile, k))
}

/** One {red, green, blue} triple per RGB "pixel" on this fixture, paired up in
 *  declaration order — a single-pixel fixture (Profile 7/14, etc.) has exactly one. */
export function rgbGroups(profile) {
  const reds = findChannels(profile, 'red')
  const greens = findChannels(profile, 'green')
  const blues = findChannels(profile, 'blue')
  return reds.map((red, i) => ({ red, green: greens[i], blue: blues[i] }))
}

/** Channels not covered by the combined RGB color field */
export function otherChannels(profile) {
  const rgbKeys = new Set(hasRgb(profile) ? ['red', 'green', 'blue'] : [])
  return profile.channels.filter((c) => !rgbKeys.has(c.key))
}

/**
 * otherChannels grouped by key, in first-seen order — a multi-pixel fixture repeats
 * the same key (e.g. 'dimmer', 'indexColor') once per pixel, and this collapses each
 * repeated key into one group so callers generate a single field that fans its value
 * out to every channel in `channels`, instead of one duplicate-id field per pixel.
 */
export function groupedOtherChannels(profile) {
  const groups = new Map()
  for (const channel of otherChannels(profile)) {
    if (!groups.has(channel.key)) groups.set(channel.key, [])
    groups.get(channel.key).push(channel)
  }
  return [...groups.values()].map((channels) => ({ channel: channels[0], channels }))
}

/**
 * Turns a sparse list of {offset, value} overrides into a values array sized to the
 * fixture's footprint, with untouched offsets left as `undefined` — which
 * ArtnetSender#setChannels/#mergeChannels treat as "leave this channel alone".
 */
export function overridesToValues(footprint, overrides) {
  const values = new Array(footprint)
  for (const { offset, value } of overrides) {
    values[offset] = value & 0xff
  }
  return values
}
