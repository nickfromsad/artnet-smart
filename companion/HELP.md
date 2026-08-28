# Art-Net Smart Fixtures

Sends Art-Net DMX directly (no separate Art-Net node module needed in Companion) and
knows fixture profiles, so actions expose meaningful controls (Color, Kelvin, Dimmer %,
Index Color) instead of raw channel numbers.

## Configuration

- **Target IP**: `255.255.255.255` for broadcast (simplest, works with most Art-Net
  nodes on the same subnet), or the specific IP of your Art-Net node for unicast.
- **Port**: `6454` (standard Art-Net port).
- **Enable UDP broadcast**: leave on if Target IP is a broadcast address.
- **Refresh Interval**: how often (ms) to re-send the last known state of every
  universe you've touched, in case a packet gets dropped. `0` disables this.
- **Fixture Patch List**: patch each physical fixture once — see below.

### Fixture Patch List

Set **Number of Fixtures** to how many you have (up to 16 — raise the `MAX_FIXTURES`
constant in `src/config.js` if you need more), then for each one fill in:

- **Name** — whatever you want to see in the action/preset picker (e.g. "Tube 1", "SL
  Truss Left"). Renaming here updates every action/preset next time you save the
  connection config.
- **Fixture Type** — which profile it is (e.g. Astera Helios Profile 7).
- **Universe** and **Start Ch.** — where it's actually patched in DMX. This is the one
  place you ever type the real address; every action and preset for that fixture reads
  it from here instead of you re-entering it each time. Change it once (e.g. you
  re-patched Tube 3 from channel 13 to channel 100) and every button pointed at "Tube
  3" follows automatically — no editing individual buttons.

**Start Ch. defaults chain automatically**: a fixture you haven't filled in yet defaults
to starting right after the previous fixture's real end — that fixture's own Start Ch.
plus its own Fixture Type's real channel count (Profile 7 is 6 channels, Profile 14 is
7). So Tube 1 (Profile 7) → default 1, Tube 2 → default 7 (1+6); if Tube 2 is Profile 14
instead, Tube 3 defaults to 14 (7+7), not a blind "+6" every time. If you move a
fixture's Start Ch. by hand, later fixtures' defaults follow from that new value too.
This only recomputes from what's currently **saved** — increasing "Number of Fixtures"
to reveal a new row picks up correctly from already-saved fixtures before it, but
editing several new rows in the same sitting before saving won't cross-update each
other's defaults live; save (or add one fixture at a time) if that matters to you.
Always double-check Universe/Start Ch. before relying on it, especially across
universes or non-contiguous patches.

## Using a fixture

Once a fixture is patched, Browse Actions gets one action named after it — e.g. **"Tube
3 — Set Full State"** — with Color, CCT (Kelvin), Dimmer, Index Color (and Strobe, on
Profile 14) as its fields. Universe/Start Channel are **not** fields on it — they're
baked in from the patch list, so there's nothing to fill in or accidentally leave
pointed at the wrong fixture. Change Tube 3's start channel in the config later and
this same action follows automatically, no re-editing buttons.

Like Start Effect, pressing Set Full State (per-fixture, or All) always takes over
completely: it stops any effect currently running on that fixture first, so pressing
"Full Red" while Rainbow is running actually gives you full red, instead of Rainbow's
next tick quietly overwriting it again a moment later.

A few extra actions are available for each profile **you actually have at least one
fixture patched as** (see below for why this matters):

- **`<Profile>` — Set Full State (All)**: the same fields, but sends to *every*
  currently-patched fixture of that profile at once — the fast way to set every tube to
  the same color/white/dimmer in one press. Only appears once you have 2+ fixtures of a
  profile patched (with just one, it's identical to that fixture's own action). Want the
  same look but as a moving effect instead of static? Use **Start Chase** with **Phase
  Spread** set to `0` — same idea, but animated and all perfectly synced.
- **`<Profile>` — Set Full State (Manual)**: the same fields, plus editable
  Universe/Start Channel — for a fixture of that profile you haven't patched a specific
  address for yet, or one-off testing.
- **`<Profile>` — Start Chase / Stop Chase**: see "Effects" below.

**Only profiles with a patched fixture show up anywhere** — in Browse Actions or in
Presets. If every fixture in your patch list is Profile 14, you won't see any Profile 7
entries at all (no Manual, no Chase, no per-fixture actions) — nothing to scroll past
for a profile you're not using. This updates live: patch a fixture as Profile 7 and its
actions/presets appear; remove the last Profile 7 fixture and they disappear again.

One always-available fallback, independent of any profile:

- **Raw — Set DMX Channel**: raw Universe/Channel/Value, for anything not covered by a
  profile at all.

Five fixture profiles are built in, and you can freely mix them in the same patch list
— pick the profile per fixture in the Fixture Patch List's **Fixture Type** dropdown,
each fixture only gets actions/presets under its own profile:

- **Astera Helios Profile 7** (mode "RGB CCT DIM IND", 6 channels, strobe off).
- **Astera Helios Profile 14** (mode "RGB CCT DIM IND S", 7 channels) — identical to
  Profile 7 plus a **Strobe** field: Off / Random Fast / Random Medium / Random Slow /
  Variable Rate (0.4-25 Hz, only shown when "Variable Rate" is selected). The chart only
  gives the two endpoints for the variable range (raw 7 = 0.4Hz, raw 255 = 25Hz) with no
  formula, so the Hz value uses a straight-line interpolation between them — close, but
  treat it as an approximation rather than an exact match to the fixture's internal curve.
- **Astera Helios Profile 80** (mode "RGB CCT DIM IND S", PIXEL=4, 25 channels) — the
  fixture's 4 individually-addressable pixels, each repeating Profile 7's Color/CCT/
  Dimmer/Index Color block, plus one Strobe channel shared by all 4. "Set Full State"
  still shows just one Color/CCT/Dimmer/Index Color/Strobe field, same as Profile 7/14 —
  every value fans out to all 4 pixels together, so the fixture behaves as one unit
  rather than needing 4 near-identical blocks of fields. Rainbow/Sine Breathing/Hard
  Blink effects (and Chase) can either pulse all 4 pixels in sync or ripple across them
  — see **Pixel Phase Spread** under Effects below.
- **Lupo Dayled — CCT** (2 channels, 8-bit: ch1 Dimmer, ch2 Color Temperature). No RGB —
  CCT is this fixture's only color control, so unlike the Astera profiles it's always
  directly applied (no "enable" checkbox, no falling back to a color it doesn't have).
  Kelvin runs 2700K (raw 255, warmest) to 6500K (raw 0, coolest) — inverted from the
  Astera profiles, per the fixture's own chart.
- **Generic Dimmer** (1 channel: Dimmer only) — for anything whose only DMX control is a
  single intensity channel (a dimmer pack, a simple LED fixture, etc).

Any fixture with a Dimmer channel gets Sine Breathing and Hard On/Off Blink effects
(and Chase) automatically, even without RGB — Rainbow only shows up as an option for
fixtures that actually have RGB, like the Astera profiles.

Note: "Set Full State" (fixture or Manual) always sets every channel of the fixture in
one go — there's currently no action that touches only some channels (e.g. flash the
strobe without changing color/dimmer). If you need that, ask for granular per-channel
actions to be added back for the fixtures where it matters.

## Effects: Rainbow, Sine Breathing Dimmer, Hard On/Off Blink, and Chase

A preset button fires once and stops — it can't animate anything by itself. For an
actual moving effect (color continuously cycling, dimmer smoothly pulsing or hard
blinking, a color/brightness wave rolling down a line of fixtures), the module runs a
small internal timer (~25 updates/sec) that keeps re-sending updated DMX until you stop
it.

Three effect types are built in:

- **Color Rainbow** — RGB continuously cycles through the color wheel. Only touches
  Red/Green/Blue; a **Dimmer while running (%)** field is sent once at start so the
  fixture is actually visible (it doesn't otherwise touch Dimmer).
- **Sine Breathing Dimmer** — Dimmer smoothly pulses between a Min% and Max%, fading in
  and out. Only touches Dimmer; a **Color while running** field is sent once at start
  (it doesn't otherwise touch RGB).
- **Hard On/Off Blink** — same idea as Sine Breathing, but no fade: Dimmer snaps
  straight from Max to Min and back, like a classic chase-light blink instead of a
  breath. Has an extra **On Time (%)** field (default 50%) controlling what fraction of
  each cycle it stays on before snapping off. Also only touches Dimmer, same one-shot
  **Color while running** field as Sine Breathing.
  - As a **Chase**, On Time doubles as "how much of the line is lit at once" — with
    Phase Spread at 1, On Time 70% means roughly 70% of the fixtures are lit and 30%
    dark at any given instant (not just 70% of each fixture's own time), since the
    per-fixture time offset and the spatial position are the same thing here.

Both are available per fixture and as a **Chase** across every patched fixture of a
profile at once:

- **`<fixtureName>` — Start Effect / Stop Effect** — runs on one fixture. Starting a new
  one always takes over completely: it stops whatever was running there before (e.g.
  switching from Rainbow to Hard Blink stops Rainbow first), so you never end up with
  an old effect quietly still driving a channel underneath a new one. Stop Effect stops
  everything running on that fixture.
- **`<Profile>` — Start Chase / Stop Chase** — runs the selected effect across every
  fixture currently patched under that profile, each one phase-delayed from the next by
  **Phase Spread** (0 = perfectly synced, 1 = one full cycle spread evenly across the
  whole line — the "rolling" look — higher values repeat the cycle more times across
  the line for tighter bands). Starting a chase also stops any previous chase on this
  profile, and stops any per-fixture Start Effect running individually on one of the
  chase's target fixtures — same reasoning as above. Which fixtures participate is
  fixed at the moment you press Start; changing their Universe/Start Channel afterward
  still updates live, same as everything else, but adding a 9th fixture won't join an
  already-running chase.
  - **Reverse Direction** (checkbox, Chase only): sweeps the other way down the line —
    e.g. Tube 8→1 instead of 1→8 — without having to type a negative Phase Spread.
  - **Random Order** (checkbox, Chase only): shuffles which fixture leads the sweep —
    and keeps reshuffling automatically at the start of every lap for as long as it
    keeps running, not just once when you press Start. The order stays fixed for one
    full sweep (still smooth, same Phase Spread math), then changes for the next one —
    so a long-running chase never looks like a fixed pattern on loop, without you
    needing to stop and restart it.
- **Effects — Stop All** — stops every running effect and chase everywhere, in one
  action. There's a matching "STOP ALL EFFECTS" preset too — good for an emergency
  reset button.

Starting the same effect on the same target again (e.g. pressing "Start Rainbow" twice)
just restarts its phase from the beginning (and its shuffle sequence, if Random Order
is on). Re-patching a fixture's Universe/Start Channel while an effect is running takes
effect immediately, on the next tick.

**Pixel Phase Spread** (Astera Helios Profile 80 only — anything with multiple
individually-addressable pixels on one fixture): appears on both Start Effect and Start
Chase, right alongside the other effect fields. `0` keeps all of that fixture's pixels
perfectly in sync (the default before this existed); `1` spreads one full cycle evenly
across its pixels, so e.g. Sine Breathing ripples down the tube's own 4 segments instead
of pulsing them all together — same idea as the cross-fixture **Phase Spread** used by
Chase, just applied within one fixture's own pixels instead of across separate
fixtures. The two combine: a Chase with both Phase Spread and Pixel Phase Spread set
ripples across the whole line of fixtures *and* across each fixture's own pixels at the
same time. Defaults to `1` (rippling) on presets and the field itself, since that's
almost always what you want out of a multi-pixel fixture — set it back to `0` if you
want the classic "whole tube as one unit" look instead.

**CCT gets reset automatically.** On these Astera fixtures, a non-zero CCT value
overrides RGB in the fixture's own firmware, no matter what gets sent afterward — so if
you'd previously set a CCT color (e.g. Warm White 3000K) on a fixture and then started
an effect, the fixture used to keep showing that white balance instead of the effect.
Every Start Effect / Start Chase now resets CCT to off as part of its one-shot baseline,
so this can't happen — no extra step needed on your part.

Presets exist for all of this (per fixture: Start Rainbow / Start Sine Breathing /
Start Hard Blink / Stop Effect; per profile, in a `<Profile> — Chase` category: Start
Rainbow Chase / Start Breathing Chase / Start Random Breathing Chase / Start Hard Blink
Chase / Start Random Blink Chase / Stop Chase) with sensible defaults (4 second cycle,
full range, 50% on time) — drag one on, then tweak Speed/Phase Spread/Min-Max/On
Time/Random Order to taste.

### Tap Tempo

**Tap Tempo** (Browse Actions → "Tap Tempo," also a preset in the "Effects" category)
lets you set an effect's speed by tapping along with the music instead of typing a
number. Tap it a few times in rhythm — averages your last 8 taps; a gap of 2+ seconds
starts a fresh tempo instead of blending with the old one.

**Follow BPM**: every Start Effect and Start Chase action has a **Follow BPM** checkbox.
Turn it on and a **Beats per Cycle** field appears (how many taps make up one full
effect cycle — `1` = once per beat, `4` = once every 4 beats) while **Speed (seconds
per cycle)** hides, since it's no longer used. This isn't a one-time snapshot — it
**live-follows**: an already-running effect updates its speed the moment you tap a new
tempo, no need to stop and restart it. When you retap, the effect restarts its phase
cleanly from the beginning of a cycle rather than jumping to some arbitrary point — so
expect a clean visible "snap" right when the tempo changes, not a smooth glide between
speeds. Before you've tapped anything (or after 2+ seconds of silence resets it), it
falls back to whatever's in the Speed field.

**Advanced**: Tap Tempo also publishes two Companion variables — `bpm` and
`beat_seconds` (`60 / bpm`) — usable anywhere Companion accepts an expression, e.g. to
show a live BPM readout on a button's text (`$(<your connection's name>:bpm) BPM`), or
to drive something outside this module's own Follow BPM checkbox.

## Presets

Once fixtures are patched, the presets panel gets one category per fixture (e.g.
"Astera Helios 7 — Tube 3") with ready-made buttons: Full Red/Green/Blue, Warm
White 3000K, Cool White 5600K, Dimmer 100%, Blackout, plus the effect presets described
above — already pointed at that fixture, no editing needed. Drag, drop, done.

With 2+ fixtures of a profile patched, there's also a `<Profile> — All` category with
the same Full Red/Green/Blue/Whites/Dimmer/Blackout buttons, but hitting every one of
that profile's fixtures at once — this is the fastest way to "make it all one color." A
"Manual" category is always available too, for building custom Set Full State buttons
against a fixture you patch by hand (Manual doesn't have All/effect presets — those
always need a patched fixture, or a group of them, to target).

## Installing as a developer module

1. In Companion, go to **Settings → Connections → Developer modules**.
2. Point it at this folder (the one containing `companion/manifest.json`).
3. Add a new connection using "Art-Net Smart Fixtures".

## Adding a new fixture profile

Copy whichever existing profile is closest to what you need, describe your fixture's
channels, and add it to the array in `src/fixtures/registry.js`. Actions and presets
are generated automatically from that data — no other code changes needed.

- `src/fixtures/generic-dimmer.js` — a single channel. Simplest template.
- `src/fixtures/lupo-dayled-cct.js` — Dimmer + CCT, no RGB. Use this if your fixture's
  only color control is Kelvin (set the channel's `overridesRgb: false`).
- `src/fixtures/astera-helios-profile7.js` — RGB + CCT (as an opt-in override, i.e.
  `overridesRgb: true`) + Dimmer + Index Color.
- `src/fixtures/astera-helios-profile14.js` — the above, plus Strobe.
- `src/fixtures/astera-helios-profile80.js` — a *multi-pixel* fixture: the same
  Profile 7 block repeated once per pixel (same channel `key`s each time, different
  offsets), plus one Strobe channel shared by all pixels. Use this template if your
  fixture has independently-addressable pixels/segments that should still behave as one
  unit from Companion's side.

Supported channel `type`s: `value8` (plain 0-255), `percent8` (0-255 shown as 0-100%),
`kelvin` (CCT — needs `kelvinToRaw`/`rawToKelvin`, `kelvinMin`/`kelvinMax`, and
`overridesRgb`), and `strobe` (needs the raw codes for its named modes plus the
variable-rate Hz conversion — see the Astera profiles for the shape). A fixture needs
channels keyed `red`/`green`/`blue` (all three) to get RGB/Rainbow support, and a
channel keyed `dimmer` to get Sine Breathing/Hard Blink/Chase support — everything else
in `src/actions.js`/`src/presets.js` reacts to whichever of these channels are present,
so a new fixture doesn't need any changes there.

**Multi-pixel fixtures**: if the same logical channel (Red, CCT, Dimmer, Index Color,
...) repeats once per pixel, give each repeat the *same* `key` — one Companion field is
generated for that key and its value fans out to every channel sharing it (see
`rgbGroups`/`findChannels`/`groupedOtherChannels` in `src/fixtures/state.js`, and
`astera-helios-profile80.js` for a worked example). A channel that's genuinely shared
across pixels (like a single Strobe controlling the whole fixture) just needs one entry
with a unique key, same as any single-pixel profile.
