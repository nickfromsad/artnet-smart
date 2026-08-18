/**
 * Generic single-channel dimmer: any fixture (or dimmer pack) whose only DMX control
 * is a single 0-255 intensity channel.
 *
 *   ch1 Dimmer  0-255 -> 0-100%
 */

export const genericDimmer = {
  id: 'generic-dimmer',
  manufacturer: 'Generic',
  name: 'Generic Dimmer', // kept short on purpose — see astera-helios-profile7.js
  footprint: 1,
  channels: [{ key: 'dimmer', label: 'Dimmer', offset: 0, type: 'percent8' }],
}
