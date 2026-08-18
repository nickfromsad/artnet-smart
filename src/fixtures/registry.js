import { asteraHeliosProfile7 } from './astera-helios-profile7.js'
import { asteraHeliosProfile14 } from './astera-helios-profile14.js'

/**
 * All known fixture profiles. To add a new fixture: copy
 * astera-helios-profile7.js (or astera-helios-profile14.js if it needs
 * Strobe) as a template, describe its channels, and push it into this array
 * — actions.js and presets.js build everything else from this data
 * automatically.
 */
export const fixtureRegistry = [asteraHeliosProfile7, asteraHeliosProfile14]
