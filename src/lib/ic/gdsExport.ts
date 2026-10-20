/**
 * GDSII Stream Format Exporter for Silicon Tapeout.
 * Generates industry-standard binary GDSII stream files for foundry manufacturing
 * (SkyWater 130nm mask layer mapping: PRBoundary, NWell, Diff, Poly, Li1, M1..M5).
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
export const SKY130_GDS_LAYERS: Record<string, number> = {
  PRBoundary: 235,
  NWell: 64,
  PWell: 122,
  Diffusion: 65,
  Poly: 66,
  Contact: 67,
  Li1: 67, // Local interconnect
  Metal1: 68,
  Via1: 68,
  Metal2: 69,
  Via2: 69,
  Metal3: 70,
  Via3: 70,
  Metal4: 71,
  Via4: 71,
  Metal5: 72,
  Pad: 76,
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
    // Strings in GDSII must have an even length (padded with 0 if odd)
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
      const mantissaInt = Math.floor(mantissa * Math.pow(2, 56));
      for (let b = 1; b < 8; b += 1) {
        const shift = (7 - b) * 8;
        buf[i * 8 + b] = Number((BigInt(mantissaInt) >> BigInt(shift)) & 0xffn);
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
