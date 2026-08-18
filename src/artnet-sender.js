import dgram from 'node:dgram'

const ARTNET_HEADER = Buffer.from('Art-Net\0', 'ascii')
const OPCODE_ARTDMX = 0x5000
const PROTOCOL_VERSION = 14
const UNIVERSE_SIZE = 512

/**
 * Builds and sends Art-Net ArtDMX packets, and keeps a per-universe buffer of
 * last-known channel values so single-channel updates don't clobber the rest
 * of the universe.
 *
 * "universe" here is the full 15-bit Art-Net Port-Address (0-32767), the way
 * most lighting software presents it as one number instead of separate
 * Net/Sub-Net/Universe fields:
 *   SubUni (low byte)  = universe & 0xFF
 *   Net    (high byte) = (universe >> 8) & 0x7F
 */
export class ArtnetSender {
  /**
   * @param {Object} opts
   * @param {string} opts.host
   * @param {number} opts.port
   * @param {boolean} opts.broadcast
   * @param {number} opts.refreshIntervalMs 0 disables the refresh timer
   */
  constructor({ host, port = 6454, broadcast = false, refreshIntervalMs = 1000 }) {
    this.host = host
    this.port = port
    this.broadcast = broadcast
    this.refreshIntervalMs = refreshIntervalMs

    /** @type {Map<number, Uint8Array>} */
    this.universes = new Map()
    /** @type {Map<number, number>} */
    this.sequences = new Map()

    this.socket = dgram.createSocket('udp4')
    this.socket.unref?.()
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('error', reject)
      this.socket.bind(() => {
        if (this.broadcast) {
          try {
            this.socket.setBroadcast(true)
          } catch {
            // some platforms/sockets don't need or allow this; sending will still work for unicast
          }
        }
        this.socket.removeListener('error', reject)
        resolve()
      })
    })

    this.refreshTimer = null
    if (this.refreshIntervalMs > 0) {
      this.refreshTimer = setInterval(() => this.#refreshAll(), this.refreshIntervalMs)
      this.refreshTimer.unref?.()
    }
  }

  #getUniverseBuffer(universe) {
    let buf = this.universes.get(universe)
    if (!buf) {
      buf = new Uint8Array(UNIVERSE_SIZE)
      this.universes.set(universe, buf)
    }
    return buf
  }

  #nextSequence(universe) {
    let seq = (this.sequences.get(universe) ?? 0) + 1
    if (seq > 255) seq = 1
    this.sequences.set(universe, seq)
    return seq
  }

  #mergeIntoBuffer(universe, startChannel, values) {
    if (universe < 0 || universe > 32767) {
      throw new RangeError(`universe out of range: ${universe}`)
    }
    if (startChannel < 1 || startChannel > UNIVERSE_SIZE) {
      throw new RangeError(`startChannel out of range: ${startChannel}`)
    }

    const buf = this.#getUniverseBuffer(universe)
    const startIndex = startChannel - 1
    for (let i = 0; i < values.length; i++) {
      const idx = startIndex + i
      if (idx >= UNIVERSE_SIZE) break
      if (values[i] === undefined) continue // sparse arrays leave other channels untouched
      buf[idx] = values[i] & 0xff
    }

    return buf
  }

  /**
   * Merge values into a universe (1-based startChannel) and send immediately.
   * @param {number} universe 0-32767
   * @param {number} startChannel 1-512
   * @param {number[]|Uint8Array} values 0-255 each
   */
  setChannels(universe, startChannel, values) {
    const buf = this.#mergeIntoBuffer(universe, startChannel, values)
    this.#send(universe, buf)
  }

  /**
   * Merge values into a universe but don't send yet — for batching many updates (e.g.
   * one animation tick touching several fixtures on the same universe) into a single
   * packet via a following flushAll() call.
   */
  mergeChannels(universe, startChannel, values) {
    this.#mergeIntoBuffer(universe, startChannel, values)
  }

  /** Send the current buffer for every universe that has ever been touched. */
  flushAll() {
    for (const [universe, buf] of this.universes) {
      this.#send(universe, buf)
    }
  }

  #refreshAll() {
    this.flushAll()
  }

  #send(universe, buf) {
    const packet = Buffer.alloc(ARTNET_HEADER.length + 2 + 2 + 1 + 1 + 2 + 2 + UNIVERSE_SIZE)
    let offset = 0

    ARTNET_HEADER.copy(packet, offset)
    offset += ARTNET_HEADER.length

    packet.writeUInt16LE(OPCODE_ARTDMX, offset)
    offset += 2

    packet.writeUInt8(0, offset) // ProtVerHi
    offset += 1
    packet.writeUInt8(PROTOCOL_VERSION, offset) // ProtVerLo
    offset += 1

    packet.writeUInt8(this.#nextSequence(universe), offset)
    offset += 1

    packet.writeUInt8(0, offset) // Physical
    offset += 1

    const subUni = universe & 0xff
    const net = (universe >> 8) & 0x7f
    packet.writeUInt8(subUni, offset)
    offset += 1
    packet.writeUInt8(net, offset)
    offset += 1

    packet.writeUInt8((UNIVERSE_SIZE >> 8) & 0xff, offset) // LengthHi
    offset += 1
    packet.writeUInt8(UNIVERSE_SIZE & 0xff, offset) // LengthLo
    offset += 1

    Buffer.from(buf).copy(packet, offset)

    this.socket.send(packet, this.port, this.host)
  }

  destroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.socket.close()
  }
}
