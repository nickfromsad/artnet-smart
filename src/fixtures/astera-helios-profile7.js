/**
 * Astera Helios Profile 7: "RGB CCT DIM IND" (PIXEL = 1; STROBE = OFF)
 *
 * From the Astera Helios DMX chart:
 *   ch1 Red        0-255
 *   ch2 Green      0-255
 *   ch3 Blue       0-255
 *   ch4 CCT        0-3 no effect; 4-255 -> Kelvin = 2000 + 20*raw (CCT overwrites RGB)
 *   ch5 Dimmer     0-255 (closed -> open)
 *   ch6 Index Color 0-1 no effect; 2-255 -> named index color (list not available yet,
 *                    exposed as a raw number for now; overwrites both RGB and CCT)
 */

import { rgbChannels, cctChannel, dimmerChannel, indexColorChannel } from './astera-helios-channels.js'

// re-exported for backwards compatibility (other code/tests import the CCT/percent
// math from this file)
export {
  cctRawToKelvin,
  cctKelvinToRaw,
  CCT_KELVIN_MIN,
  CCT_KELVIN_MAX,
  percentToRaw,
} from './astera-helios-channels.js'

export const asteraHeliosProfile7 = {
  id: 'astera-helios-profile7',
  manufacturer: 'Astera',
  name: 'Astera Helios — Profile 7 (RGB CCT DIM IND)',
  footprint: 6,
  channels: [...rgbChannels(0), cctChannel(3), dimmerChannel(4), indexColorChannel(5)],
}
