// ============================================================
// PX4 ULog Parser — Real Flight Log Support
// Parses .ulg files from PX4 autopilot for flight replay
// Reference: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
// ============================================================

export interface ULogMessage {
  timestamp: number;
  name: string;
  data: Record<string, number | string>;
}

export interface ParsedULog {
  version: number;
  timestamp: number;
  messages: ULogMessage[];
  params: Record<string, number | string>;
  info: Record<string, string>;
  vehicleAttitude: AttitudeData[];
  vehicleLocalPosition: PositionData[];
  vehicleGlobalPosition: GPSData[];
  batteryStatus: BatteryData[];
  vehicleStatus: StatusData[];
}

export interface AttitudeData {
  timestamp: number;
  roll: number;
  pitch: number;
  yaw: number;
  rollspeed: number;
  pitchspeed: number;
  yawspeed: number;
}

export interface PositionData {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface GPSData {
  timestamp: number;
  lat: number;
  lon: number;
  alt: number;
  eph: number;
  epv: number;
}

export interface BatteryData {
  timestamp: number;
  voltage: number;
  current: number;
  remaining: number;
  discharged: number;
}

export interface StatusData {
  timestamp: number;
  navState: number;
  armingState: number;
  failsafe: boolean;
}

// ULog file magic bytes
const ULOG_MAGIC = new Uint8Array([0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35]);

// Message types
const MSG_TYPE_FORMAT = 'F'.charCodeAt(0);
const MSG_TYPE_DATA = 'D'.charCodeAt(0);
const MSG_TYPE_INFO = 'I'.charCodeAt(0);
const MSG_TYPE_MULTI_INFO = 'M'.charCodeAt(0);
const MSG_TYPE_PARAM = 'P'.charCodeAt(0);
const MSG_TYPE_ADD_LOGGED = 'A'.charCodeAt(0);
// Reserved for future: MSG_TYPE_REMOVE_LOGGED, MSG_TYPE_SYNC, MSG_TYPE_DROPOUT, MSG_TYPE_LOGGING, MSG_TYPE_FLAG_BITS

interface FormatDefinition {
  name: string;
  fields: { type: string; name: string; arraySize?: number }[];
  size: number;
}

interface Subscription {
  msgId: number;
  formatName: string;
  multiId: number;
}

export async function parseULog(file: File): Promise<ParsedULog> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  // Verify magic
  for (let i = 0; i < 7; i++) {
    if (bytes[i] !== ULOG_MAGIC[i]) {
      throw new Error('Invalid ULog file: magic bytes mismatch');
    }
  }
  
  const version = bytes[7];
  const timestamp = Number(view.getBigUint64(8, true));
  
  const result: ParsedULog = {
    version,
    timestamp,
    messages: [],
    params: {},
    info: {},
    vehicleAttitude: [],
    vehicleLocalPosition: [],
    vehicleGlobalPosition: [],
    batteryStatus: [],
    vehicleStatus: [],
  };
  
  const formats: Map<string, FormatDefinition> = new Map();
  const subscriptions: Map<number, Subscription> = new Map();
  
  let offset = 16; // After header
  
  while (offset < buffer.byteLength - 3) {
    const msgSize = view.getUint16(offset, true);
    const msgType = bytes[offset + 2];
    
    if (offset + 3 + msgSize > buffer.byteLength) break;
    
    const msgData = bytes.slice(offset + 3, offset + 3 + msgSize);
    
    try {
      switch (msgType) {
        case MSG_TYPE_FORMAT:
          parseFormat(msgData, formats);
          break;
        case MSG_TYPE_ADD_LOGGED:
          parseAddLogged(msgData, subscriptions, formats);
          break;
        case MSG_TYPE_DATA:
          parseData(msgData, subscriptions, formats, result);
          break;
        case MSG_TYPE_INFO:
        case MSG_TYPE_MULTI_INFO:
          parseInfo(msgData, result);
          break;
        case MSG_TYPE_PARAM:
          parseParam(msgData, result);
          break;
      }
    } catch (e) {
      // Skip malformed messages
    }
    
    offset += 3 + msgSize;
  }
  
  return result;
}

function parseFormat(data: Uint8Array, formats: Map<string, FormatDefinition>) {
  const str = new TextDecoder().decode(data);
  const colonIdx = str.indexOf(':');
  if (colonIdx === -1) return;
  
  const name = str.slice(0, colonIdx);
  const fieldsStr = str.slice(colonIdx + 1);
  
  const fields: FormatDefinition['fields'] = [];
  let size = 0;
  
  for (const field of fieldsStr.split(';')) {
    if (!field.trim()) continue;
    const parts = field.trim().split(' ');
    if (parts.length < 2) continue;
    
    let type = parts[0];
    let fieldName = parts[1];
    let arraySize: number | undefined;
    
    // Handle arrays like "float[3]"
    const bracketIdx = type.indexOf('[');
    if (bracketIdx !== -1) {
      arraySize = parseInt(type.slice(bracketIdx + 1, -1));
      type = type.slice(0, bracketIdx);
    }
    
    fields.push({ type, name: fieldName, arraySize });
    // Nested message sizes can reference formats declared later, so resolve them at read time.
  }
  
  formats.set(name, { name, fields, size });
}

function parseAddLogged(data: Uint8Array, subs: Map<number, Subscription>, _formats: Map<string, FormatDefinition>) {
  const multiId = data[0];
  const msgId = data[1] | (data[2] << 8);
  const formatName = new TextDecoder().decode(data.slice(3)).replace(/\0/g, '');
  
  subs.set(msgId, { msgId, formatName, multiId });
}

function parseData(data: Uint8Array, subs: Map<number, Subscription>, formats: Map<string, FormatDefinition>, result: ParsedULog) {
  const msgId = data[0] | (data[1] << 8);
  const sub = subs.get(msgId);
  if (!sub) return;
  
  const format = formats.get(sub.formatName);
  if (!format) return;
  
  const view = new DataView(data.buffer, data.byteOffset + 2);
  const record: Record<string, number> = {};
  readFields(view, 0, format.fields, formats, '', record);
  
  // Store in appropriate array based on message type
  const ts = record['timestamp'] || 0;
  
  if (sub.formatName === 'vehicle_attitude') {
    result.vehicleAttitude.push({
      timestamp: ts,
      roll: record['roll'] || 0,
      pitch: record['pitch'] || 0,
      yaw: record['yaw'] || 0,
      rollspeed: record['rollspeed'] || 0,
      pitchspeed: record['pitchspeed'] || 0,
      yawspeed: record['yawspeed'] || 0,
    });
  } else if (sub.formatName === 'vehicle_local_position') {
    result.vehicleLocalPosition.push({
      timestamp: ts,
      x: record['x'] || 0,
      y: record['y'] || 0,
      z: record['z'] || 0,
      vx: record['vx'] || 0,
      vy: record['vy'] || 0,
      vz: record['vz'] || 0,
    });
  } else if (sub.formatName === 'vehicle_global_position') {
    result.vehicleGlobalPosition.push({
      timestamp: ts,
      lat: record['lat'] || 0,
      lon: record['lon'] || 0,
      alt: record['alt'] || 0,
      eph: record['eph'] || 0,
      epv: record['epv'] || 0,
    });
  } else if (sub.formatName === 'battery_status') {
    result.batteryStatus.push({
      timestamp: ts,
      voltage: record['voltage_v'] || record['voltage_filtered_v'] || 0,
      current: record['current_a'] || record['current_filtered_a'] || 0,
      remaining: record['remaining'] || 0,
      discharged: record['discharged_mah'] || 0,
    });
  } else if (sub.formatName === 'vehicle_status') {
    result.vehicleStatus.push({
      timestamp: ts,
      navState: record['nav_state'] || 0,
      armingState: record['arming_state'] || 0,
      failsafe: (record['failsafe'] || 0) !== 0,
    });
  }
}

function parseInfo(data: Uint8Array, result: ParsedULog) {
  const keyLen = data[0];
  const key = new TextDecoder().decode(data.slice(1, 1 + keyLen));
  const value = new TextDecoder().decode(data.slice(1 + keyLen)).replace(/\0/g, '');
  result.info[key] = value;
}

function parseParam(data: Uint8Array, result: ParsedULog) {
  const keyLen = data[0];
  const typedKey = new TextDecoder().decode(data.slice(1, 1 + keyLen));
  const valueData = data.slice(1 + keyLen);
  const parts = typedKey.split(' ');
  const type = parts.shift();
  const key = parts.join(' ');

  // ULog stores the declared parameter type in the key, e.g. "int32_t SYS_AUTOSTART".
  // Both supported parameter types occupy four bytes, so payload length alone is ambiguous.
  if (!key || valueData.length < 4 || (type !== 'int32_t' && type !== 'float')) return;

  const view = new DataView(valueData.buffer, valueData.byteOffset, valueData.byteLength);
  result.params[key] = readValue(view, 0, type);
}

function getPrimitiveTypeSize(type: string): number {
  switch (type) {
    case 'int8_t':
    case 'uint8_t':
    case 'bool':
    case 'char':
      return 1;
    case 'int16_t':
    case 'uint16_t':
      return 2;
    case 'int32_t':
    case 'uint32_t':
    case 'float':
      return 4;
    case 'int64_t':
    case 'uint64_t':
    case 'double':
      return 8;
    default:
      return 0;
  }
}

function readFields(
  view: DataView,
  offset: number,
  fields: FormatDefinition['fields'],
  formats: Map<string, FormatDefinition>,
  prefix: string,
  record: Record<string, number>,
): number {
  let cursor = offset;

  for (const field of fields) {
    const count = field.arraySize || 1;

    for (let i = 0; i < count; i++) {
      const fieldName = count > 1 ? field.name + '[' + i + ']' : field.name;
      const fullName = prefix + fieldName;
      const primitiveSize = getPrimitiveTypeSize(field.type);

      if (primitiveSize > 0) {
        record[fullName] = readValue(view, cursor, field.type);
        cursor += primitiveSize;
        continue;
      }

      const nested = formats.get(field.type);
      if (!nested) throw new Error('Unknown ULog nested type: ' + field.type);
      cursor = readFields(view, cursor, nested.fields, formats, fullName + '.', record);
    }
  }

  return cursor;
}

function readValue(view: DataView, offset: number, type: string): number {
  switch (type) {
    case 'int8_t': return view.getInt8(offset);
    case 'uint8_t': return view.getUint8(offset);
    case 'bool': return view.getUint8(offset);
    case 'int16_t': return view.getInt16(offset, true);
    case 'uint16_t': return view.getUint16(offset, true);
    case 'int32_t': return view.getInt32(offset, true);
    case 'uint32_t': return view.getUint32(offset, true);
    case 'float': return view.getFloat32(offset, true);
    case 'int64_t': return Number(view.getBigInt64(offset, true));
    case 'uint64_t': return Number(view.getBigUint64(offset, true));
    case 'double': return view.getFloat64(offset, true);
    case 'char': return view.getInt8(offset);
    default: throw new Error('Unsupported ULog primitive type: ' + type);
  }
}

// Convert parsed ULog to our TelemetryFrame format
export function ulogToTelemetry(ulog: ParsedULog): import('./algorithms').TelemetryFrame[] {
  const frames: import('./algorithms').TelemetryFrame[] = [];
  
  // Determine start timestamp
  const startTs = Math.min(
    ulog.vehicleAttitude[0]?.timestamp || Infinity,
    ulog.vehicleLocalPosition[0]?.timestamp || Infinity,
    ulog.vehicleGlobalPosition[0]?.timestamp || Infinity,
  );
  
  // Sample at ~10Hz
  const sampleInterval = 100000; // 100ms in microseconds
  const endTs = Math.max(
    ulog.vehicleAttitude[ulog.vehicleAttitude.length - 1]?.timestamp || 0,
    ulog.vehicleLocalPosition[ulog.vehicleLocalPosition.length - 1]?.timestamp || 0,
  );
  
  for (let ts = startTs; ts <= endTs; ts += sampleInterval) {
    const att = findClosest(ulog.vehicleAttitude, ts);
    const pos = findClosest(ulog.vehicleLocalPosition, ts);
    const gps = findClosest(ulog.vehicleGlobalPosition, ts);
    const bat = findClosest(ulog.batteryStatus, ts);
    const status = findClosest(ulog.vehicleStatus, ts);
    
    frames.push({
      t: (ts - startTs) / 1e6,
      altitude: pos ? -pos.z : 0,
      speed: pos ? Math.sqrt(pos.vx ** 2 + pos.vy ** 2 + pos.vz ** 2) : 0,
      battery: bat ? bat.remaining * 100 : 100,
      lat: gps?.lat || 0,
      lng: gps?.lon || 0,
      heading: att ? (att.yaw * 180 / Math.PI + 360) % 360 : 0,
      roll: att ? att.roll * 180 / Math.PI : 0,
      pitch: att ? att.pitch * 180 / Math.PI : 0,
      mode: getNavStateName(status?.navState || 0),
      decision: status?.failsafe ? 'FAILSAFE ACTIVE' : 'Autonomous navigation',
    });
  }
  
  return frames;
}

function findClosest<T extends { timestamp: number }>(arr: T[], ts: number): T | null {
  if (arr.length === 0) return null;
  
  let left = 0, right = arr.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid].timestamp < ts) left = mid + 1;
    else right = mid;
  }
  
  if (left > 0 && Math.abs(arr[left - 1].timestamp - ts) < Math.abs(arr[left].timestamp - ts)) {
    return arr[left - 1];
  }
  return arr[left];
}

function getNavStateName(state: number): string {
  const states: Record<number, string> = {
    0: 'MANUAL',
    1: 'ALTCTL',
    2: 'POSCTL',
    3: 'AUTO_MISSION',
    4: 'AUTO_LOITER',
    5: 'AUTO_RTL',
    6: 'ACRO',
    7: 'OFFBOARD',
    8: 'STAB',
    9: 'AUTO_TAKEOFF',
    10: 'AUTO_LAND',
    11: 'AUTO_FOLLOW',
    12: 'AUTO_PRECLAND',
  };
  return states[state] || `NAV_${state}`;
}
