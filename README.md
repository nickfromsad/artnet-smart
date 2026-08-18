# Artnet-Smart

A Bitfocus Companion module that sends Art-Net DMX directly and knows fixture
profiles, so you get one clean "Tube 3 — Set Full State" action per fixture (Color,
Kelvin, Dimmer, Index Color, Strobe) plus ready-made presets — instead of manually
working out DMX channel numbers and typing raw 0-255 values. It also runs animated
effects (Rainbow, Sine Breathing Dimmer, and a phase-offset Chase across a whole line of
fixtures) internally, via Start/Stop actions.

Patch each physical fixture once (name + universe + start channel) in the connection's
config, and Browse Actions gets a distinct, correctly-addressed action per fixture —
change a fixture's start address in one place and everything pointed at it follows.

Plain ESM JavaScript, no build step: edit a file, restart the connection in Companion,
done.

## Quick start

```sh
npm install
npm test          # unit tests for the packet builder, fixture math, and effects engine
```

Then point Companion's **Settings → Connections → Developer modules** at this folder.
See `companion/HELP.md` for full usage and how to add more fixture profiles.

## Layout

- `main.js` — the Companion `InstanceBase` entrypoint; owns the `ArtnetSender` and
  `EffectsEngine` for the connection's lifetime.
- `src/artnet-sender.js` — builds and sends Art-Net ArtDMX UDP packets; keeps a
  per-universe buffer so single-channel updates don't clobber the rest of the fixture.
  `setChannels` sends immediately (one-shot actions); `mergeChannels`/`flushAll` batch
  many updates into one packet per universe (used by the effects engine).
- `src/fixtures/` — fixture profile data plus small shared helpers (`state.js`).
  `registry.js` lists all known fixtures; `astera-helios-profile7.js` doubles as the
  template for adding more.
- `src/effects/` — `programs.js` (pure Rainbow/Sine Dimmer math) and `engine.js` (the
  ~25Hz tick loop that drives running effects and chases).
- `src/actions.js` / `src/presets.js` — generate Companion actions/presets from
  whatever is in the fixture registry and the instance's fixture patch list. No
  fixture-specific logic lives here.
- `test/` — `node --test` coverage for the packet format, fixture math, action/preset
  generation, and the effects engine.
