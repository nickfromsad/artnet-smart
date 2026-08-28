/**
 * Generic dual-white dimmer bar: two independent raw intensity channels, one per
 * white temperature, with no combined Dimmer/CCT abstraction (unlike lupo-dayled-cct,
 * which exposes a single Dimmer + one Kelvin value). Matches fixtures wired as two
 * separate CW/WW channels straight off the desk.
 *
 *   ch1 Cold White  0-255 -> 0-100%
 *   ch2 Warm White  0-255 -> 0-100%
 */

export const dualWhiteDimmer = {
  id: 'dual-white-dimmer',
  manufacturer: 'Generic',
  name: 'Dual White Dimmer (CW/WW)', // kept short on purpose — see astera-helios-profile7.js
  footprint: 2,
  channels: [
    { key: 'coldWhite', label: 'Cold White', offset: 0, type: 'percent8' },
    { key: 'warmWhite', label: 'Warm White', offset: 1, type: 'percent8' },
  ],
}
