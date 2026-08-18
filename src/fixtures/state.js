/**
 * Small, pure, profile-only helpers shared between src/actions.js and
 * src/effects/* — no Companion or instance knowledge here, just fixture data.
 */

export function findChannel(profile, key) {
  return profile.channels.find((c) => c.key === key)
}

export function hasRgb(profile) {
  return ['red', 'green', 'blue'].every((k) => findChannel(profile, k))
}

/** Channels not covered by the combined RGB color field */
export function otherChannels(profile) {
  const rgbKeys = new Set(hasRgb(profile) ? ['red', 'green', 'blue'] : [])
  return profile.channels.filter((c) => !rgbKeys.has(c.key))
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
