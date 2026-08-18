/**
 * Astera Helios Profile 14: "RGB CCT DIM IND S" (PIXEL = 1; STROBE = ON)
 *
 * Same as Profile 7 (astera-helios-profile7.js) plus a Strobe channel:
 *   ch1-6  Red / Green / Blue / CCT / Dimmer / Index Color — identical to Profile 7
 *   ch7 Strobe
 *     0-3    Off
 *     4      Random Fast
 *     5      Random Medium
 *     6      Random Slow
 *     7-255  Variable Strobe, 0.4Hz -> 25Hz (linear interpolation between the two
 *            documented endpoints — the chart gives no formula for this one)
 */

import { rgbChannels, cctChannel, dimmerChannel, indexColorChannel, strobeChannel } from './astera-helios-channels.js'

export const asteraHeliosProfile14 = {
  id: 'astera-helios-profile14',
  manufacturer: 'Astera',
  name: 'Astera Helios — Profile 14 (RGB CCT DIM IND S)',
  footprint: 7,
  channels: [...rgbChannels(0), cctChannel(3), dimmerChannel(4), indexColorChannel(5), strobeChannel(6)],
}
