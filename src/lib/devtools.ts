/** Pure conversion helpers for the developer toolbox. No Node or Tauri APIs are required. */

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function formatJson(input: string, indent: number): string {
  if (!Number.isInteger(indent) || indent < 0 || indent > 10) {
    throw new Error('JSON indentation must be an integer from 0 to 10.')
  }
  return JSON.stringify(parseJson(input), null, indent)
}

export function minifyJson(input: string): string {
  return JSON.stringify(parseJson(input))
}

/** Converts signed integers of arbitrary size. Output uses lowercase letters. */
export function convertBase(value: string, fromBase: number, toBase: number): string {
  if (!Number.isInteger(fromBase) || fromBase < 2 || fromBase > 36) {
    throw new Error('Source base must be an integer from 2 to 36.')
  }
  if (!Number.isInteger(toBase) || toBase < 2 || toBase > 36) {
    throw new Error('Target base must be an integer from 2 to 36.')
  }

  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  let digits = /^[+-]/.test(trimmed) ? trimmed.slice(1) : trimmed
  const prefix = fromBase === 16 ? '0x' : fromBase === 2 ? '0b' : fromBase === 8 ? '0o' : null
  if (prefix && digits.toLowerCase().startsWith(prefix)) digits = digits.slice(2)
  if (!digits) throw new Error('Enter an integer to convert.')

  let result = 0n
  for (const character of digits.toLowerCase()) {
    const code = character.charCodeAt(0)
    const digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 122 ? code - 87 : -1
    if (digit < 0 || digit >= fromBase) {
      throw new Error(`Digit "${character}" is invalid in base ${fromBase}.`)
    }
    result = result * BigInt(fromBase) + BigInt(digit)
  }
  return `${negative && result !== 0n ? '-' : ''}${result.toString(toBase)}`
}

const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000n

/** In auto mode, up to 10 digits means seconds and 13+ digits means milliseconds. */
export function parseTimestamp(input: string, unit: 'auto' | 's' | 'ms'): Date {
  const trimmed = input.trim()
  const match = /^[+-]?(\d+)$/.exec(trimmed)
  if (!match) throw new Error('Timestamp must be a signed integer.')
  if (unit !== 'auto' && unit !== 's' && unit !== 'ms') {
    throw new Error('Timestamp unit must be auto, s, or ms.')
  }

  let resolvedUnit = unit
  if (unit === 'auto') {
    if (match[1].length <= 10) resolvedUnit = 's'
    else if (match[1].length >= 13) resolvedUnit = 'ms'
    else throw new Error('An 11- or 12-digit timestamp is ambiguous; choose seconds or milliseconds.')
  }
  const milliseconds = BigInt(trimmed) * (resolvedUnit === 's' ? 1000n : 1n)
  if (milliseconds < -MAX_DATE_MILLISECONDS || milliseconds > MAX_DATE_MILLISECONDS) {
    throw new Error('Timestamp is outside the supported date range.')
  }
  return new Date(Number(milliseconds))
}

const DATE_INPUT_RE = /^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?)?$/i

/** Formats a local date-time, optionally retaining its UTC offset for unambiguous round trips. */
export function formatLocalDateTime(date: Date, includeOffset = false): string {
  if (Number.isNaN(date.getTime())) throw new Error('Date is outside the supported range.')
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const formattedYear = year >= 0 && year <= 9999
    ? String(year).padStart(4, '0')
    : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`
  const milliseconds = date.getMilliseconds()
  const local = `${formattedYear}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : ''}`
  if (!includeOffset) return local
  const wallClockAsUtc = new Date(0)
  wallClockAsUtc.setUTCFullYear(year, date.getMonth(), date.getDate())
  wallClockAsUtc.setUTCHours(date.getHours(), date.getMinutes(), date.getSeconds(), milliseconds)
  const offsetSeconds = Number.isNaN(wallClockAsUtc.getTime())
    ? -date.getTimezoneOffset() * 60
    : Math.round((wallClockAsUtc.getTime() - date.getTime()) / 1000)
  const absoluteOffset = Math.abs(offsetSeconds)
  return `${local}${offsetSeconds < 0 ? '-' : '+'}${pad(Math.floor(absoluteOffset / 3600))}:${pad(Math.floor(absoluteOffset / 60) % 60)}${absoluteOffset % 60 ? `:${pad(absoluteOffset % 60)}` : ''}`
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function daysSinceEpoch(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(adjustedYear / 400)
  const yearOfEra = adjustedYear - era * 400
  const adjustedMonth = month + (month > 2 ? -3 : 9)
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1
  const yearDays = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + yearDays - 719468
}

/** Accepts ISO dates and ISO/local date-times; rejects calendar overflow and DST gaps. */
export function parseDateInput(input: string): Date {
  const match = DATE_INPUT_RE.exec(input.trim())
  if (!match) throw new Error('Date must use YYYY-MM-DD or ISO date-time format.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4] ?? 0)
  const minute = Number(match[5] ?? 0)
  const second = Number(match[6] ?? 0)
  const millisecond = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3))
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error('Date contains an invalid calendar day.')
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error('Date contains an invalid time.')
  }

  let date: Date
  if (match[8]) {
    let offsetSeconds = 0
    if (match[8].toUpperCase() !== 'Z') {
      const offsetHour = Number(match[10])
      const offsetMinute = Number(match[11])
      const offsetSecond = Number(match[12] ?? 0)
      if (offsetHour > 23 || offsetMinute > 59 || offsetSecond > 59) {
        throw new Error('Date contains an invalid timezone offset.')
      }
      const direction = match[9] === '+' ? 1 : -1
      offsetSeconds = direction * (offsetHour * 3600 + offsetMinute * 60 + offsetSecond)
    }
    const milliseconds = daysSinceEpoch(year, month, day) * 86_400_000 +
      (hour * 3600 + minute * 60 + second - offsetSeconds) * 1000 + millisecond
    date = new Date(milliseconds)
  } else {
    date = new Date(0)
    date.setFullYear(year, month - 1, day)
    date.setHours(hour, minute, second, millisecond)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
        date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
      throw new Error('Date does not exist in the local timezone.')
    }
  }
  if (Number.isNaN(date.getTime())) throw new Error('Date is outside the supported range.')
  return date
}

/** Adds calendar units in local time. Months and years clamp to the target month's last day. */
export function addDate(input: string, amount: number, unit: 'days' | 'weeks' | 'months' | 'years'): Date {
  if (!Number.isSafeInteger(amount)) throw new Error('Date amount must be a safe integer.')
  const date = parseDateInput(input)
  if (unit === 'days' || unit === 'weeks') {
    const days = unit === 'weeks' ? amount * 7 : amount
    if (!Number.isSafeInteger(days)) throw new Error('Date amount is too large.')
    date.setDate(date.getDate() + days)
  } else if (unit === 'months' || unit === 'years') {
    const months = unit === 'years' ? amount * 12 : amount
    if (!Number.isSafeInteger(months)) throw new Error('Date amount is too large.')
    const originalDay = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + months)
    if (Number.isNaN(date.getTime())) throw new Error('Date calculation is outside the supported range.')
    const lastDay = new Date(date.getTime())
    lastDay.setMonth(lastDay.getMonth() + 1, 0)
    date.setDate(Math.min(originalDay, lastDay.getDate()))
  } else {
    throw new Error('Date unit must be days, weeks, months, or years.')
  }
  if (Number.isNaN(date.getTime())) throw new Error('Date calculation is outside the supported range.')
  return date
}

export interface DateDifference {
  milliseconds: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

/** Signed elapsed time from a to b; larger units may contain fractions. */
export function dateDifference(a: string, b: string): DateDifference {
  const milliseconds = parseDateInput(b).getTime() - parseDateInput(a).getTime()
  return {
    milliseconds,
    days: milliseconds / 86_400_000,
    hours: milliseconds / 3_600_000,
    minutes: milliseconds / 60_000,
    seconds: milliseconds / 1000,
  }
}

export type IpCategory =
  | 'public'
  | 'private'
  | 'shared'
  | 'loopback'
  | 'link-local'
  | 'multicast'
  | 'unspecified'
  | 'broadcast'
  | 'documentation'
  | 'benchmarking'
  | 'unique-local'
  | 'ipv4-mapped'
  | 'reserved'

export interface IpAnalysis {
  version: 4 | 6
  /** Canonical host address without a prefix. */
  normalized: string
  /** Category of the host address, not of the whole network range. */
  category: IpCategory
  /** Null if the input has no CIDR suffix. */
  prefixLength: number | null
  /** Canonical network/prefix, or null if the input has no CIDR suffix. */
  cidr: string | null
  networkAddress: string
  firstAddress: string
  lastAddress: string
  /** Decimal string because IPv6 ranges can exceed Number.MAX_SAFE_INTEGER. */
  addressCount: string
  /** Full eight-group IPv6 representation. */
  expanded?: string
  /** Shortest IPv6 representation. Equals normalized for IPv6. */
  compressed?: string
}

function parseIpv4(address: string): bigint {
  const octets = address.split('.')
  if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9]\d{0,2})$/.test(octet))) {
    throw new Error('Invalid IPv4 address: expected four decimal octets.')
  }
  const numbers = octets.map(Number)
  if (numbers.some((octet) => octet > 255)) {
    throw new Error('Invalid IPv4 address: each octet must be from 0 to 255.')
  }
  return numbers.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n)
}

function formatIpv4(address: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String(Number((address >> shift) & 255n))).join('.')
}

function parseIpv6(address: string): bigint {
  let source = address
  if (source.includes('.')) {
    const separator = source.lastIndexOf(':')
    if (separator < 0) throw new Error('Invalid IPv6 address: embedded IPv4 must be the final component.')
    const embedded = parseIpv4(source.slice(separator + 1))
    source = `${source.slice(0, separator + 1)}${((embedded >> 16n) & 0xffffn).toString(16)}:${(embedded & 0xffffn).toString(16)}`
  }

  const compression = source.indexOf('::')
  if (compression !== -1 && source.indexOf('::', compression + 2) !== -1) {
    throw new Error('Invalid IPv6 address: multiple compression markers.')
  }
  const left = compression === -1 ? source.split(':') : source.slice(0, compression).split(':').filter(Boolean)
  const right = compression === -1 ? [] : source.slice(compression + 2).split(':').filter(Boolean)
  // Filtering only removes the empty sides of ::; an extra colon is still invalid.
  if (compression !== -1 && (source.slice(0, compression).includes('::') || source.slice(compression + 2).includes('::') ||
      left.join(':') !== source.slice(0, compression) || right.join(':') !== source.slice(compression + 2))) {
    throw new Error('Invalid IPv6 address: misplaced colon.')
  }
  if (left.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group)) ||
      right.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group)) ||
      (compression === -1 && left.length !== 8) ||
      (compression !== -1 && left.length + right.length >= 8)) {
    throw new Error('Invalid IPv6 address: expected eight hexadecimal groups.')
  }
  const groups = [...left, ...Array<string>(compression === -1 ? 0 : 8 - left.length - right.length).fill('0'), ...right]
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n)
}

function ipv6Groups(address: bigint): number[] {
  return Array.from({ length: 8 }, (_, index) => Number((address >> BigInt((7 - index) * 16)) & 0xffffn))
}

function formatIpv6Expanded(address: bigint): string {
  return ipv6Groups(address).map((group) => group.toString(16).padStart(4, '0')).join(':')
}

function formatIpv6Compressed(address: bigint): string {
  const groups = ipv6Groups(address)
  let bestStart = -1
  let bestLength = 1
  for (let index = 0; index < 8;) {
    if (groups[index] !== 0) {
      index += 1
      continue
    }
    let end = index + 1
    while (end < 8 && groups[end] === 0) end += 1
    if (end - index > bestLength) {
      bestStart = index
      bestLength = end - index
    }
    index = end
  }
  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(':')
  const before = groups.slice(0, bestStart).map((group) => group.toString(16)).join(':')
  const after = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(':')
  return `${before}::${after}`
}

function inRange(address: bigint, network: bigint, prefix: number, width: number): boolean {
  return (address >> BigInt(width - prefix)) === (network >> BigInt(width - prefix))
}

function categoryIpv4(address: bigint): IpCategory {
  if (address === 0n) return 'unspecified'
  if (address === 0xffff_ffffn) return 'broadcast'
  if (inRange(address, 0x0a00_0000n, 8, 32) || inRange(address, 0xac10_0000n, 12, 32) ||
      inRange(address, 0xc0a8_0000n, 16, 32)) return 'private'
  if (inRange(address, 0x6440_0000n, 10, 32)) return 'shared'
  if (inRange(address, 0x7f00_0000n, 8, 32)) return 'loopback'
  if (inRange(address, 0xa9fe_0000n, 16, 32)) return 'link-local'
  if (inRange(address, 0xc000_0200n, 24, 32) || inRange(address, 0xc633_6400n, 24, 32) ||
      inRange(address, 0xcb00_7100n, 24, 32)) return 'documentation'
  if (inRange(address, 0xc612_0000n, 15, 32)) return 'benchmarking'
  if (inRange(address, 0xe000_0000n, 4, 32)) return 'multicast'
  if (inRange(address, 0x0000_0000n, 8, 32) || inRange(address, 0xc000_0000n, 24, 32) ||
      inRange(address, 0xf000_0000n, 4, 32)) return 'reserved'
  return 'public'
}

function categoryIpv6(address: bigint): IpCategory {
  if (address === 0n) return 'unspecified'
  if (address === 1n) return 'loopback'
  if (inRange(address, 0xffffn << 32n, 96, 128)) return 'ipv4-mapped'
  if (inRange(address, 0xfc00n << 112n, 7, 128)) return 'unique-local'
  if (inRange(address, 0xfe80n << 112n, 10, 128)) return 'link-local'
  if (inRange(address, 0xff00n << 112n, 8, 128)) return 'multicast'
  if (inRange(address, 0x2001_0db8n << 96n, 32, 128)) return 'documentation'
  if (inRange(address, 0x2000n << 112n, 3, 128)) return 'public'
  return 'reserved'
}

/** Parses IPv4/IPv6 hosts and CIDR networks, including IPv4-embedded IPv6. */
export function analyzeIp(input: string): IpAnalysis {
  const parts = input.trim().split('/')
  if (parts.length > 2 || !parts[0]) throw new Error('Enter one IPv4 or IPv6 address with an optional CIDR prefix.')
  const version = parts[0].includes(':') ? 6 : 4
  const width = version === 4 ? 32 : 128
  const address = version === 4 ? parseIpv4(parts[0]) : parseIpv6(parts[0])
  let prefixLength: number | null = null
  if (parts.length === 2) {
    if (!/^(0|[1-9]\d*)$/.test(parts[1])) throw new Error('CIDR prefix must be a nonnegative integer.')
    prefixLength = Number(parts[1])
    if (!Number.isSafeInteger(prefixLength) || prefixLength > width) {
      throw new Error(`CIDR prefix must be from 0 to ${width} for IPv${version}.`)
    }
  }
  const effectivePrefix = prefixLength ?? width
  const mask = ((1n << BigInt(effectivePrefix)) - 1n) << BigInt(width - effectivePrefix)
  const network = address & mask
  const last = network | (((1n << BigInt(width)) - 1n) ^ mask)
  const format = version === 4 ? formatIpv4 : formatIpv6Compressed
  const normalized = format(address)
  const networkAddress = format(network)
  return {
    version,
    normalized,
    category: version === 4 ? categoryIpv4(address) : categoryIpv6(address),
    prefixLength,
    cidr: prefixLength === null ? null : `${networkAddress}/${prefixLength}`,
    networkAddress,
    firstAddress: networkAddress,
    lastAddress: format(last),
    addressCount: (1n << BigInt(width - effectivePrefix)).toString(),
    ...(version === 6 ? { expanded: formatIpv6Expanded(address), compressed: normalized } : {}),
  }
}

/** Encodes Unicode text as UTF-8 Base64. */
export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/** Decodes standard Base64 with optional padding and rejects malformed UTF-8. */
export function decodeBase64(input: string): string {
  const source = input.trim()
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(source)) {
    throw new Error('Invalid Base64: use the standard alphabet with optional padding.')
  }
  let binary: string
  try {
    binary = atob(source.padEnd(Math.ceil(source.length / 4) * 4, '='))
  } catch {
    throw new Error('Invalid Base64 data.')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Base64 data is not valid UTF-8 text.')
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', euro: '\u20ac',
  cent: '\u00a2', pound: '\u00a3', yen: '\u00a5', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022',
}

export function encodeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

/** Decodes numeric references and common named entities in a single pass. */
export function decodeHtml(input: string): string {
  return input.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (entity, content: string) => {
    if (content.startsWith('#')) {
      const hex = content[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(content.slice(hex ? 2 : 1), hex ? 16 : 10)
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : entity
    }
    return HTML_ENTITIES[content.toLowerCase()] ?? entity
  })
}

export interface DecodedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
}

/** Decodes a compact JWT for inspection. This does not verify its signature. */
export function decodeJwt(input: string): DecodedJwt {
  const segments = input.trim().split('.')
  if (segments.length !== 3 || !segments[0] || !segments[1]) {
    throw new Error('JWT must contain header, payload, and signature segments.')
  }
  const decodeSegment = (segment: string, label: string): Record<string, unknown> => {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error(`Invalid JWT ${label} encoding.`)
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    if (base64.length % 4 === 1) throw new Error(`Invalid JWT ${label} encoding.`)
    let parsed: unknown
    try {
      parsed = JSON.parse(decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as unknown
    } catch (error) {
      throw new Error(`Invalid JWT ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`JWT ${label} must be a JSON object.`)
    }
    return parsed as Record<string, unknown>
  }
  if (segments[2] && (!/^[A-Za-z0-9_-]+$/.test(segments[2]) || segments[2].length % 4 === 1)) {
    throw new Error('Invalid JWT signature encoding.')
  }
  return { header: decodeSegment(segments[0], 'header'), payload: decodeSegment(segments[1], 'payload'), signature: segments[2] }
}
