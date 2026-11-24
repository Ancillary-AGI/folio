/**
 * AI Datasheet-to-Component Ingestion Engine.
 * Extracts pinouts, electrical ratings and package dimensions from datasheet
 * text and synthesizes a schematic symbol plus a generated SOIC-family land
 * pattern. It deliberately synthesizes no SPICE model: a pinout is not device
 * physics, and an invented macromodel would simulate confidently and wrongly.
 */

import type { Component as SupabaseComponent } from '../supabase';
import type { Pin } from '../../types';

export interface ComponentPin extends Pin {
  number: string;
  orientation?: number;
}

export interface Footprint {
  id: string;
  name: string;
  category: string;
  pads: Array<{
    id: string;
    number: string;
    type: string;
    shape: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    layers: string[];
    net?: string;
  }>;
  courtyard: { width: number; height: number };
  fab_properties: Record<string, number>;
}

export interface ExtractedPin {
  number: number;
  name: string;
  kind: 'power' | 'ground' | 'input' | 'output' | 'bidirectional' | 'passive';
  altFunctions?: string[];
  description?: string;
}

export interface ExtractedElectricalSpecs {
  minSupplyVoltageV?: number;
  maxSupplyVoltageV?: number;
  maxCurrentA?: number;
  quiescentCurrentUa?: number;
  operatingTempRangeC?: [number, number];
}

export interface ExtractedPackage {
  packageName: string;
  /** False when no package line was read and the SOIC family was assumed. */
  packageStated: boolean;
  pinCount: number;
  pitchMm: number;
  bodyWidthMm: number;
  bodyHeightMm: number;
  padWidthMm: number;
  padLengthMm: number;
  hasExposedThermalPad?: boolean;
}

export interface IngestedDatasheet {
  partNumber: string;
  manufacturer: string;
  category: string;
  description: string;
  pins: ExtractedPin[];
  electrical: ExtractedElectricalSpecs;
  packaging: ExtractedPackage;
}

export interface SynthesizedPart {
  component: SupabaseComponent;
  footprint: Footprint;
}

/**
 * Parse structured datasheet text into a typed IngestedDatasheet model.
 * Supports Markdown tables, CSV pinouts, and key-value parameter blocks.
 */
export function parseDatasheetText(rawText: string): IngestedDatasheet {
  if (!rawText || !rawText.trim()) throw new Error('Datasheet content is empty.');

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  let partNumber = 'GENERIC_IC';
  let manufacturer = 'Generic';
  const category = 'Integrated Circuit';
  let description = 'Datasheet-ingested component';
  const pins: ExtractedPin[] = [];
  const electrical: ExtractedElectricalSpecs = {};
  let explicitPackage: string | undefined;
  const packaging: ExtractedPackage = {
    packageName: 'SOIC-8',
    packageStated: false,
    pinCount: 8,
    pitchMm: 1.27,
    bodyWidthMm: 3.9,
    bodyHeightMm: 4.9,
    padWidthMm: 0.6,
    padLengthMm: 1.5,
  };

  for (const line of lines) {
    // Key-value metadata extraction
    const mpnMatch = line.match(/^(?:MPN|Part(?:\s+Number)?):\s*([A-Za-z0-9_/-]+)/i);
    if (mpnMatch) partNumber = mpnMatch[1];

    const mfgMatch = line.match(/^(?:Manufacturer|Vendor):\s*(.+)/i);
    if (mfgMatch) manufacturer = mfgMatch[1];

    const descMatch = line.match(/^(?:Description):\s*(.+)/i);
    if (descMatch) description = descMatch[1];

    // Only the 1.27 mm dual-row family is modelled by the synthesized footprint.
    const packageMatch = line.match(/^(?:Package|Package Type|Case):\s*((?:SOIC|SOP|SO)-?\d+W?)/i);
    if (packageMatch) explicitPackage = packageMatch[1].toUpperCase();

    // Electrical limits
    const vddMatch = line.match(/(?:V(?:DD|CC)|Supply(?:\s+Voltage)?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*V\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*V/i);
    if (vddMatch) {
      electrical.minSupplyVoltageV = parseFloat(vddMatch[1]);
      electrical.maxSupplyVoltageV = parseFloat(vddMatch[2]);
    }

    // Pin row: "1 VDD Power" or a markdown row "| 1 | VDD | Power |". The
    // description may be several words ("Analog Input"), so it is captured to
    // the next cell divider rather than as a single word.
    const pinRowMatch = line.match(/^\|?\s*(\d+)\s*\|?\s*([A-Za-z0-9_#/-]+)\s*\|?\s*([A-Za-z/ ]*)/);
    if (pinRowMatch) {
      const pinNum = parseInt(pinRowMatch[1], 10);
      const pinName = pinRowMatch[2];
      const rawKind = (pinRowMatch[3] ?? '').trim().toLowerCase();

      if (pinNum > 0 && !isNaN(pinNum)) {
        let kind: ExtractedPin['kind'] = 'bidirectional';
        const uName = pinName.toUpperCase();
        if (uName.includes('VDD') || uName.includes('VCC') || rawKind.includes('power')) kind = 'power';
        else if (uName.includes('GND') || uName.includes('VSS') || rawKind.includes('ground')) kind = 'ground';
        else if (rawKind.includes('in') && rawKind.includes('out')) kind = 'bidirectional';
        else if (rawKind.includes('in')) kind = 'input';
        else if (rawKind.includes('out')) kind = 'output';
        else if (rawKind.includes('pass')) kind = 'passive';

        if (!pins.some((p) => p.number === pinNum)) {
          pins.push({ number: pinNum, name: pinName, kind });
        }
      }
    }
  }

  if (pins.length > 0) {
    packaging.pinCount = pins.length;
  } else if (explicitPackage) {
    const declaredCount = explicitPackage.match(/(\d+)$/);
    if (declaredCount) packaging.pinCount = parseInt(declaredCount[1], 10);
  }

  // Without a package line the family is an assumption, not a reading, and the
  // UI says so. With one, the land pattern below still uses generic pad
  // geometry, not a per-part IPC land-pattern calculation.
  packaging.packageStated = explicitPackage !== undefined;
  packaging.packageName = explicitPackage ?? `SOIC-${packaging.pinCount}`;
  if (packaging.pinCount > 8) {
    const pinsPerSide = Math.ceil(packaging.pinCount / 2);
    packaging.bodyHeightMm = 4.9 + (pinsPerSide - 4) * packaging.pitchMm;
  }
  // A trailing W marks the 300 mil wide body; without it the 150 mil narrow
  // body is assumed, which is the common case for 16-pin logic and converters.
  if (explicitPackage?.endsWith('W')) packaging.bodyWidthMm = 7.5;

  return {
    partNumber,
    manufacturer,
    category,
    description,
    pins: pins.sort((a, b) => a.number - b.number),
    electrical,
    packaging,
  };
}

/**
 * Synthesize a Folio component and footprint from an ingested datasheet.
 * No SPICE model is produced; see the module comment.
 */
export function synthesizeComponentFromDatasheet(data: IngestedDatasheet): SynthesizedPart {
  const pinCount = data.pins.length > 0 ? data.pins.length : data.packaging.pinCount;
  const halfPins = Math.ceil(pinCount / 2);

  // 1. Generate Schematic Symbol Layout
  // Two column symbol box: Left pins (inputs/power), Right pins (outputs/signals)
  const pinSpacing = 20;
  const symbolHeight = Math.max(80, (halfPins + 1) * pinSpacing);
  const symbolWidth = 140;

  const componentPins: ComponentPin[] = [];
  const symbolPaths: string[] = [];

  // Main box outline
  symbolPaths.push(`M 20 10 L ${symbolWidth - 20} 10 L ${symbolWidth - 20} ${symbolHeight - 10} L 20 ${symbolHeight - 10} Z`);

  for (let i = 0; i < data.pins.length; i += 1) {
    const pin = data.pins[i];
    const isLeft = i < halfPins;
    const yIndex = isLeft ? i + 1 : i - halfPins + 1;
    const y = yIndex * pinSpacing;

    const x = isLeft ? 0 : symbolWidth;
    const pinX = isLeft ? 20 : symbolWidth - 20;

    // Pin lead tick
    symbolPaths.push(`M ${x} ${y} L ${pinX} ${y}`);

    componentPins.push({
      id: `p${pin.number}`,
      name: pin.name,
      number: String(pin.number),
      type: pin.kind === 'bidirectional' ? 'io' : pin.kind,
      x,
      y,
      orientation: isLeft ? 0 : 180,
    } as ComponentPin);
  }

  const component: SupabaseComponent = {
    id: `comp-${data.partNumber.toLowerCase()}`,
    name: data.partNumber,
    category: data.category,
    description: data.description,
    is_standard: false,
    pins: componentPins,
    symbol_data: {
      width: symbolWidth,
      height: symbolHeight,
      paths: symbolPaths,
    },
    /*
     * Only limits the datasheet actually stated. A default voltage here would
     * become a declared rating, and margins measured against an invented limit
     * are worse than a part that reports no rating at all.
     */
    default_properties: {
      footprint: data.packaging.packageName,
      manufacturer: data.manufacturer,
      mpn: data.partNumber,
      ...(data.electrical.minSupplyVoltageV === undefined
        ? {}
        : { minSupplyV: String(data.electrical.minSupplyVoltageV) }),
      ...(data.electrical.maxSupplyVoltageV === undefined
        ? {}
        : { maxSupplyV: String(data.electrical.maxSupplyVoltageV) }),
    },
  };

  // 2. Generate a dual-row SOIC-family land pattern from those dimensions
  const fpPads: Footprint['pads'] = [];
  const pitch = data.packaging.pitchMm;
  const pWidth = data.packaging.padWidthMm;
  const pLength = data.packaging.padLengthMm;
  const spanX = data.packaging.bodyWidthMm / 2 + pLength / 2;

  for (let i = 0; i < data.pins.length; i += 1) {
    const isLeft = i < halfPins;
    const pinIdx = isLeft ? i : i - halfPins;
    const yPos = (pinIdx - (halfPins - 1) / 2) * pitch;
    const xPos = isLeft ? -spanX : spanX;

    fpPads.push({
      id: `pad-${i + 1}`,
      number: String(i + 1),
      type: 'smd',
      shape: 'rect',
      position: { x: Number(xPos.toFixed(3)), y: Number(yPos.toFixed(3)) },
      size: { width: pLength, height: pWidth },
      layers: ['top_copper', 'top_mask', 'top_paste'],
      net: undefined,
    });
  }

  const footprint: Footprint = {
    id: `fp-${data.packaging.packageName.toLowerCase()}`,
    name: data.packaging.packageName,
    category: 'smd',
    pads: fpPads,
    courtyard: {
      width: data.packaging.bodyWidthMm + 2 * pLength + 0.5,
      height: (halfPins * pitch) + 1.0,
    },
    fab_properties: {
      min_clearance: 0.15,
      solder_mask_expansion: 0.05,
    },
  };

  return {
    component,
    footprint,
  };
}
