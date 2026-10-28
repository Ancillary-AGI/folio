import { Component } from './supabase';
import { catalogComponents } from './electronics/componentCatalog';

export const standardComponents: Omit<Component, 'id' | 'created_at'>[] = [
  {
    category: 'passive',
    name: 'Resistor',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 30,
      paths: [
        'M 0,15 L 15,15 L 20,5 L 30,25 L 40,5 L 50,25 L 60,5 L 65,15 L 80,15'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 15, type: 'passive' },
      { id: 'p2', name: '2', x: 80, y: 15, type: 'passive' }
    ],
    default_properties: {
      value: '10k',
      power: '0.25W',
      tolerance: '5%'
    }
  },
  {
    category: 'passive',
    name: 'Capacitor',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 40,
      paths: [
        'M 0,20 L 25,20',
        'M 25,5 L 25,35',
        'M 35,5 L 35,35',
        'M 35,20 L 60,20'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'p2', name: '2', x: 60, y: 20, type: 'passive' }
    ],
    default_properties: {
      value: '100nF',
      voltage: '50V',
      type: 'ceramic'
    }
  },
  {
    category: 'passive',
    name: 'Inductor',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 30,
      paths: [
        'M 0,15 L 10,15 A 5,10 0 0,1 20,15 A 5,10 0 0,1 30,15 A 5,10 0 0,1 40,15 A 5,10 0 0,1 50,15 A 5,10 0 0,1 60,15 A 5,10 0 0,1 70,15 L 80,15'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 15, type: 'passive' },
      { id: 'p2', name: '2', x: 80, y: 15, type: 'passive' }
    ],
    default_properties: {
      value: '10uH',
      current: '1A',
      tolerance: '10%'
    }
  },
  {
    category: 'passive',
    name: 'Transformer',
    is_standard: true,
    symbol_data: {
      width: 120,
      height: 80,
      paths: [
        'M 30,0 L 30,12',
        'M 30,12 A 8,8 0 0,1 30,28',
        'M 30,28 A 8,8 0 0,1 30,44',
        'M 30,44 A 8,8 0 0,1 30,60',
        'M 30,60 L 30,80',
        'M 90,0 L 90,12',
        'M 90,12 A 8,8 0 0,1 90,28',
        'M 90,28 A 8,8 0 0,1 90,44',
        'M 90,44 A 8,8 0 0,1 90,60',
        'M 90,60 L 90,80',
        'M 56,16 L 56,64',
        'M 64,16 L 64,64'
      ]
    },
    pins: [
      { id: 'primary_in', name: 'P+', x: 30, y: 0, type: 'passive' },
      { id: 'primary_out', name: 'P-', x: 30, y: 80, type: 'passive' },
      { id: 'secondary_in', name: 'S+', x: 90, y: 0, type: 'passive' },
      { id: 'secondary_out', name: 'S-', x: 90, y: 80, type: 'passive' }
    ],
    default_properties: {
      inductance: '1H',
      secondaryInductance: '4H',
      k: '0.99'
    }
  },
  {
    category: 'passive',
    name: 'Transmission Line',
    is_standard: true,
    symbol_data: {
      width: 140,
      height: 60,
      paths: [
        'M 0,15 L 140,15',
        'M 0,45 L 140,45',
        'M 10,27 L 130,27'
      ]
    },
    pins: [
      { id: 'p1', name: '1+', x: 0, y: 15, type: 'input' },
      { id: 'n1', name: '1-', x: 0, y: 45, type: 'input' },
      { id: 'p2', name: '2+', x: 140, y: 15, type: 'output' },
      { id: 'n2', name: '2-', x: 140, y: 45, type: 'output' }
    ],
    default_properties: {
      z0: '50',
      td: '1ns'
    }
  },
  {
    category: 'semiconductor',
    name: 'Diode',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 40,
      paths: [
        'M 0,20 L 25,20',
        'M 25,5 L 25,35 L 45,20 Z',
        'M 45,5 L 45,35',
        'M 45,20 L 60,20'
      ]
    },
    pins: [
      { id: 'anode', name: 'A', x: 0, y: 20, type: 'input' },
      { id: 'cathode', name: 'K', x: 60, y: 20, type: 'output' }
    ],
    default_properties: {
      type: '1N4148',
      voltage: '75V',
      current: '150mA'
    }
  },
  {
    category: 'semiconductor',
    name: 'LED',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 40,
      paths: [
        'M 0,20 L 25,20',
        'M 25,5 L 25,35 L 45,20 Z',
        'M 45,5 L 45,35',
        'M 45,20 L 60,20',
        'M 35,8 L 42,1 L 40,8 L 47,8',
        'M 30,13 L 37,6 L 35,13 L 42,13'
      ]
    },
    pins: [
      { id: 'anode', name: 'A', x: 0, y: 20, type: 'input' },
      { id: 'cathode', name: 'K', x: 60, y: 20, type: 'output' }
    ],
    default_properties: {
      color: 'red',
      voltage: '2V',
      current: '20mA'
    }
  },
  {
    category: 'semiconductor',
    name: 'NPN Transistor',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 0,30 L 20,30',
        'M 20,10 L 20,50',
        'M 20,20 L 45,5 L 60,5',
        'M 20,40 L 45,55 L 60,55',
        'M 38,48 L 45,55 L 38,55'
      ]
    },
    pins: [
      { id: 'collector', name: 'C', x: 60, y: 5, type: 'output' },
      { id: 'base', name: 'B', x: 0, y: 30, type: 'input' },
      { id: 'emitter', name: 'E', x: 60, y: 55, type: 'output' }
    ],
    default_properties: {
      type: '2N2222',
      voltage: '40V',
      current: '800mA'
    }
  },
  {
    category: 'semiconductor',
    name: 'PNP Transistor',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 0,30 L 20,30',
        'M 20,10 L 20,50',
        'M 20,20 L 45,5 L 60,5',
        'M 20,40 L 45,55 L 60,55',
        'M 27,20 L 20,20 L 20,27'
      ]
    },
    pins: [
      { id: 'collector', name: 'C', x: 60, y: 55, type: 'output' },
      { id: 'base', name: 'B', x: 0, y: 30, type: 'input' },
      { id: 'emitter', name: 'E', x: 60, y: 5, type: 'output' }
    ],
    default_properties: {
      type: '2N2907',
      voltage: '40V',
      current: '600mA'
    }
  },
  {
    category: 'semiconductor',
    name: 'N-Channel MOSFET',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 0,30 L 25,30',
        'M 25,10 L 25,50',
        'M 30,15 L 30,25',
        'M 30,32 L 30,42',
        'M 30,20 L 50,20 L 50,5 L 70,5',
        'M 30,37 L 50,37 L 50,55 L 70,55',
        'M 50,37 L 50,20',
        'M 43,37 L 50,44 L 57,37'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 5, type: 'output' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'input' },
      { id: 'source', name: 'S', x: 70, y: 55, type: 'output' }
    ],
    default_properties: {
      type: 'IRF540',
      voltage: '100V',
      current: '33A'
    }
  },
  {
    category: 'semiconductor',
    name: 'P-Channel MOSFET',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 0,30 L 25,30',
        'M 25,10 L 25,50',
        'M 30,15 L 30,25',
        'M 30,32 L 30,42',
        'M 30,20 L 50,20 L 50,5 L 70,5',
        'M 30,37 L 50,37 L 50,55 L 70,55',
        'M 50,37 L 50,20',
        'M 43,20 L 50,13 L 57,20'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 55, type: 'output' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'input' },
      { id: 'source', name: 'S', x: 70, y: 5, type: 'output' }
    ],
    default_properties: {
      type: 'IRF9540',
      voltage: '100V',
      current: '23A'
    }
  },
  {
    category: 'semiconductor',
    name: 'N-Channel FinFET',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 0,30 L 25,30',
        'M 25,10 L 25,50',
        'M 30,15 L 30,25',
        'M 30,32 L 30,42',
        'M 30,20 L 50,20 L 50,5 L 70,5',
        'M 30,37 L 50,37 L 50,55 L 70,55',
        'M 50,37 L 50,20',
        'M 43,37 L 50,44 L 57,37',
        'M 34,15 L 34,25',
        'M 38,15 L 38,25'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 5, type: 'output' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'input' },
      { id: 'source', name: 'S', x: 70, y: 55, type: 'output' }
    ],
    default_properties: {
      type: 'FINFET-N',
      family: 'finfet',
      vto: '0.35',
      kp: '2e-3',
      lambda: '0.02',
      dibl: '0.04',
      ssub: '70',
      fins: '4',
      voltage: '1.8V',
      current: '50mA'
    }
  },
  {
    category: 'semiconductor',
    name: 'N-Channel GaN HEMT',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 0,30 L 25,30',
        'M 25,10 L 25,50',
        'M 30,15 L 30,25',
        'M 30,32 L 30,42',
        'M 30,20 L 50,20 L 50,5 L 70,5',
        'M 30,37 L 50,37 L 50,55 L 70,55',
        'M 50,37 L 50,20',
        'M 43,37 L 50,44 L 57,37',
        'M 24,18 L 34,18',
        'M 24,42 L 34,42'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 5, type: 'output' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'input' },
      { id: 'source', name: 'S', x: 70, y: 55, type: 'output' }
    ],
    default_properties: {
      type: 'GAN-HEMT-N',
      family: 'gan-hemt',
      vto: '-2',
      kp: '0.5',
      lambda: '0.002',
      dibl: '0.01',
      ssub: '90',
      voltage: '650V',
      current: '30A'
    }
  },
  {
    category: 'semiconductor',
    name: 'N-Channel JFET',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 0,30 L 25,30',
        'M 25,10 L 25,50',
        'M 30,15 L 30,45',
        'M 30,20 L 50,20 L 50,5 L 70,5',
        'M 30,37 L 50,37 L 50,55 L 70,55',
        'M 50,37 L 50,20',
        'M 22,27 L 30,30 L 22,33',
      ],
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 5, type: 'output' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'input' },
      { id: 'source', name: 'S', x: 70, y: 55, type: 'output' },
    ],
    default_properties: {
      type: '2N3819',
      voltage: '25V',
      current: '10mA',
    },
  },
  {
    category: 'semiconductor',
    name: 'P-Channel JFET',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 0,30 L 25,30',
        'M 25,10 L 25,50',
        'M 30,15 L 30,45',
        'M 30,20 L 50,20 L 50,5 L 70,5',
        'M 30,37 L 50,37 L 50,55 L 70,55',
        'M 50,37 L 50,20',
        'M 38,27 L 30,30 L 38,33',
      ],
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 55, type: 'output' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'input' },
      { id: 'source', name: 'S', x: 70, y: 5, type: 'output' },
    ],
    default_properties: {
      type: 'PJFET',
      voltage: '25V',
      current: '10mA',
    },
  },
  {
    category: 'power',
    name: 'DC Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 L 40.6,19.4 L 45,30 L 40.6,40.6 L 30,45 L 19.4,40.6 L 15,30 L 19.4,19.4 Z',
        'M 30,45 L 30,60',
        'M 25,20 L 35,20',
        'M 30,38 L 30,42'
      ]
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' }
    ],
    default_properties: {
      voltage: '5V',
      type: 'DC'
    }
  },
  {
    category: 'power',
    name: 'Pulse Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 L 40.6,19.4 L 45,30 L 40.6,40.6 L 30,45 L 19.4,40.6 L 15,30 L 19.4,19.4 Z',
        'M 30,45 L 30,60',
        'M 18,30 L 18,38 L 27,38 L 27,22 L 36,22 L 36,38 L 42,38',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' },
    ],
    default_properties: {
      type: 'PULSE',
      v1: '0V',
      v2: '5V',
      td: '0',
      tr: '1ns',
      tf: '1ns',
      pw: '5us',
      per: '10us',
    },
  },
  {
    category: 'power',
    name: 'Sine Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 A 15,15 0 1,1 30,45 A 15,15 0 1,1 30,15 Z',
        'M 30,45 L 30,60',
        'M 20,30 Q 25,21 30,30 T 40,30',
        'M 38,7 L 44,7',
        'M 41,4 L 41,10',
        'M 38,53 L 44,53',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' },
    ],
    default_properties: {
      type: 'SINE',
      vo: '0V',
      va: '1V',
      freq: '1kHz',
      theta: '0',
      phase: '0',
      td: '0',
    },
  },
  {
    category: 'power',
    name: 'EXP Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 L 40.6,19.4 L 45,30 L 40.6,40.6 L 30,45 L 19.4,40.6 L 15,30 L 19.4,19.4 Z',
        'M 30,45 L 30,60',
        'M 18,38 Q 24,38 27,26 Q 30,18 36,22 L 42,22',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' },
    ],
    default_properties: {
      type: 'EXP',
      v1: '0V',
      v2: '5V',
      td1: '0',
      tau1: '1us',
      td2: '10us',
      tau2: '1us',
    },
  },
  {
    category: 'power',
    name: 'SFFM Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 L 40.6,19.4 L 45,30 L 40.6,40.6 L 30,45 L 19.4,40.6 L 15,30 L 19.4,19.4 Z',
        'M 30,45 L 30,60',
        'M 19,30 Q 22,20 26,30 T 34,30 T 41,30',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' },
    ],
    default_properties: {
      type: 'SFFM',
      vo: '0V',
      va: '1V',
      fc: '10kHz',
      mdi: '5',
      fs: '1kHz',
    },
  },
  {
    category: 'power',
    name: 'PWL Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 L 40.6,19.4 L 45,30 L 40.6,40.6 L 30,45 L 19.4,40.6 L 15,30 L 19.4,19.4 Z',
        'M 30,45 L 30,60',
        'M 18,38 L 24,38 L 30,22 L 36,30 L 42,30',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' },
    ],
    default_properties: {
      type: 'PWL',
      points: '0,0 1u,5 2u,0',
    },
  },
  {
    category: 'power',
    name: 'Ground',
    is_standard: true,
    symbol_data: {
      width: 40,
      height: 30,
      paths: [
        'M 20,0 L 20,10',
        'M 5,10 L 35,10',
        'M 10,15 L 30,15',
        'M 13,20 L 27,20'
      ]
    },
    pins: [
      { id: 'gnd', name: 'GND', x: 20, y: 0, type: 'ground' }
    ],
    default_properties: {
      type: 'earth'
    }
  },
  {
    category: 'ic',
    name: 'Voltage-Controlled Switch',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 50,
      paths: [
        'M 0,15 L 20,15 L 45,30',
        'M 20,15 A 4,4 0 1,1 20,15.1',
        'M 45,30 L 70,30',
        'M 25,50 L 25,35',
        'M 45,50 L 45,35',
        'M 25,35 L 45,35',
      ],
    },
    pins: [
      { id: 'positive', name: '1', x: 0, y: 15, type: 'passive' },
      { id: 'negative', name: '2', x: 70, y: 30, type: 'passive' },
      { id: 'control_pos', name: '+', x: 25, y: 50, type: 'input' },
      { id: 'control_neg', name: '-', x: 45, y: 50, type: 'input' },
    ],
    default_properties: {
      type: 'SW',
      ron: '1',
      roff: '1MEG',
      vt: '0.5V',
      vh: '0V',
    },
  },
  {
    category: 'ic',
    name: 'Current-Controlled Switch',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 50,
      paths: [
        'M 0,15 L 20,15 L 45,30',
        'M 20,15 A 4,4 0 1,1 20,15.1',
        'M 45,30 L 70,30',
        'M 30,50 L 30,40 L 40,40 L 40,50',
      ],
    },
    pins: [
      { id: 'positive', name: '1', x: 0, y: 15, type: 'passive' },
      { id: 'negative', name: '2', x: 70, y: 30, type: 'passive' },
    ],
    default_properties: {
      type: 'CSW',
      control: 'VSENSE',
      ron: '1',
      roff: '1MEG',
      it: '1mA',
      ih: '0A',
    },
  },
  {
    category: 'ic',
    name: 'Behavioral Source',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 60,
      paths: [
        'M 35,0 L 35,15',
        'M 35,30 A 15,15 0 1,1 35,30',
        'M 35,45 L 35,60',
        'M 24,26 L 28,34 L 32,26 L 36,34 L 40,26 L 44,34',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 35, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 35, y: 60, type: 'ground' },
    ],
    default_properties: {
      type: 'B',
      v: 'V(IN)',
    },
  },
  {
    category: 'ic',
    name: 'Op-Amp',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 80,
      paths: [
        'M 10,10 L 10,70 L 70,40 Z',
        'M 20,25 L 30,25',
        'M 20,55 L 30,55',
        'M 25,50 L 25,60'
      ]
    },
    pins: [
      { id: 'in_pos', name: '+', x: 0, y: 25, type: 'input' },
      { id: 'in_neg', name: '-', x: 0, y: 55, type: 'input' },
      { id: 'out', name: 'OUT', x: 80, y: 40, type: 'output' },
      { id: 'vcc', name: 'V+', x: 40, y: 0, type: 'power' },
      { id: 'vee', name: 'V-', x: 40, y: 80, type: 'power' }
    ],
    default_properties: {
      type: 'LM358',
      gain: '100dB',
      gbw: '1MHz',
      slew: '0.5e6',
      rin: '2MEG',
      rout: '50',
      vPlus: '16',
      vMinus: '-16',
      dropout: '1.5',
      voltage: '32V'
    }
  },
  {
    category: 'ic',
    name: 'Logic Gate AND',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 60,
      paths: [
        'M 10,10 L 10,50 L 40,50 A 20,20 0 0,0 40,10 Z'
      ]
    },
    pins: [
      { id: 'in1', name: 'A', x: 0, y: 20, type: 'input' },
      { id: 'in2', name: 'B', x: 0, y: 40, type: 'input' },
      { id: 'out', name: 'Y', x: 80, y: 30, type: 'output' }
    ],
    default_properties: {
      family: '74HC',
      voltage: '5V'
    }
  },
  {
    category: 'ic',
    name: 'Logic Gate OR',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 60,
      paths: [
        'M 10,10 Q 30,30 10,50 Q 40,30 70,30 Q 40,30 10,10'
      ]
    },
    pins: [
      { id: 'in1', name: 'A', x: 0, y: 20, type: 'input' },
      { id: 'in2', name: 'B', x: 0, y: 40, type: 'input' },
      { id: 'out', name: 'Y', x: 80, y: 30, type: 'output' }
    ],
    default_properties: {
      family: '74HC',
      voltage: '5V'
    }
  },
  {
    category: 'ic',
    name: 'Logic Gate NOT',
    is_standard: true,
    symbol_data: {
      width: 70,
      height: 40,
      paths: [
        'M 10,5 L 10,35 L 55,20 Z',
        'M 55,20 A 5,5 0 1,1 55,20.1'
      ]
    },
    pins: [
      { id: 'in', name: 'A', x: 0, y: 20, type: 'input' },
      { id: 'out', name: 'Y', x: 70, y: 20, type: 'output' }
    ],
    default_properties: {
      family: '74HC',
      voltage: '5V'
    }
  },
  {
    category: 'connector',
    name: 'Terminal',
    is_standard: true,
    symbol_data: {
      width: 30,
      height: 30,
      paths: [
        'M 15,15 A 10,10 0 1,1 15,15.1',
        'M 10,15 L 20,15',
        'M 15,10 L 15,20'
      ]
    },
    pins: [
      { id: 'pin', name: '1', x: 30, y: 15, type: 'passive' }
    ],
    default_properties: {
      type: 'test_point'
    }
  },
  
  // Microcontrollers and Processors
  {
    category: 'microcontroller',
    name: 'Arduino Uno',
    is_standard: true,
    symbol_data: {
      width: 120,
      height: 80,
      paths: [
        'M 10,10 L 110,10 L 110,70 L 10,70 Z',
        'M 20,20 L 100,20',
        'M 20,30 L 100,30',
        'M 20,40 L 100,40',
        'M 20,50 L 100,50'
      ]
    },
    pins: [
      { id: 'vcc', name: 'VCC', x: 0, y: 20, type: 'power' },
      { id: 'gnd', name: 'GND', x: 0, y: 60, type: 'ground' },
      { id: 'd0', name: 'D0', x: 120, y: 20, type: 'io' },
      { id: 'd1', name: 'D1', x: 120, y: 30, type: 'io' },
      { id: 'd2', name: 'D2', x: 120, y: 40, type: 'io' },
      { id: 'd3', name: 'D3', x: 120, y: 50, type: 'io' },
      { id: 'a0', name: 'A0', x: 60, y: 0, type: 'input' },
      { id: 'a1', name: 'A1', x: 70, y: 0, type: 'input' }
    ],
    default_properties: {
      voltage: '5V',
      frequency: '16MHz',
      flash: '32KB',
      ram: '2KB'
    }
  },
  
  // Sensors
  {
    category: 'sensor',
    name: 'Temperature Sensor',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 20,10 L 40,10 L 40,50 L 20,50 Z',
        'M 30,15 L 30,45',
        'M 25,20 L 35,20',
        'M 25,25 L 35,25',
        'M 25,30 L 35,30'
      ]
    },
    pins: [
      { id: 'vcc', name: 'VCC', x: 0, y: 20, type: 'power' },
      { id: 'gnd', name: 'GND', x: 0, y: 40, type: 'ground' },
      { id: 'out', name: 'OUT', x: 60, y: 30, type: 'output' }
    ],
    default_properties: {
      type: 'LM35',
      range: '-55°C to 150°C',
      accuracy: '±0.5°C'
    }
  },
  
  // Communication
  {
    category: 'communication',
    name: 'WiFi Module',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 60,
      paths: [
        'M 10,10 L 70,10 L 70,50 L 10,50 Z',
        'M 20,20 L 60,20',
        'M 25,25 L 55,25',
        'M 30,30 L 50,30',
        'M 35,35 L 45,35'
      ]
    },
    pins: [
      { id: 'vcc', name: 'VCC', x: 0, y: 20, type: 'power' },
      { id: 'gnd', name: 'GND', x: 0, y: 40, type: 'ground' },
      { id: 'tx', name: 'TX', x: 80, y: 20, type: 'output' },
      { id: 'rx', name: 'RX', x: 80, y: 30, type: 'input' },
      { id: 'rst', name: 'RST', x: 80, y: 40, type: 'input' }
    ],
    default_properties: {
      type: 'ESP8266',
      frequency: '2.4GHz',
      protocols: 'WiFi 802.11 b/g/n'
    }
  },
  
  // Power Management
  {
    category: 'power',
    name: 'Voltage Regulator',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 50,
      paths: [
        'M 10,10 L 70,10 L 70,40 L 10,40 Z',
        'M 40,15 L 40,35'
      ]
    },
    pins: [
      { id: 'vin', name: 'VIN', x: 0, y: 25, type: 'power' },
      { id: 'vout', name: 'VOUT', x: 80, y: 25, type: 'power' },
      { id: 'gnd', name: 'GND', x: 40, y: 50, type: 'ground' }
    ],
    default_properties: {
      type: 'LM7805',
      input_voltage: '7-35V',
      output_voltage: '5V',
      current: '1A'
    }
  },
  
  // Memory
  {
    category: 'memory',
    name: 'EEPROM',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 60,
      paths: [
        'M 10,10 L 70,10 L 70,50 L 10,50 Z',
        'M 20,20 L 60,20',
        'M 20,30 L 60,30',
        'M 20,40 L 60,40'
      ]
    },
    pins: [
      { id: 'vcc', name: 'VCC', x: 0, y: 15, type: 'power' },
      { id: 'gnd', name: 'GND', x: 0, y: 45, type: 'ground' },
      { id: 'sda', name: 'SDA', x: 80, y: 20, type: 'io' },
      { id: 'scl', name: 'SCL', x: 80, y: 30, type: 'input' },
      { id: 'wp', name: 'WP', x: 80, y: 40, type: 'input' }
    ],
    default_properties: {
      type: '24LC256',
      capacity: '256Kbit',
      interface: 'I2C'
    }
  },
  
  // Displays
  {
    category: 'display',
    name: 'LCD Display',
    is_standard: true,
    symbol_data: {
      width: 100,
      height: 60,
      paths: [
        'M 10,10 L 90,10 L 90,50 L 10,50 Z',
        'M 15,15 L 85,15 L 85,45 L 15,45 Z',
        'M 20,20 L 80,20',
        'M 20,25 L 80,25',
        'M 20,30 L 80,30',
        'M 20,35 L 80,35'
      ]
    },
    pins: [
      { id: 'vss', name: 'VSS', x: 0, y: 15, type: 'ground' },
      { id: 'vdd', name: 'VDD', x: 0, y: 25, type: 'power' },
      { id: 'v0', name: 'V0', x: 0, y: 35, type: 'input' },
      { id: 'rs', name: 'RS', x: 0, y: 45, type: 'input' },
      { id: 'e', name: 'E', x: 100, y: 15, type: 'input' },
      { id: 'd4', name: 'D4', x: 100, y: 25, type: 'input' },
      { id: 'd5', name: 'D5', x: 100, y: 35, type: 'input' },
      { id: 'd6', name: 'D6', x: 100, y: 45, type: 'input' }
    ],
    default_properties: {
      type: '16x2 Character',
      interface: 'Parallel',
      voltage: '5V'
    }
  },
  
  // Motors and Actuators
  {
    category: 'actuator',
    name: 'Servo Motor',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 15,15 L 45,15 L 45,45 L 15,45 Z',
        'M 30,30 A 10,10 0 1,1 30,30.1',
        'M 30,20 L 30,40',
        'M 20,30 L 40,30'
      ]
    },
    pins: [
      { id: 'vcc', name: 'VCC', x: 0, y: 20, type: 'power' },
      { id: 'gnd', name: 'GND', x: 0, y: 40, type: 'ground' },
      { id: 'pwm', name: 'PWM', x: 60, y: 30, type: 'input' }
    ],
    default_properties: {
      type: 'SG90',
      voltage: '4.8-6V',
      torque: '1.8kg/cm',
      angle: '180°'
    }
  },
  
  // Crystals and Oscillators
  {
    category: 'timing',
    name: 'Crystal Oscillator',
    is_standard: true,
    symbol_data: {
      width: 50,
      height: 30,
      paths: [
        'M 15,5 L 15,25',
        'M 35,5 L 35,25',
        'M 20,10 L 30,10 L 30,20 L 20,20 Z'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 15, type: 'passive' },
      { id: 'p2', name: '2', x: 50, y: 15, type: 'passive' }
    ],
    default_properties: {
      frequency: '16MHz',
      tolerance: '±20ppm',
      load_capacitance: '18pF'
    }
  },
  
  // Switches and Buttons
  {
    category: 'switch',
    name: 'Push Button',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 40,
      paths: [
        'M 0,20 L 15,20',
        'M 15,15 L 15,25',
        'M 15,20 L 25,10',
        'M 35,20 L 45,20',
        'M 45,15 L 45,25',
        'M 45,20 L 60,20'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'p2', name: '2', x: 60, y: 20, type: 'passive' }
    ],
    default_properties: {
      type: 'Momentary',
      rating: '50mA 12V',
      actuation_force: '160gf'
    }
  },
  
  // Connectors
  {
    category: 'connector',
    name: 'Header Pin',
    is_standard: true,
    symbol_data: {
      width: 20,
      height: 40,
      paths: [
        'M 8,5 L 12,5 L 12,35 L 8,35 Z',
        'M 10,0 L 10,40'
      ]
    },
    pins: [
      { id: 'pin', name: '1', x: 10, y: 0, type: 'passive' }
    ],
    default_properties: {
      type: '2.54mm pitch',
      plating: 'Gold',
      current: '3A'
    }
  },
  
  // Test Equipment
  {
    category: 'test',
    name: 'Test Point',
    is_standard: true,
    symbol_data: {
      width: 20,
      height: 20,
      paths: [
        'M 10,10 A 8,8 0 1,1 10,10.1',
        'M 5,10 L 15,10',
        'M 10,5 L 10,15'
      ]
    },
    pins: [
      { id: 'tp', name: 'TP', x: 20, y: 10, type: 'passive' }
    ],
    default_properties: {
      type: 'SMD',
      size: '1.27mm'
    }
  },

  // Datasheet-accurate parts adapted from the electronics catalogs: real
  // pinouts for 74HC logic, memory, MCUs, connectors, machines and batteries.
  ...catalogComponents,
];