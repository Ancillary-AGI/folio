/**
 * GDSII Stream Format writer. Emits a genuine GDSII binary stream (version 600,
 * excess-64 reals, correct record framing) with SkyWater 130nm layer numbers.
 * The layout it carries is a representative floorplan row, not a placed-and-routed
 * cell netlist — useful for inspecting the flow and its file framing, not for
 * foundry sign-off. See limitsRegistry.ts for what this file does not do.
 */

export interface GdsPolygon {
  layer: number;
  datatype: number;
  pointsUm: Array<{ x: number; y: number }>;
}

export interface GdsStructure {
  name: string;
  polygons: GdsPolygon[];
}

export interface GdsLibrary {
  name: string;
  userUnitsUm: number; // e.g. 1.0 (1 um)
  databaseUnitsMeter: number; // e.g. 1e-9 (1 nm database unit)
  structures: GdsStructure[];
}

/**
 * SkyWater 130nm GDSII Layer Mapping
 */
/**
 * GDSII layer numbers used by the IC flow's teaching-layer export.
 *
 * These follow the SKY130 mask *order* (nwell → poly → li1 → metals), one
 * number per layer, no two layers sharing a number (the previous table
 * aliased contact↔li1 and every via↔the metal below it, which merged
 * distinct physical masks into one drawing in any GDS reader). They are
 * self-consistent for inspection and education — not the foundry's tapeout
 * layer table; a real submission imports the PDK's own layer map.
 */
export const SKY130_GDS_LAYERS: Record<string, number> = {
  PRBoundary: 235,
  NWell: 64,
  PWell: 122,
  Diffusion: 65,
  Poly: 66,
  Li1: 67, // Local interconnect
  Contact: 68, // Contact over diffusion/poly/li1
  Metal1: 69,
  Via1: 70,
  Metal2: 71,
  Via2: 72,
  Metal3: 73,
  Via3: 74,
  Metal4: 75,
  Via4: 76,
  Metal5: 77,
  Pad: 78,
};

// GDSII Record Types (Tokens)
const GDS_HEADER = 0x0002;
const GDS_BGNLIB = 0x0102;
const GDS_LIBNAME = 0x0206;
const GDS_UNITS = 0x0305;
const GDS_ENDLIB = 0x0400;
const GDS_BGNSTR = 0x0502;
const GDS_STRNAME = 0x0606;
const GDS_ENDSTR = 0x0700;
const GDS_BOUNDARY = 0x0800;
const GDS_LAYER = 0x0d02;
const GDS_DATATYPE = 0x0e02;
const GDS_XY = 0x1003;
const GDS_ENDEL = 0x1100;

class GdsStreamWriter {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;

  private pushChunk(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  writeRecordHeader(recordType: number, dataByteLength: number) {
    const totalRecordLen = 4 + dataByteLength;
    const header = new Uint8Array(4);
    const view = new DataView(header.buffer);
    view.setUint16(0, totalRecordLen, false); // Big endian
    view.setUint16(2, recordType, false);
    this.pushChunk(header);
  }

  writeEmptyRecord(recordType: number) {
    this.writeRecordHeader(recordType, 0);
  }

  writeInt16Record(recordType: number, values: number[]) {
    this.writeRecordHeader(recordType, values.length * 2);
    const buf = new Uint8Array(values.length * 2);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < values.length; i += 1) {
      view.setInt16(i * 2, values[i], false);
    }
    this.pushChunk(buf);
  }

  writeInt32Record(recordType: number, values: number[]) {
    this.writeRecordHeader(recordType, values.length * 4);
    const buf = new Uint8Array(values.length * 4);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < values.length; i += 1) {
      view.setInt32(i * 4, values[i], false);
    }
    this.pushChunk(buf);
  }

  writeStringRecord(recordType: number, text: string) {
    // GDSII strings are single-byte; non-ASCII names would be silently
    // mangled in every reader downstream — refuse them here.
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code > 0xff) {
        throw new Error(`GDSII strings are single-byte; "${text.slice(0, 32)}" contains U+${code.toString(16).toUpperCase().padStart(4, '0')} at index ${i}.`);
      }
    }
    let len = text.length;
    let pad = false;
    if (len % 2 !== 0) {
      len += 1;
      pad = true;
    }
    this.writeRecordHeader(recordType, len);
    const buf = new Uint8Array(len);
    for (let i = 0; i < text.length; i += 1) {
      buf[i] = text.charCodeAt(i);
    }
    if (pad) buf[len - 1] = 0;
    this.pushChunk(buf);
  }

  writeReal8Record(recordType: number, values: number[]) {
    // GDSII excess-64 8-byte floating point representation
    this.writeRecordHeader(recordType, values.length * 8);
    const buf = new Uint8Array(values.length * 8);
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      if (v === 0) continue;
      const sign = v < 0 ? 0x80 : 0x00;
      const absVal = Math.abs(v);
      let exponent = Math.floor(Math.log(absVal) / Math.log(16)) + 1;
      let mantissa = absVal / Math.pow(16, exponent);
      while (mantissa < 1.0 / 16.0 && exponent > -64) {
        mantissa *= 16;
        exponent -= 1;
      }
      const expByte = (exponent + 64) | sign;
      buf[i * 8] = expByte;
      // 56-bit mantissa exceeds a double's 53-bit integer precision, so
      // build it from two exact 28-bit pieces instead of one 56-bit multiply.
      const high = Math.floor(mantissa * 2 ** 28);
      const low = Math.floor((mantissa * 2 ** 28 - high) * 2 ** 28);
      const mantissaInt = (BigInt(high) << 28n) | BigInt(low);
      for (let b = 1; b < 8; b += 1) {
        const shift = BigInt((7 - b) * 8);
        buf[i * 8 + b] = Number((mantissaInt >> shift) & 0xffn);
      }
    }
    this.pushChunk(buf);
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Serialize a GdsLibrary into standard binary GDSII stream format.
 */
export function exportGdsBinary(library: GdsLibrary): Uint8Array {
  const writer = new GdsStreamWriter();

  // 1. Header (GDSII version 600)
  writer.writeInt16Record(GDS_HEADER, [600]);

  // 2. BGNLIB (dates: year, month, day, hour, min, sec)
  const now = new Date();
  const dateVals = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ];
  writer.writeInt16Record(GDS_BGNLIB, dateVals);

  // 3. LIBNAME
  writer.writeStringRecord(GDS_LIBNAME, library.name);

  // 4. UNITS (User units in database units, database units in meters)
  // e.g. 0.001 (1 um = 1000 nm), 1e-9 (1 nm in meters)
  const userInDb = library.userUnitsUm * 1e-6 / library.databaseUnitsMeter;
  writer.writeReal8Record(GDS_UNITS, [userInDb, library.databaseUnitsMeter]);

  // 5. Structures
  const scaleToDb = 1e-6 / library.databaseUnitsMeter; // um to database units

  for (const str of library.structures) {
    writer.writeInt16Record(GDS_BGNSTR, dateVals);
    writer.writeStringRecord(GDS_STRNAME, str.name);

    for (const poly of str.polygons) {
      writer.writeEmptyRecord(GDS_BOUNDARY);
      writer.writeInt16Record(GDS_LAYER, [poly.layer]);
      writer.writeInt16Record(GDS_DATATYPE, [poly.datatype]);

      // Coordinates in database units (must form a closed loop: last = first)
      const pts = [...poly.pointsUm];
      if (
        pts.length > 0 &&
        (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)
      ) {
        pts.push({ x: pts[0].x, y: pts[0].y });
      }

      const coords: number[] = [];
      for (const pt of pts) {
        coords.push(Math.round(pt.x * scaleToDb), Math.round(pt.y * scaleToDb));
      }
      writer.writeInt32Record(GDS_XY, coords);
      writer.writeEmptyRecord(GDS_ENDEL);
    }

    writer.writeEmptyRecord(GDS_ENDSTR);
  }

  // 6. ENDLIB
  writer.writeEmptyRecord(GDS_ENDLIB);

  return writer.toUint8Array();
}
