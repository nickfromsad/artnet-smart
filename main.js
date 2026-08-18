import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { getConfigFields } from './src/config.js'
import { ArtnetSender } from './src/artnet-sender.js'
import { fixtureRegistry } from './src/fixtures/registry.js'
import { buildActionDefinitions } from './src/actions.js'
import { buildPresetDefinitions } from './src/presets.js'
import { EffectsEngine } from './src/effects/engine.js'
import { TapTempo } from './src/tap-tempo.js'

class ArtnetSmartInstance extends InstanceBase {
  async init(config) {
    this.config = config
    this.sender = null
    // created once and never recreated on configUpdated — it reads instance.config
    // live every tick, so saving the config must not interrupt a running effect
    this.effects = new EffectsEngine(this)
    this.tapTempo = new TapTempo()

    this.setVariableDefinitions([
      { variableId: 'bpm', name: 'Tap Tempo — BPM' },
      { variableId: 'beat_seconds', name: 'Tap Tempo — seconds per beat (use as an expression in a Speed field)' },
    ])
    this.setVariableValues({ bpm: 120, beat_seconds: 0.5 })

    this.updateActionsAndPresets()
    this.setupSender()
  }

  updateActionsAndPresets() {
    this.setActionDefinitions(buildActionDefinitions(this, fixtureRegistry))
    this.setPresetDefinitions(buildPresetDefinitions(this, fixtureRegistry))
  }

  setupSender() {
    this.sender?.destroy()
    this.sender = null

    if (!this.config?.host) {
      this.updateStatus(InstanceStatus.BadConfig, 'No target IP configured')
      return
    }

    this.updateStatus(InstanceStatus.Connecting)
    try {
      this.sender = new ArtnetSender({
        host: this.config.host,
        port: this.config.port || 6454,
        broadcast: !!this.config.broadcast,
        refreshIntervalMs: this.config.refreshIntervalMs ?? 1000,
      })
      this.sender.ready
        .then(() => this.updateStatus(InstanceStatus.Ok))
        .catch((err) => this.updateStatus(InstanceStatus.ConnectionFailure, err?.message))
    } catch (err) {
      this.updateStatus(InstanceStatus.ConnectionFailure, err?.message)
    }
  }

  async configUpdated(config) {
    this.config = config
    this.updateActionsAndPresets()
    this.setupSender()
  }

  getConfigFields() {
    return getConfigFields(fixtureRegistry, this.config)
  }

  async destroy() {
    this.effects?.destroy()
    this.sender?.destroy()
    this.sender = null
  }
}

runEntrypoint(ArtnetSmartInstance, [])
