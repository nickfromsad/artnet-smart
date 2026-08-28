/**
 * Astera Helios Profile 80: "RGB CCT DIM IND S" (PIXEL = 4; STROBE = SINGLE)
 *
 * Same per-pixel channel block as Profile 7 (astera-helios-profile7.js), repeated
 * once per pixel, plus one Strobe channel shared by all 4 pixels:
 *   ch1-6   Red / Green / Blue / CCT / Dimmer / Index Color of Pixel 1
 *   ch7-12  ...of Pixel 2
 *   ch13-18 ...of Pixel 3
 *   ch19-24 ...of Pixel 4
 *   ch25    Strobe for all Pixels (0-3 Off, 4 Random Fast, 5 Random Medium,
 *           6 Random Slow, 7-255 Variable Strobe 0.4Hz -> 25Hz)
 *
 * Every pixel's Red/Green/Blue/CCT/Dimmer/Index Color channel shares its key with the
 * same channel on the other 3 pixels (same as Profile 7's single set) — Companion's
 * "Set Full State" action exposes one Color/CCT/Dimmer/Index field, same as Profile 7,
 * and its value fans out to all 4 pixels together so the whole tube behaves as one
 * unit, rather than showing 4 near-identical blocks of fields. Internal effects
 * (Rainbow, Sine/Square Dimmer) fan out the same way, so they animate all 4 pixels in
 * sync too — see rgbGroups()/findChannels() in src/fixtures/state.js.
 */

import { rgbChannels, cctChannel, dimmerChannel, indexColorChannel, strobeChannel } from './astera-helios-channels.js'

const PIXEL_COUNT = 4
const PIXEL_FOOTPRINT = 6

function pixelChannels(pixelStartOffset) {
  return [
    ...rgbChannels(pixelStartOffset),
    cctChannel(pixelStartOffset + 3),
    dimmerChannel(pixelStartOffset + 4),
    indexColorChannel(pixelStartOffset + 5),
  ]
}

const pixels = Array.from({ length: PIXEL_COUNT }, (_, i) => pixelChannels(i * PIXEL_FOOTPRINT)).flat()

export const asteraHeliosProfile80 = {
  id: 'astera-helios-profile80',
  manufacturer: 'Astera',
  name: 'Astera Helios 80', // kept short on purpose — see astera-helios-profile7.js
  footprint: PIXEL_COUNT * PIXEL_FOOTPRINT + 1,
  channels: [...pixels, strobeChannel(PIXEL_COUNT * PIXEL_FOOTPRINT)],
}
