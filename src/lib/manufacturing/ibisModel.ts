/**
 * IBIS buffer models (I/O Buffer Information Specification subset).
 * Part 1 of 2: types + SI parsing + section scanner.
 */

export interface IbisIvPoint {
  voltage: number;
  current: number;
}

export type IbisModelType = 'Input' | 'Output' | 'I/O' | '3-state' | 'Open_drain' | 'Input_ECL' | 'Output_ECL' | 'I/O_ECL';

export interface IbisModel {
  name: string;
  modelType: IbisModelType;
  cComp: { typical: number; min?: number; max?: number };
  pullup: IbisIvPoint[];
  pulldown: IbisIvPoint[];
  gndClamp: IbisIvPoint[];
  powerClamp: IbisIvPoint[];
}

export interface IbisPin {
  pin: string;
  signal: string;
  model: string;
}

export interface IbisFile {
  fileName: string;
  version: string;
  components: Array<{ name: string; pins: IbisPin[] }>;
  models: IbisModel[];
}

export class IbisParseError extends Error {
  constructor(message: string, readonly lineNumber: number, readonly line: string) {
    super(`line ${lineNumber}: ${message} — "${line}"`);
    this.name = 'IbisParseError';
  }
}

export const MODEL_TYPES: IbisModelType[] = ['Input', 'Output', 'I/O', '3-state', 'Open_drain', 'Input_ECL', 'Output_ECL', 'I/O_ECL'];

/** Parse an IBIS numeric token with SI prefix (2.5pF, -10m, 100MHz). */
export function parseSI(value: string, lineNumber: number, line: string): number {
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)$/);
  if (!match) throw new IbisParseError(`bad numeric value "${value}"`, lineNumber, line);
  const num = Number(match[1]);
  const unit = match[2];
  if (unit === '') return num;
  // Prefix is the first letter; the rest is the unit (V, A, F, Hz, ...).
  const prefix = unit[0].toLowerCase();
  const scale: Record<string, number> = {
    t: 1e12, g: 1e9, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
  };
  // Bare unit letters carry no scale.
  if (/^[vafhz]+$/i.test(unit)) return num;
  // 'M'/'meg' is mega; lowercase 'm' is milli.
  if (unit[0] === 'M' || unit.toLowerCase().startsWith('meg')) return num * 1e6;
  const factor = scale[prefix];
  if (factor === undefined) throw new IbisParseError(`unknown SI prefix "${unit}"`, lineNumber, line);
  return num * factor;
}

/** Parse an IBIS file string into components, pins, and buffer models. */
export function parseIbis(text: string): IbisFile {
  const lines = text.split(/\r?\n/);
  const content = lines.map((raw, i) => ({ n: i + 1, raw, line: raw.replace(/\|.*$/, '').trim() }));
  const nonEmpty = content.filter((l) => l.line.length > 0);
  if (!/^\[ibis ver\]/i.test(nonEmpty[0]?.line ?? '')) {
    throw new IbisParseError('first section must be [IBIS Ver]', nonEmpty[0]?.n ?? 1, nonEmpty[0]?.raw ?? '');
  }
  const file: IbisFile = { fileName: '', version: '', components: [], models: [] };
  let currentComponent: { name: string; pins: IbisPin[] } | null = null;
  let currentModel: IbisModel | null = null;
  let currentTable: IbisIvPoint[] | null = null;
  let inPinSection = false;

  const flushModel = (): void => {
    if (!currentModel) return;
    if (currentModel.pullup.length === 0 && currentModel.pulldown.length === 0 &&
        currentModel.modelType !== 'Input' && currentModel.modelType !== 'Input_ECL') {
      throw new IbisParseError(`model ${currentModel.name} has no Pullup/Pulldown tables`, 1, currentModel.name);
    }
    file.models.push(currentModel);
    currentModel = null;
  };

  for (const { n, raw, line } of nonEmpty) {
    const section = line.match(/^\[([^\]]+)\]/);
    if (section) {
      const name = section[1].trim().toLowerCase();
      currentTable = null;
      inPinSection = name === 'pin';
      if (name === 'ibis ver') file.version = line.slice(section[0].length).trim();
      else if (name === 'file name') file.fileName = line.slice(section[0].length).trim();
      else if (name === 'component') {
        if (currentComponent) file.components.push(currentComponent);
        const compName = line.slice(section[0].length).trim();
        if (!compName) throw new IbisParseError('[Component] without a name', n, raw);
        currentComponent = { name: compName, pins: [] };
      } else if (name === 'pin') {
        if (!currentComponent) throw new IbisParseError('[Pin] outside [Component]', n, raw);
      } else if (name === 'model') {
        flushModel();
        const modelName = line.slice(section[0].length).trim().split(/\s+/)[0] ?? '';
        if (!modelName) throw new IbisParseError('[Model] without a name', n, raw);
        currentModel = { name: modelName, modelType: 'I/O', cComp: { typical: NaN }, pullup: [], pulldown: [], gndClamp: [], powerClamp: [] };
      } else if (name === 'pullup' || name === 'pulldown' || name === 'gnd clamp' || name === 'power clamp') {
        if (!currentModel) throw new IbisParseError(`[${section[1]}] outside [Model]`, n, raw);
        currentTable = name === 'pullup' ? currentModel.pullup
          : name === 'pulldown' ? currentModel.pulldown
          : name === 'gnd clamp' ? currentModel.gndClamp : currentModel.powerClamp;
      } else if (name === 'end') break;
      continue;
    }
    if (/^model_type\b/i.test(line)) {
      if (!currentModel) throw new IbisParseError('Model_type outside [Model]', n, raw);
      const t = line.split(/\s+/).slice(1).join(' ');
      if (!MODEL_TYPES.includes(t as IbisModelType)) throw new IbisParseError(`unknown Model_type "${t}"`, n, raw);
      currentModel.modelType = t as IbisModelType;
      continue;
    }
    if (/^c_comp\b/i.test(line)) {
      if (!currentModel) throw new IbisParseError('C_comp outside [Model]', n, raw);
      const parts = line.split(/\s+/).slice(1);
      if (parts.length < 1) throw new IbisParseError('C_comp needs at least a typical value', n, raw);
      currentModel.cComp = {
        typical: parseSI(parts[0], n, raw),
        min: parts[1] !== undefined ? parseSI(parts[1], n, raw) : undefined,
        max: parts[2] !== undefined ? parseSI(parts[2], n, raw) : undefined,
      };
      continue;
    }
    if (inPinSection) {
      if (!currentComponent) throw new IbisParseError('[Pin] row outside [Component]', n, raw);
      const cols = line.split(/\s+/);
      if (cols.length < 3) throw new IbisParseError(`bad [Pin] row "${line}"`, n, raw);
      currentComponent.pins.push({ pin: cols[0], signal: cols[1], model: cols[2] });
      continue;
    }
    if (currentTable) {
      const cols = line.split(/\s+/);
      if (cols.length < 2) throw new IbisParseError(`bad I-V row "${line}"`, n, raw);
      currentTable.push({ voltage: parseSI(cols[0], n, raw), current: parseSI(cols[1], n, raw) });
    }
  }
  flushModel();
  if (currentComponent) file.components.push(currentComponent);
  for (const m of file.models) {
    if (!Number.isFinite(m.cComp.typical)) throw new IbisParseError(`model ${m.name} missing C_comp`, 1, m.name);
  }
  return file;
}

/** Linear-interpolate current at voltage `v`. Throws outside the table range. */
export function ivCurrent(table: IbisIvPoint[], v: number): number {
  if (table.length < 2) throw new Error('I-V table needs at least two points.');
  if (!Number.isFinite(v)) throw new Error('voltage must be finite.');
  const lo = table[0].voltage;
  const hi = table[table.length - 1].voltage;
  if (v < lo || v > hi) throw new Error(`voltage ${v} outside I-V range [${lo}, ${hi}].`);
  for (let k = 0; k < table.length - 1; k += 1) {
    const a = table[k];
    const b = table[k + 1];
    if (v >= a.voltage && v <= b.voltage) {
      const span = b.voltage - a.voltage;
      if (span === 0) return a.current;
      return a.current + ((b.current - a.current) * (v - a.voltage)) / span;
    }
  }
  return table[table.length - 1].current;
}

/** Small-signal output impedance dV/dI at `v` from the pullup/pulldown curve. */
export function driverImpedance(model: IbisModel, v: number, high: boolean): number {
  const table = high ? model.pullup : model.pulldown;
  const dv = 0.05;
  const di = ivCurrent(table, v + dv) - ivCurrent(table, v - dv);
  if (di === 0) throw new Error('flat I-V segment: impedance undefined.');
  return Math.abs((2 * dv) / di);
}

