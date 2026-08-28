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
                               (touches:'dimmer', needs a dimmer channel). hsvToRgb and
                               the pixelPhase() per-pixel-spread helper live here too.
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
   `pixelPhase()` helper — each program's `tick()` computes a per-pixel-index phase
   offset (`spread=0`/single-pixel profile ⇒ always identical to the old behavior, so no
   engine changes were needed: `engine.js` already just calls `program.tick(profile,
   phase, params)` and merges whatever offsets come back). The field
   (`pixelPhaseSpread`, `pixelCount(profile) > 1` gated) appears **only on Start
   Effect** — on Start Chase it doesn't exist as a field at all; see rule 10.
10. **A Chase automatically flattens "every targeted fixture's own pixels" into one
    continuous line, derived from Phase Spread — not a second independent field.**
    User request: chasing 2 Astera Helios Profile 80 fixtures should look like one
    wave (fixture1 pixel1→2→3→4, then fixture2 pixel1→2→3→4), not two fixtures each
    re-rippling through nearly a full cycle while also staggering against each other
    (which is what independently-set Phase Spread + Pixel Phase Spread produced).
    Derivation: with F fixtures, P = `pixelCount(profile)` pixels each (same profile
    for the whole chase), N = F·P flattened positions, `offset(k=i·P+j) = (i/F)·S +
    (j/P)·(S/F)` where S is the Chase's `phaseSpread`. The first term is `engine.js`'s
    existing unchanged per-fixture formula; the second means the pixel-level spread fed
    into `program.tick()` must be `S/F` (not the user's own value — the field is
    removed from Chase entirely, see rule 9). Computed once in `buildChaseStartAction`
    (`src/actions.js`), **not** in `engine.js` — doing it there correctly reduces to
    `S/1 = S` when a chase runs against only 1 currently-patched fixture (a reachable
    state), where an engine-side `orderedIndices.length > 1` gate would instead
    silently zero out that one fixture's own pixel ripple, a regression. Reverse
    Direction and Random Order both keep working unchanged (sign flows through the
    division; shuffling only changes which fixture sits at position `i`).
11. **Reverse Pixel Order flips which pixel leads within a fixture — via an index
    remap, NOT by negating `pixelPhaseSpread`'s sign.** Added after the user's rig
    turned out to need the fixture-to-fixture sweep going one way while each fixture's
    own pixel order needed to run the opposite way (physical mounting: pixel 1 isn't
    on the same side as the next fixture's pixel 1). First attempt negated the sign of
    `pixelPhaseSpread` — **wrong**: pixel 0 always sits at offset 0 regardless of
    spread's sign (`(0/n)*spread = 0`), so negating just mirrors the other pixels
    around pixel 0 instead of actually reversing the sequence; caught by a test that
    compared the reversed run's per-fixture pixel sequence against the forward run's
    sequence reversed; naive symmetric test data (Rainbow's red channel at 45°
    intervals) initially masked this because `hsvToRgb`'s red channel happens to be
    symmetric at those exact sample points — only checking the full RGB triple (or
    non-symmetric sample points) exposed it. Correct fix: `pixelIndex(i, n, reverse)`
    in `src/effects/programs.js` remaps which physical pixel gets which position index
    (`reverse ? n-1-i : i`) *before* computing `pixelPhase()`, leaving
    `pixelPhaseSpread`'s own sign/magnitude untouched. `params.reversePixelOrder`
    (boolean) flows through `effectParams` unchanged for both Start Effect and Start
    Chase — no chase-specific sign-flip logic needed once the fix moved into the index
    remap. Independent of Reverse Direction (rule 10) and Random Order — a fixture's
    own pixels don't get an independent "random order" (see Known gaps).
12. **Hard On/Off Blink got a Fade Width field instead of a new "Comet" effect,
    consistent with rule 10's lesson.** User wanted a soft-edged blink (dimmed
    transition zone of adjustable width between lit and dark) — same territory as the
    reverted Comet effect (rule under Known gaps), but this time added as a field on
    the *existing* effect rather than a new one, per explicit prior feedback. Lives in
    `squareWave(p, duty, fade)` in `src/effects/programs.js`: the falling edge ramps
    for `fade` fraction of the cycle immediately after `duty`, the rising edge ramps
    for `fade` immediately before the wrap back to phase 0 — both eat into what would
    otherwise be flat "off" time, so `fade` is clamped to `min(fade, (1-duty)/2)` to
    guarantee the two ramps can never overlap regardless of how wide it's set relative
    to On Time. `fadeWidth=0` (the field's default) is byte-identical to the old
    hard-snap behavior — confirmed by a regression test comparing every sample phase
    against the pre-existing (no-fade) code path. Composes for free with Pixel Phase
    Spread/Reverse Pixel Order/Chase flattening, same as the other programs, since it's
    just a different per-pixel value function fed the same already-spread `phase`.
13. **Sine Breathing got the same "Blank Space" treatment as Comet, again as a field on
    the existing effect rather than a new one.** User wanted the Chase-driven breathing
    wave to look like an actual traveling wave — a compact bright hump moving down the
    line with genuinely dark space around it — instead of every pixel always being at
    least partly lit (the old formula breathes across the *entire* cycle, so at any
    instant every position in a Chase shows some nonzero brightness). `blankSpace`
    (0-99%, `range: true` slider — the user explicitly wants sliders here, unlike the
    Comet hue mixup) compresses the breath into `waveWidth = 1 - blankSpace/100` of the
    cycle: `percent = p < waveWidth ? <breath formula on p/waveWidth> : min`.
    `blankSpace=0` (default) makes `waveWidth=1`, so `p/waveWidth = p` — byte-identical
    to the original always-breathing formula; confirmed by a regression test. Composes
    for free with Pixel Phase Spread/Reverse Pixel Order/Chase flattening, same
    mechanism as rule 12's Fade Width.
14. **Rainbow got the same `blankSpace` treatment as Sine Breathing (rule 13), and they
    now share one field/id instead of each getting their own.** Rainbow's hue rotation
    (`(p/waveWidth)*360` instead of `p*360`, black outside `[0, waveWidth)`) is the same
    shape of fix as Sine Breathing's compressed breath — both "wrap one full cycle
    across the pixels, compress into a shorter window, flat/black outside it." Since a
    Companion action's `options` array is shared across every program in the dropdown
    (not per-program) and Rainbow/Sine Breathing can never both be selected at once,
    reusing the id `blankSpace` for both — gated by
    `isVisibleExpression: "$(options:program) == 'rainbow' || $(options:program) == 'sineDimmer'"`
    — is correct and avoids a field-proliferation smell; giving Rainbow its own
    `rainbowBlankSpace` would've been redundant. `effectParams` sets `params.blankSpace`
    once, keyed off `program.id` being either of the two, independent of `touches`
    (Rainbow is `touches:'rgb'`, Sine Breathing is `touches:'dimmer'` — the shared field
    lives outside both of those branches). If a 3rd program ever wants this shape, reuse
    the same field/gate rather than adding a new one.
15. **Sine Breathing's "Two-Color Wave" makes `touches` fixture-dependent, the one
    genuine exception to "a program's `touches` is a fixed 'rgb'|'dimmer' value."** User
    wanted 2 real colors (e.g. red/white) instead of 1 color fading to black — which
    only a Dimmer scaling a fixed color can never produce (dimming a static RGB value
    just darkens it, it can't shift hue). Fix: `sineDimmer.tick()` branches on
    `params.twoColorWave && hasRgb(profile)` — when true, it writes RGB directly every
    tick (linear-interpolating `params.color` (peak, reused from the existing "Color
    while running" field) and `params.backgroundColor` (new field) by the same
    `waveShape()` envelope Blank Space already uses) and never touches the Dimmer
    channel at all; when false (default, or a Dimmer-only fixture), behavior is
    byte-identical to before. This means sineDimmer *acts* like an `'rgb'`-touching
    program (wants the Dimmer one-shot baseline, not the Color one-shot baseline) only
    in this mode — `program.touches` itself stays the static string `'dimmer'`
    (unchanged, so `dimmerPrograms`/`rgbPrograms` filtering in `effectStartFields`
    still works), but `effectOneShotOverrides` computes its own
    `isTwoColorWave = program.id === 'sineDimmer' && options.twoColorWave &&
    hasRgb(profile)` and branches independently of `touches` for this one case. Field
    visibility follows: Dimmer Min/Max hide (`dimmerVisible && !twoColorWaveExpression`)
    since they're meaningless once RGB carries the brightness; the existing Dimmer
    while running (%) field (normally Rainbow-only) extends to cover this case instead,
    reused rather than duplicated — same "share, don't proliferate" reasoning as rule
    14's `blankSpace`. Gated to RGB fixtures only (`hasTwoColorWave = ... &&
    hasRgb(profile)`), computed once and reused everywhere so no expression ever
    references a field (`twoColorWave`) that doesn't exist on non-RGB profiles.

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

`npm test` — 127 tests, Node's built-in `node:test`, zero extra dependencies. All
passing as of the last commit. Files: `artnet-sender.test.js`, `fixtures.test.js`,
`patch-list.test.js` (config/action/preset generation), `effects.test.js` (engine +
program math + BPM live-follow + squareDimmer's Fade Width shape/clamping +
sineDimmer's/rainbow's shared Blank Space shape + sineDimmer's Two-Color Wave RGB
blend, including its no-op fallback on Dimmer-only fixtures), `effects-actions.test.js`
(action-layer wiring for effects), `tap-tempo.test.js`,
`multi-pixel.test.js` (Profile 80's fan-out: one field
writes every pixel's channel, Strobe stays single, effects animate all pixels in sync;
Pixel Phase Spread ripples them out of sync on request and
is a no-op at 0 or on single-pixel profiles; Chase auto-derives its per-fixture pixel
spread from Phase Spread/fixtureCount, including an end-to-end `EffectsEngine` test
proving 2 chased Profile 80 fixtures form one continuous 8-position wave, not two
independent ripples; Reverse Pixel Order end-to-end test comparing a reversed chase run
against the forward run's per-fixture sequence reversed — see rule 11 in "Established
rules" for why a weaker single-channel check would have missed a real bug here).

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
- Profile 80's pixel spread has Reverse Pixel Order (rule 11) but no Random Order
  equivalent for shuffling pixel order (unlike the cross-fixture Chase's actual random
  reshuffling every lap) — there's no way to randomize which pixel leads within one
  fixture, only a fixed forward/reversed choice. Would need the engine to track a
  per-effect pixel shuffle state, separate from the existing per-effect fixture
  shuffle; not built since it wasn't asked for.
- A "Comet" effect (bright leading edge fading to black, distinct from Hard On/Off
  Blink's instant snap) was built, then explicitly reverted at the user's request — they
  wanted the existing effects' Chase behavior (rule 10) rather than a new effect type.
  Not present in the codebase; revisit from scratch if ever actually wanted again, don't
  assume the reverted implementation is still relevant.
- The user's exact Companion version was never confirmed; `1.14.1` was chosen for broad
  compatibility, not because a specific version was stated. If something in the module
  API breaks against their real Companion instance, that's the first thing to check.

## Resuming work

1. `cd /Users/nick/Documents/Companion/DEV/Artnet-Smart && npm test` — expect 127 passing.
2. Read `companion/HELP.md` for current user-facing behavior.
3. `git log --oneline` for commit-by-commit history if a decision needs more detail
   than this file gives.
