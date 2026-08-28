# Handoff — Artnet-Smart

Written to let a fresh conversation (human or Claude) pick this project up cold, with
no memory of how it got here. Read `companion/HELP.md` for current user-facing feature
docs (kept accurate throughout); this file is for the *why* behind decisions that
aren't obvious from reading the code.

## What this is

A Bitfocus Companion module (plain ESM JavaScript, no build step) that sends Art-Net
DMX directly and generates one action/preset per fixture from a "fixture patch list" in
the connection config — instead of the user hand-entering raw DMX channel/value pairs
via Companion's generic Artnet module, which was too slow to build shows with.

Repo: **https://github.com/nickfromsad/artnet-smart** (public, branch `main`).
Working directory: `/Users/nick/Documents/Companion/DEV/Artnet-Smart`.

## Who this is for

The user runs a **real, live lighting rig** through Companion — this is not a demo.
Originally 8 Astera Helios tubes (mix of Profile 7 / Profile 14) on universe 0,
contiguous addressing, loaded as a Companion "developer module" (points Companion at
this local folder, not the module store). They've since added at least one Lupo Dayled
(CCT mode) and are interested in generic single-channel dimmers — the rig is actively
growing. Several reported bugs were things hit live while operating the show, not
theoretical.

**Do not rename `id` in `companion/manifest.json`** (`nickvantriest-artnet-smart`)
without warning the user first — their live Companion connection (patched fixtures,
built buttons) is tied to it. Everything else in the manifest is safe to edit freely.

## How this user works (see also memory: `artnet-smart-feedback`)

- Trusts "(Recommended)" options in `AskUserQuestion` and moves fast — don't over-ask,
  but do ask when something is genuinely ambiguous or hard to reverse; they engage
  thoughtfully every time.
- **Never commits/pushes without being explicitly told to**, separately from finishing
  the work. "Commit and push it" is always its own request.
- Consistently asks for a **cleaner, more minimal UI** over more features — has trimmed
  Browse Actions from many granular actions down to one per fixture, removed
  unused-profile clutter, shortened repeated display names. Default to the smallest
  visible footprint for any new capability.
- Reports bugs by symptom, in short Dutch-influenced English ("collor", "presset",
  "fixuter", "wen"=when). Every symptom report so far has been a real, reproducible bug
  — take them seriously and go find the root cause.

## Architecture

```
main.js                    InstanceBase entrypoint. Owns ArtnetSender, EffectsEngine,
                            TapTempo for the connection's lifetime — created once in
                            init(), NOT recreated in configUpdated() (so running
                            effects survive a config save).

src/artnet-sender.js       Builds/sends Art-Net ArtDMX UDP packets.
                            setChannels() = merge + send immediately (one-shot actions).
                            mergeChannels()/flushAll() = batch many updates into one
                            packet per universe (used by the effects engine so an
                            8-fixture chase doesn't send 8 redundant packets/tick).

src/config.js               getConfigFields(fixtureRegistry, savedConfig). Builds the
                            "Fixture Patch List" UI: fixtureCount + up to MAX_FIXTURES
                            (16) rows of {Name, Type, Universe, Start Ch.}. Start Ch.
                            defaults CHAIN off the previous fixture's real saved
                            start+footprint (bug fix — used to blindly add 6 every time).

src/fixtures/               Fixture profile DATA — the extension point. Add a fixture
                            by writing a profile file and pushing it into registry.js;
                            actions.js/presets.js generate everything else automatically.
  state.js                    Pure helpers: findChannel, hasRgb, otherChannels,
                               overridesToValues.
  registry.js                  fixtureRegistry array — single source of truth.
  astera-helios-channels.js   Shared channel factories for the two Astera profiles.
  astera-helios-profile7.js  RGB + CCT (overridesRgb:true) + Dimmer + Index.
  astera-helios-profile14.js  Profile 7 + Strobe.
  astera-helios-profile80.js  Profile 7's block repeated x4 (one per pixel, same
                               channel keys/different offsets) + one shared Strobe.
                               See "Multi-pixel fixtures" below.
  lupo-dayled-cct.js          Dimmer + CCT (overridesRgb:false, inverted linear:
                               raw 0=6500K .. raw 255=2700K). No RGB.
  generic-dimmer.js           Single Dimmer channel only.

src/effects/                 Internal ~25Hz tick engine.
  programs.js                  Pure per-tick math. EFFECT_PROGRAMS.rainbow
                               (touches:'rgb', needs hasRgb), .sineDimmer/.squareDimmer
                               (touches:'dimmer', needs a dimmer channel). hsvToRgb here.
  engine.js                    EffectsEngine class, TICK_MS=40. shuffle() (Fisher-Yates,
                               injectable randomFn for tests) lives here too. Handles
                               per-lap reshuffle (Random Order), live BPM-follow (reads
                               instance.tapTempo.current() every tick, cleanly resets
                               phase to 0 when the resolved period changes), phaseSpread
                               sign = sweep direction.

src/tap-tempo.js             TapTempo class. tap(now) records + returns
                              {bpm, beatSeconds} (null until 2+ taps; 2s gap resets).
                              current() returns the last result without tapping — used
                              by the engine's live BPM-follow.

src/actions.js               Biggest file. Builds ALL Companion actions from
                              fixtureRegistry + instance.config. stopAllPrograms() is
                              the key shared helper — see "Established rules" below.

src/presets.js                Mirrors actions.js's generation to build ready-made
                              preset buttons, only for profiles with >=1 patched
                              fixture (no clutter from unused profiles).
```

Channel `type`s a fixture profile can use: `value8` (plain 0-255), `percent8` (shown as
0-100%), `kelvin` (needs `kelvinToRaw`/`rawToKelvin`/`kelvinMin`/`kelvinMax`/
`overridesRgb`), `strobe` (needs named-mode raw codes + variable-rate Hz conversion —
see the Astera profiles for the shape).

## Established rules (arrived at through real iteration — don't relitigate lightly)

1. **One action per patched fixture** ("Tube 3 — Set Full State"), Universe/Start
   Channel baked in from config, not action fields. Manual variant (editable address)
   and a Raw per-channel fallback are always available regardless of patch state.
2. **Only profiles with ≥1 patched fixture get any actions/presets at all** — an unused
   profile shows up nowhere in Browse Actions or Presets.
3. **Starting anything on a fixture stops whatever else was running there first**
   (`stopAllPrograms` in `src/actions.js`). Applies to Start Effect, Start Chase
   (also stops per-fixture effects on its target fixtures), and Set Full State / Set
   Full State (All) (also stops running effects). This was two separate bug reports
   fixed with the same pattern, in both directions — don't reintroduce a code path that
   sets DMX state without stopping prior effects on that target first.
4. **CCT reset-on-effect-start only happens when `cctChannel.overridesRgb` is true.**
   Astera's CCT literally overrides RGB in firmware, so effects reset it to avoid
   silently hiding RGB. Lupo has no RGB to protect — resetting its CCT would just
   needlessly change color temp when an unrelated Dimmer effect starts.
5. **Fixture profile `name` is deliberately short** ("Astera Helios 7", not "Astera
   Helios — Profile 7 (RGB CCT DIM IND)") — it's prepended to every category/action
   name and the length repeats a lot.
6. **An un-named fixture's default is `"Unedited Fixture N"`**, not `"Helios N"`
   (a real bug — it used to hardcode Astera's name regardless of fixture type) and not
   plain `"Fixture N"` (user wanted it obviously a placeholder).
7. `companion/manifest.json`'s `description`/`products` deliberately don't lead with
   "Astera Helios" — lists all fixture families as peers, since Companion shows this in
   the module browser and it was reading as Astera-branded.
8. **Multi-pixel fixtures fan one Companion field out to every pixel, not one field per
   pixel.** Profile 80 (4 independently-addressable pixels + 1 shared Strobe) still
   shows a single Color/CCT/Dimmer/Index Color field in "Set Full State", same as
   Profile 7/14 — its value is written to all 4 pixels' channels together, and Rainbow/
   Sine/Square effects animate all 4 in sync. Mechanism: give every pixel's repeat of a
   channel the *same* `key` (e.g. `key: 'red'` four times, different offsets);
   `rgbGroups`/`findChannels`/`groupedOtherChannels` in `src/fixtures/state.js` collapse
   same-key channels into one logical group everywhere a profile's channels are read
   (`actions.js`, `presets.js`, `effects/programs.js`). A single-pixel profile's groups
   are all length-1, so this was a behavior-preserving refactor for Profile 7/14/Lupo/
   Generic Dimmer — confirmed via the full test suite before Profile 80 was added.
9. **Pixel Phase Spread ripples an effect across one fixture's own pixels, the
   within-fixture counterpart to Chase's cross-fixture Phase Spread.** Added after the
   user asked for Sine Breathing to animate across a tube's own 4 pixels instead of
   pulsing them all in lockstep. Lives entirely in `src/effects/programs.js`'s
   `pixelPhase()` helper — each program's `tick()` now computes a per-pixel-index phase
   offset (`spread=0`/single-pixel profile ⇒ always identical to the old behavior, so no
   engine changes were needed: `engine.js` already just calls `program.tick(profile,
   phase, params)` and merges whatever offsets come back). The field
   (`pixelPhaseSpread`, `pixelCount(profile) > 1` gated) appears on **both** Start
   Effect and Start Chase, unlike Reverse Direction/Random Order which are chase-only —
   it composes with the fixture-level Phase Spread rather than replacing it. Defaults to
   `1` (rippling), both on the field and in presets — deliberately not `0`, since a bare
   "add the fixture" pass would otherwise leave Profile 80 pulsing in sync by default and
   require an extra manual step to get the behavior the user actually asked for.

## Companion-module-API gotchas (see also memory: `companion-module-gotchas`)

- **`isVisible` functions silently lose closures.** They get `.toString()`'d across the
  IPC boundary; any closed-over variable is gone, and Companion just skips the field —
  no error. Always use `isVisibleExpression` (a string, e.g.
  `"$(options:mode) == 'x'"`) instead. There's a regression test in
  `test/patch-list.test.js` that scans every field for a stray `isVisible` function.
- **Pinned to `@companion-module/base@^1.14.1`, deliberately not `2.x`.** The 2.x line's
  actions/presets API isn't confirmed compatible with any released Companion version
  yet per the package's own compatibility table. 1.14.x covers Companion v3.0-v4.2+.
- Config-field `default` is computed once per panel render from the **last saved**
  config, not live per keystroke — `getConfigFields` threads `savedConfig` through to
  compute chained defaults (e.g. next fixture's start channel) server-side.

## Test suite

`npm test` — 107 tests, Node's built-in `node:test`, zero extra dependencies. All
passing as of the last commit. Files: `artnet-sender.test.js`, `fixtures.test.js`,
`patch-list.test.js` (config/action/preset generation), `effects.test.js` (engine +
program math + BPM live-follow), `effects-actions.test.js` (action-layer wiring for
effects), `tap-tempo.test.js`, `multi-pixel.test.js` (Profile 80's fan-out: one field
writes every pixel's channel, Strobe stays single, effects animate all pixels in sync;
Pixel Phase Spread ripples them out of sync on request and is a no-op at 0 or on
single-pixel profiles).

Manual verification pattern used throughout: ad-hoc `node -e "..."` smoke scripts run
via Bash (not saved to the repo) that wire `buildActionDefinitions`/
`buildPresetDefinitions`/`EffectsEngine` together with a fake `instance` object and
actually execute callbacks end-to-end. This caught integration bugs the unit tests
alone missed more than once — worth repeating for any cross-module change before
calling it done.

## Known gaps (not bugs — just not built)

- Astera's Index Color channel (ch6) is still raw 0-255 — the named color table from
  the manual was never provided ("full list at end of document" in the original chart
  image, not included). Upgrade to a dropdown if the user ever supplies it.
- No granular per-channel static actions anymore — removed deliberately for a cleaner
  Browse Actions list. Only full-state actions exist; documented as a known limitation
  in `companion/HELP.md`.
- Chase's fixture membership is snapshotted at Start time, not live — a fixture patched
  after a chase starts won't join it.
- A 3-channel Lupo Dayled variant (adds Strobe, per its own chart) was **not** built —
  only the 2-channel CCT mode was requested.
- Profile 80's Pixel Phase Spread has no Reverse Direction/Random Order equivalent
  (unlike the cross-fixture Chase, which has both) — it's just a spread amount. Adding
  those would need the engine to track a per-effect pixel shuffle state, separate from
  the existing per-effect fixture shuffle; not built since it wasn't asked for.
- The user's exact Companion version was never confirmed; `1.14.1` was chosen for broad
  compatibility, not because a specific version was stated. If something in the module
  API breaks against their real Companion instance, that's the first thing to check.

## Resuming work

1. `cd /Users/nick/Documents/Companion/DEV/Artnet-Smart && npm test` — expect 107 passing.
2. Read `companion/HELP.md` for current user-facing behavior.
3. `git log --oneline` for commit-by-commit history if a decision needs more detail
   than this file gives.
