import { asteraHeliosProfile7 } from './astera-helios-profile7.js'
import { asteraHeliosProfile14 } from './astera-helios-profile14.js'
import { asteraHeliosProfile80 } from './astera-helios-profile80.js'
import { lupoDayledCct } from './lupo-dayled-cct.js'
import { genericDimmer } from './generic-dimmer.js'
import { dualWhiteDimmer } from './dual-white-dimmer.js'

/**
 * All known fixture profiles. To add a new fixture: copy the simplest existing
 * profile that's closest to what you need (generic-dimmer.js for a single
 * channel, lupo-dayled-cct.js for Dimmer+CCT with no RGB, astera-helios-profile7.js
 * for RGB+CCT+Dimmer+Index, astera-helios-profile14.js if it also needs Strobe,
 * astera-helios-profile80.js if it's also split across multiple pixels), describe
 * its channels, and push it into this array — actions.js and presets.js build
 * everything else from this data automatically.
 */
export const fixtureRegistry = [
  asteraHeliosProfile7,
  asteraHeliosProfile14,
  asteraHeliosProfile80,
  lupoDayledCct,
  genericDimmer,
  dualWhiteDimmer,
]
