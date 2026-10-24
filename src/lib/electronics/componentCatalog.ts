/**
 * Adapts the verified part catalogs (`standardIcs`, `logicMemory`,
 * `microcontrollers`, `connectors`, `machines`, `powerSources`) into the
 * `Component` records the schematic parts browser renders.
 *
 * Each catalog describes a real datasheet pinout. This adapter only supplies
 * presentation: a rectangular symbol outline and a pin position on the left or
 * right edge. It never invents a pin — a part with 48 datasheet pins becomes a
 * 48-pin symbol whose pin numbers and names are the datasheet's.
 */

import type { Component } from '../supabase';
import { IC_NE555, STANDARD_LOGIC_ICS, type IcPin } from './standardIcs';
import { STANDARD_MEMORY, type MemorySpec } from './logicMemory';
import { STANDARD_MCUS, type McuSpec } from './microcontrollers';
import { STANDARD_PASSIVES, type PassiveSpec } from './connectors';
import { STANDARD_MACHINES, type MachineSpec } from './machines';
import { BATTERY_LIBRARY, type BatterySpec } from './powerSources';

type CatalogPin = {
  number: number;
  name: string;
  kind: IcPin['kind'];
};

export type CatalogComponent = Omit<Component, 'id' | 'created_at'>;

/** Pin pitch and body padding, in schematic units. */
const PIN_PITCH = 20;
const BODY_WIDTH = 160;
const MIN_BODY_HEIGHT = 100;

const GROUND_NAMES = /^(GND|VSS|VEE|V-|SLEEVE|0)$/i;

/** Map a datasheet pin kind to the schematic's pin type. */
function pinType(pin: CatalogPin): Component['pins'][number]['type'] {
  if (pin.kind === 'power') return GROUND_NAMES.test(pin.name) ? 'ground' : 'power';
  if (pin.kind === 'bidirectional') return 'io';
  if (pin.kind === 'input') return 'input';
  if (pin.kind === 'output') return 'output';
  return 'passive';
}

/**
 * Lay a datasheet pin list out in DIP order: pin 1 at the top-left, numbering
 * down the left edge, then continuing up the right edge. Pins beyond the two
 * edges (a module with an odd pin count) alternate edges rather than overlap.
 */
export function layoutPins(pins: readonly CatalogPin[]): {
  pins: Component['pins'];
  width: number;
  height: number;
} {
  const leftCount = Math.ceil(pins.length / 2);
  const rightCount = pins.length - leftCount;
  const rows = Math.max(leftCount, rightCount, 1);
  const height = Math.max(MIN_BODY_HEIGHT, rows * PIN_PITCH + 20);

  const positioned = pins.map((pin, index) => {
    const onLeft = index < leftCount;
    const row = onLeft ? index : index - leftCount;
    const y = 20 + row * PIN_PITCH;
    return {
      id: `p${pin.number}`,
      name: pin.name,
      x: onLeft ? 0 : BODY_WIDTH,
      y,
      type: pinType(pin),
    };
  });

  return { pins: positioned, width: BODY_WIDTH, height };
}

/** Build one rectangular IC symbol from a real datasheet pinout. */
export function buildIcComponent(options: {
  name: string;
  category: string;
  description: string;
  pins: readonly CatalogPin[];
  properties: Component['default_properties'];
  manufacturer?: string;
  partNumber?: string;
  tags?: string[];
}): CatalogComponent {
  const { pins, width, height } = layoutPins(options.pins);
  return {
    name: options.name,
    category: options.category,
    description: options.description,
    is_standard: true,
    symbol_data: {
      width,
      height,
      paths: [`M 0,0 L ${width},0 L ${width},${height} L 0,${height} Z`],
      circles: [{ cx: width / 2, cy: 10, r: 4 }],
    },
    pins,
    default_properties: options.properties,
    manufacturer: options.manufacturer,
    part_number: options.partNumber,
    tags: options.tags,
  };
}

function logicComponent(spec: (typeof STANDARD_LOGIC_ICS)[number]): CatalogComponent {
  return buildIcComponent({
    name: `${spec.partNumber} ${spec.name}`,
    category: 'ic',
    description: spec.description,
    pins: spec.pins,
    properties: {
      type: spec.partNumber,
      family: '74HC',
      voltage: '5V',
      delay: `${spec.typicalDelayNs}ns`,
      gates: spec.unitsPerPackage,
    },
    partNumber: spec.partNumber,
    tags: ['logic', spec.gate ?? '74hc', spec.partNumber.toLowerCase()],
  });
}

function memoryComponent(spec: MemorySpec): CatalogComponent {
  return buildIcComponent({
    name: `${spec.partNumber} ${spec.name}`,
    category: 'memory',
    description: spec.description,
    pins: spec.pins,
    properties: {
      type: spec.partNumber,
      voltage: `${spec.supplyVolts}V`,
      interface: spec.interface ?? 'parallel',
      ...(spec.capacityBits === undefined
        ? { kind: spec.kind }
        : { capacity: `${spec.capacityBits} bits` }),
    },
    partNumber: spec.partNumber,
    tags: ['memory', spec.kind, spec.interface?.toLowerCase() ?? 'parallel'],
  });
}

function mcuComponent(spec: McuSpec): CatalogComponent {
  return buildIcComponent({
    name: `${spec.partNumber} ${spec.name}`,
    category: 'microcontroller',
    description: spec.description,
    pins: spec.pins,
    properties: {
      type: spec.partNumber,
      voltage: `${spec.supplyVolts}V`,
      clock: `${spec.maxClockHz / 1e6}MHz`,
      flash: `${spec.flashBytes} bytes`,
      sram: `${spec.sramBytes} bytes`,
      package: spec.package,
    },
    manufacturer: spec.manufacturer,
    partNumber: spec.partNumber,
    tags: ['mcu', spec.package.toLowerCase(), spec.partNumber.toLowerCase()],
  });
}

function passiveComponent(spec: PassiveSpec): CatalogComponent {
  const category =
    spec.kind === 'connector' || spec.kind === 'switch' || spec.kind === 'relay'
      ? 'connector'
      : spec.kind === 'clock'
        ? 'timing'
        : spec.kind === 'protection'
          ? 'power'
          : spec.kind;
  return buildIcComponent({
    name: `${spec.partNumber} ${spec.name}`,
    category,
    description: spec.description,
    pins: spec.pins,
    properties: {
      type: spec.partNumber,
      maxCurrent: `${spec.maxCurrentA}A`,
      maxVoltage: `${spec.maxVoltageV}V`,
    },
    partNumber: spec.partNumber,
    tags: [spec.kind, spec.partNumber.toLowerCase()],
  });
}

/** Electrical terminals for each machine family, named as the datasheet does. */
function machinePins(spec: MachineSpec): CatalogPin[] {
  switch (spec.family) {
    case 'stepper-motor':
      return [
        { number: 1, name: 'A+', kind: 'passive' },
        { number: 2, name: 'A-', kind: 'passive' },
        { number: 3, name: 'B+', kind: 'passive' },
        { number: 4, name: 'B-', kind: 'passive' },
      ];
    case 'transformer': {
      const secondaries = spec.secondaryV?.length ?? 1;
      const pins: CatalogPin[] = [
        { number: 1, name: 'PRI_L', kind: 'passive' },
        { number: 2, name: 'PRI_N', kind: 'passive' },
      ];
      for (let index = 0; index < secondaries; index += 1) {
        pins.push({ number: 3 + index * 2, name: `SEC${index + 1}+`, kind: 'passive' });
        pins.push({ number: 4 + index * 2, name: `SEC${index + 1}-`, kind: 'passive' });
      }
      return pins;
    }
    default:
      return [
        { number: 1, name: 'M+', kind: 'passive' },
        { number: 2, name: 'M-', kind: 'passive' },
      ];
  }
}

function machineComponent(spec: MachineSpec): CatalogComponent {
  return buildIcComponent({
    name: `${spec.partNumber} ${spec.name}`,
    category: spec.family === 'transformer' ? 'power' : 'actuator',
    description: spec.description,
    pins: machinePins(spec),
    properties: {
      type: spec.partNumber,
      voltage: `${spec.ratedVoltageV}V`,
      current: `${spec.ratedCurrentA}A`,
      ...(spec.family === 'transformer'
        ? { power: `${spec.vaRating ?? 0}VA`, turns: `${spec.turnsRatio ?? 1}:1` }
        : { speed: `${spec.speedRpm} RPM`, torque: `${spec.torqueNm}Nm` }),
      resistance: `${spec.windingOhms}Ω`,
    },
    partNumber: spec.partNumber,
    tags: [spec.family, spec.package.toLowerCase()],
  });
}

function batteryComponent(spec: BatterySpec): CatalogComponent {
  return buildIcComponent({
    name: `${spec.name}`,
    category: 'power',
    description: `${spec.chemistry} cell, ${spec.capacityMah} mAh, ${spec.nominalVoltageV} V nominal.`,
    pins: [
      { number: 1, name: '+', kind: 'passive' },
      { number: 2, name: '-', kind: 'passive' },
    ],
    properties: {
      type: spec.chemistry,
      voltage: `${spec.nominalVoltageV}V`,
      capacity: `${spec.capacityMah}mAh`,
      fullCharge: `${spec.fullChargeVoltageV}V`,
      cutoff: `${spec.cutoffVoltageV}V`,
      esr: `${spec.internalResistanceOhms}Ω`,
      maxDischarge: `${spec.maxContinuousDischargeA}A`,
      cycleLife: spec.cycleLife,
    },
    partNumber: spec.id,
    tags: ['battery', spec.chemistry],
  });
}

/** Every catalog part, ready to append to the standard parts library. */
export const catalogComponents: CatalogComponent[] = [
  ...STANDARD_LOGIC_ICS.map(logicComponent),
  buildIcComponent({
    name: `${IC_NE555.partNumber} ${IC_NE555.name}`,
    category: 'ic',
    description: IC_NE555.description,
    pins: IC_NE555.pins,
    properties: {
      type: IC_NE555.partNumber,
      voltage: `${IC_NE555.supplyMin}-${IC_NE555.supplyMax}V`,
      threshold: IC_NE555.thresholdFraction,
      trigger: IC_NE555.triggerFraction,
      maxOutput: `${IC_NE555.maxOutputCurrent}A`,
    },
    partNumber: IC_NE555.partNumber,
    tags: ['timer', '555', 'analog'],
  }),
  ...STANDARD_MEMORY.map(memoryComponent),
  ...STANDARD_MCUS.map(mcuComponent),
  ...STANDARD_PASSIVES.map(passiveComponent),
  ...STANDARD_MACHINES.map(machineComponent),
  ...BATTERY_LIBRARY.map(batteryComponent),
];
