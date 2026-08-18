import { test } from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { ArtnetSender } from '../src/artnet-sender.js'

function listenOnce(socket) {
  return new Promise((resolve) => {
    socket.once('message', (msg) => resolve(msg))
  })
}

async function withListener(fn) {
  const listener = dgram.createSocket('udp4')
  await new Promise((resolve) => listener.bind(0, '127.0.0.1', resolve))
  const port = listener.address().port
  try {
    await fn(listener, port)
  } finally {
    listener.close()
  }
}

test('sends a well-formed ArtDMX packet with values at the right offsets', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    const messagePromise = listenOnce(listener)
    sender.setChannels(0, 1, [255, 128, 0])
    const msg = await messagePromise

    assert.equal(msg.toString('ascii', 0, 8), 'Art-Net\0')
    assert.equal(msg.readUInt16LE(8), 0x5000) // OpCode ArtDMX
    assert.equal(msg.readUInt8(10), 0) // ProtVerHi
    assert.equal(msg.readUInt8(11), 14) // ProtVerLo
    assert.equal(msg.readUInt8(13), 0) // Physical
    assert.equal(msg.readUInt8(14), 0) // SubUni for universe 0
    assert.equal(msg.readUInt8(15), 0) // Net for universe 0
    assert.equal(msg.readUInt16BE(16), 512) // Length

    const data = msg.subarray(18, 18 + 512)
    assert.equal(data[0], 255)
    assert.equal(data[1], 128)
    assert.equal(data[2], 0)
    assert.equal(data[3], 0) // untouched channel stays 0

    sender.destroy()
  })
})

test('splits universe 0-32767 into Net/SubUni correctly', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    // universe 300 = Net 1, SubUni 44  (300 = 0x012C -> high byte 0x01, low byte 0x2C)
    const messagePromise = listenOnce(listener)
    sender.setChannels(300, 1, [1])
    const msg = await messagePromise

    assert.equal(msg.readUInt8(14), 0x2c) // SubUni
    assert.equal(msg.readUInt8(15), 0x01) // Net

    sender.destroy()
  })
})

test('setChannels merges into the universe without clobbering previously set channels', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    let messagePromise = listenOnce(listener)
    sender.setChannels(0, 1, [10, 20, 30])
    await messagePromise

    messagePromise = listenOnce(listener)
    sender.setChannels(0, 5, [99]) // channel 5 only, 1-based
    const msg = await messagePromise
    const data = msg.subarray(18, 18 + 512)

    assert.equal(data[0], 10)
    assert.equal(data[1], 20)
    assert.equal(data[2], 30)
    assert.equal(data[4], 99) // channel 5 = index 4

    sender.destroy()
  })
})

test('increments sequence number per universe and wraps after 255', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    let last = 0
    for (let i = 0; i < 257; i++) {
      const messagePromise = listenOnce(listener)
      sender.setChannels(0, 1, [i & 0xff])
      const msg = await messagePromise
      last = msg.readUInt8(12)
    }
    assert.equal(last, 2) // 257 sends: 1,2,...,255,1,2 -> last is 2

    sender.destroy()
  })
})

test('setChannels skips undefined holes instead of zeroing them out (sparse per-channel updates)', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    let messagePromise = listenOnce(listener)
    sender.setChannels(0, 1, [255, 128, 64]) // set red/green/blue
    await messagePromise

    // simulate a granular "set CCT only" action: sparse array with holes for red/green/blue
    messagePromise = listenOnce(listener)
    sender.setChannels(0, 1, [undefined, undefined, undefined, 42])
    const msg = await messagePromise
    const data = msg.subarray(18, 18 + 512)

    assert.equal(data[0], 255, 'red must survive a sparse update that does not touch it')
    assert.equal(data[1], 128, 'green must survive a sparse update that does not touch it')
    assert.equal(data[2], 64, 'blue must survive a sparse update that does not touch it')
    assert.equal(data[3], 42, 'cct channel is set by the sparse update')

    sender.destroy()
  })
})

test('rejects out-of-range universe and start channel', async () => {
  const sender = new ArtnetSender({ host: '127.0.0.1', port: 6454, refreshIntervalMs: 0 })
  assert.throws(() => sender.setChannels(-1, 1, [0]), RangeError)
  assert.throws(() => sender.setChannels(32768, 1, [0]), RangeError)
  assert.throws(() => sender.setChannels(0, 0, [0]), RangeError)
  assert.throws(() => sender.setChannels(0, 513, [0]), RangeError)
  sender.destroy()
})

function noMessageWithin(listener, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    listener.once('message', () => {
      clearTimeout(timer)
      reject(new Error('unexpected packet received'))
    })
  })
}

test('mergeChannels updates the buffer but does not send until flushAll() is called', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    sender.mergeChannels(0, 1, [255, 0, 0])
    await noMessageWithin(listener, 50)

    const messagePromise = listenOnce(listener)
    sender.flushAll()
    const msg = await messagePromise
    assert.equal(msg.subarray(18, 18 + 3)[0], 255)

    sender.destroy()
  })
})

test('multiple mergeChannels calls before one flushAll() coalesce into a single packet with all values applied', async () => {
  await withListener(async (listener, port) => {
    const sender = new ArtnetSender({ host: '127.0.0.1', port, refreshIntervalMs: 0 })
    await sender.ready

    sender.mergeChannels(0, 1, [10, 20, 30]) // fixture 1 at channels 1-3
    sender.mergeChannels(0, 7, [40, 50, 60]) // fixture 2 at channels 7-9

    let packetCount = 0
    listener.on('message', () => packetCount++)

    const messagePromise = listenOnce(listener)
    sender.flushAll()
    const msg = await messagePromise
    const data = msg.subarray(18, 18 + 512)

    assert.equal(data[0], 10)
    assert.equal(data[1], 20)
    assert.equal(data[2], 30)
    assert.equal(data[6], 40)
    assert.equal(data[7], 50)
    assert.equal(data[8], 60)

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(packetCount, 1, 'both merges must have been coalesced into one packet, not two')

    sender.destroy()
  })
})
