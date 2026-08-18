import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asteraHeliosProfile7,
  cctRawToKelvin,
  cctKelvinToRaw,
  percentToRaw,
  CCT_KELVIN_MIN,
  CCT_KELVIN_MAX,
} from '../src/fixtures/astera-helios-profile7.js'
import { asteraHeliosProfile14 } from '../src/fixtures/astera-helios-profile14.js'
import { strobeRawToHz, strobeHzToRaw } from '../src/fixtures/astera-helios-channels.js'

test('CCT raw->Kelvin matches the documented examples', () => {
  assert.equal(cctRawToKelvin(50), 3000)
  assert.equal(cctRawToKelvin(100), 4000)
  assert.equal(cctRawToKelvin(150), 5000)
})

test('CCT boundary: raw 4 is the first "effect" value, raw 255 is the max', () => {
  assert.equal(CCT_KELVIN_MIN, 2080)
  assert.equal(CCT_KELVIN_MAX, 7100)
})

test('Kelvin->raw is the inverse of raw->Kelvin and clamps to the effective range', () => {
  assert.equal(cctKelvinToRaw(3000), 50)
  assert.equal(cctKelvinToRaw(4000), 100)
  assert.equal(cctKelvinToRaw(5000), 150)
  assert.equal(cctKelvinToRaw(1000), 4) // below range clamps to the lowest "effect" raw value
  assert.equal(cctKelvinToRaw(10000), 255) // above range clamps to max
})

test('percentToRaw covers 0/50/100 and clamps out-of-range input', () => {
  assert.equal(percentToRaw(0), 0)
  assert.equal(percentToRaw(100), 255)
  assert.equal(percentToRaw(50), 128) // Math.round(50*255/100) = 127.5 -> 128
  assert.equal(percentToRaw(-10), 0)
  assert.equal(percentToRaw(150), 255)
})

test('Astera Helios Profile 7 channel layout matches the DMX chart', () => {
  assert.equal(asteraHeliosProfile7.footprint, 6)
  const byKey = Object.fromEntries(asteraHeliosProfile7.channels.map((c) => [c.key, c]))
  assert.equal(byKey.red.offset, 0)
  assert.equal(byKey.green.offset, 1)
  assert.equal(byKey.blue.offset, 2)
  assert.equal(byKey.cct.offset, 3)
  assert.equal(byKey.dimmer.offset, 4)
  assert.equal(byKey.indexColor.offset, 5)
  assert.equal(byKey.cct.type, 'kelvin')
  assert.equal(byKey.dimmer.type, 'percent8')
})

test('Astera Helios Profile 14 is Profile 7 plus a Strobe channel at offset 6', () => {
  assert.equal(asteraHeliosProfile14.footprint, 7)
  const byKey = Object.fromEntries(asteraHeliosProfile14.channels.map((c) => [c.key, c]))
  assert.equal(byKey.red.offset, 0)
  assert.equal(byKey.cct.offset, 3)
  assert.equal(byKey.dimmer.offset, 4)
  assert.equal(byKey.indexColor.offset, 5)
  assert.equal(byKey.strobe.offset, 6)
  assert.equal(byKey.strobe.type, 'strobe')
})

test('Strobe named values match the documented raw codes', () => {
  const strobe = asteraHeliosProfile14.channels.find((c) => c.key === 'strobe')
  assert.equal(strobe.offRaw, 0) // 0-3 = off
  assert.equal(strobe.randomFastRaw, 4)
  assert.equal(strobe.randomMediumRaw, 5)
  assert.equal(strobe.randomSlowRaw, 6)
})

test('Strobe variable-rate raw<->Hz hits the two documented endpoints', () => {
  assert.equal(strobeRawToHz(7), 0.4)
  assert.equal(strobeRawToHz(255), 25)
  assert.equal(strobeHzToRaw(0.4), 7)
  assert.equal(strobeHzToRaw(25), 255)
})

test('Strobe Hz->raw clamps to the variable-rate range and round-trips', () => {
  assert.equal(strobeHzToRaw(0.1), 7) // below range clamps to the lowest variable raw value
  assert.equal(strobeHzToRaw(100), 255) // above range clamps to max
  const raw = strobeHzToRaw(12.7)
  assert.ok(raw >= 7 && raw <= 255)
  assert.ok(Math.abs(strobeRawToHz(raw) - 12.7) < 0.2)
})
