import { Component } from './supabase';
import { catalogComponents } from './electronics/componentCatalog';

export const standardComponents: Omit<Component, 'id' | 'created_at'>[] = [
  {
    category: 'passive',
    name: 'Resistor',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 40,
      paths: [
        'M 0,20 L 12,20 L 17,11 L 27,29 L 37,11 L 47,29 L 57,11 L 68,20 L 80,20',
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'p2', name: '2', x: 80, y: 20, type: 'passive' }
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
      height: 40,
      paths: [
        'M 0,20 L 3,20 A 6,9 0 0,1 15,20 A 6,9 0 0,1 27,20 A 6,9 0 0,1 39,20 A 6,9 0 0,1 51,20 A 6,9 0 0,1 63,20 A 6,9 0 0,1 75,20 L 80,20'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'p2', name: '2', x: 80, y: 20, type: 'passive' }
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
        'M 30,0 L 30,8',
        'M 30,8 A 8,8 0 0,1 30,24',
        'M 30,24 A 8,8 0 0,1 30,40',
        'M 30,40 A 8,8 0 0,1 30,56',
        'M 30,56 L 30,80',
        'M 90,0 L 90,8',
        'M 90,8 A 8,8 0 0,1 90,24',
        'M 90,24 A 8,8 0 0,1 90,40',
        'M 90,40 A 8,8 0 0,1 90,56',
        'M 90,56 L 90,80',
        'M 54,14 L 54,66',
        'M 66,14 L 66,66'
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
        'M 0,20 L 140,20',
        'M 0,40 L 140,40',
        'M 10,30 L 130,30'
      ]
    },
    pins: [
      { id: 'p1', name: '1+', x: 0, y: 20, type: 'input' },
      { id: 'n1', name: '1-', x: 0, y: 40, type: 'input' },
      { id: 'p2', name: '2+', x: 140, y: 20, type: 'output' },
      { id: 'n2', name: '2-', x: 140, y: 40, type: 'output' }
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
      { id: 'anode', name: 'A', x: 0, y: 20, type: 'passive' },
      { id: 'cathode', name: 'K', x: 60, y: 20, type: 'passive' }
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
        'M 0,20 L 24,20',
        'M 24,4 L 24,36 L 42,20 Z',
        'M 42,4 L 42,36',
        'M 42,20 L 60,20',
        'M 28,15 L 36,7 M 36,7 L 31,7 M 36,7 L 36,12',
        'M 33,22 L 41,14 M 41,14 L 36,14 M 41,14 L 41,19',
      ]
    },
    pins: [
      { id: 'anode', name: 'A', x: 0, y: 20, type: 'passive' },
      { id: 'cathode', name: 'K', x: 60, y: 20, type: 'passive' }
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
        'M 0,30 L 18,30',
        'M 18,12 L 18,48',
        'M 18,20 L 40,10 L 60,10',
        'M 18,40 L 40,50 L 60,50',
        'M 33,44 L 40,50 L 33,50',
      ]
    },
    pins: [
      { id: 'collector', name: 'C', x: 60, y: 10, type: 'passive' },
      { id: 'base', name: 'B', x: 0, y: 30, type: 'passive' },
      { id: 'emitter', name: 'E', x: 60, y: 50, type: 'passive' }
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
        'M 0,30 L 18,30',
        'M 18,12 L 18,48',
        'M 18,20 L 42,10 L 60,10',
        'M 18,40 L 42,50 L 60,50',
        'M 36,17 L 42,10 L 36,10',
      ]
    },
    pins: [
      { id: 'collector', name: 'C', x: 60, y: 50, type: 'passive' },
      { id: 'base', name: 'B', x: 0, y: 30, type: 'passive' },
      { id: 'emitter', name: 'E', x: 60, y: 10, type: 'passive' }
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
        'M 30,10 L 30,25',
        'M 30,35 L 30,50',
        'M 30,20 L 50,20 L 50,10 L 70,10',
        'M 30,40 L 50,40 L 50,50 L 70,50',
        'M 50,40 L 50,20',
        'M 43,40 L 50,47 L 57,40'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 10, type: 'passive' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'passive' },
      { id: 'source', name: 'S', x: 70, y: 50, type: 'passive' }
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
        'M 30,10 L 30,25',
        'M 30,35 L 30,50',
        'M 30,20 L 50,20 L 50,10 L 70,10',
        'M 30,40 L 50,40 L 50,50 L 70,50',
        'M 50,40 L 50,20',
        'M 43,20 L 50,13 L 57,20'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 50, type: 'passive' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'passive' },
      { id: 'source', name: 'S', x: 70, y: 10, type: 'passive' }
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
        'M 30,10 L 30,25',
        'M 30,35 L 30,50',
        'M 34,10 L 34,25',
        'M 34,35 L 34,50',
        'M 38,10 L 38,25',
        'M 38,35 L 38,50',
        'M 38,20 L 50,20 L 50,10 L 70,10',
        'M 38,40 L 50,40 L 50,50 L 70,50',
        'M 50,40 L 50,20',
        'M 43,40 L 50,47 L 57,40'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 10, type: 'passive' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'passive' },
      { id: 'source', name: 'S', x: 70, y: 50, type: 'passive' }
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
        'M 30,10 L 30,25',
        'M 30,35 L 30,50',
        'M 27,15 L 36,15',
        'M 27,45 L 36,45',
        'M 30,20 L 50,20 L 50,10 L 70,10',
        'M 30,40 L 50,40 L 50,50 L 70,50',
        'M 50,40 L 50,20',
        'M 43,40 L 50,47 L 57,40'
      ]
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 10, type: 'passive' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'passive' },
      { id: 'source', name: 'S', x: 70, y: 50, type: 'passive' }
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
        'M 30,10 L 30,50',
        'M 30,20 L 50,20 L 50,10 L 70,10',
        'M 30,40 L 50,40 L 50,50 L 70,50',
        'M 50,40 L 50,20',
        'M 20,25 L 28,30 L 20,35',
      ],
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 10, type: 'passive' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'passive' },
      { id: 'source', name: 'S', x: 70, y: 50, type: 'passive' },
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
        'M 30,10 L 30,50',
        'M 30,20 L 50,20 L 50,10 L 70,10',
        'M 30,40 L 50,40 L 50,50 L 70,50',
        'M 50,40 L 50,20',
        'M 40,25 L 32,30 L 40,35',
      ],
    },
    pins: [
      { id: 'drain', name: 'D', x: 70, y: 50, type: 'passive' },
      { id: 'gate', name: 'G', x: 0, y: 30, type: 'passive' },
      { id: 'source', name: 'S', x: 70, y: 10, type: 'passive' },
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
        'M 30,0 L 30,17',
        'M 30,17 A 13,13 0 1,1 30,43 A 13,13 0 1,1 30,17 Z',
        'M 30,43 L 30,60',
        'M 24,23 L 36,23',
        'M 30,19 L 30,27',
        'M 24,37 L 36,37',
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
      width: 80,
      height: 60,
      paths: [
        'M 0,20 L 20,20',
        'M 17,20 A 3,3 0 1,0 23,20 A 3,3 0 1,0 17,20 Z',
        'M 20,20 L 58,10',
        'M 60,20 L 80,20',
        'M 57,20 A 3,3 0 1,0 63,20 A 3,3 0 1,0 57,20 Z',
        'M 30,60 L 30,40 L 50,40 L 50,60',
        'M 40,40 L 40,24',
      ],
    },
    pins: [
      { id: 'positive', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'negative', name: '2', x: 80, y: 20, type: 'passive' },
      { id: 'control_pos', name: '+', x: 30, y: 60, type: 'input' },
      { id: 'control_neg', name: '-', x: 50, y: 60, type: 'input' },
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
      width: 80,
      height: 60,
      paths: [
        'M 0,20 L 20,20',
        'M 17,20 A 3,3 0 1,0 23,20 A 3,3 0 1,0 17,20 Z',
        'M 20,20 L 58,10',
        'M 60,20 L 80,20',
        'M 57,20 A 3,3 0 1,0 63,20 A 3,3 0 1,0 57,20 Z',
        'M 26,36 L 54,36 L 54,52 L 26,52 Z',
        'M 30,44 L 50,44',
        'M 46,40 L 50,44 L 46,48',
      ],
    },
    pins: [
      { id: 'positive', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'negative', name: '2', x: 80, y: 20, type: 'passive' },
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
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,15 A 15,15 0 1,1 30,45 A 15,15 0 1,1 30,15 Z',
        'M 30,45 L 30,60',
        'M 18,34 L 22,26 L 26,34 L 30,26 L 34,34 L 38,26 L 42,34',
      ],
    },
    pins: [
      { id: 'positive', name: '+', x: 30, y: 0, type: 'power' },
      { id: 'negative', name: '-', x: 30, y: 60, type: 'ground' },
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
        'M 20,10 L 20,70 L 70,40 Z',
        'M 0,20 L 20,20',
        'M 0,60 L 20,60',
        'M 70,40 L 80,40',
        'M 24,20 L 32,20',
        'M 28,16 L 28,24',
        'M 24,60 L 32,60',
        'M 40,0 L 40,22',
        'M 40,58 L 40,80'
      ]
    },
    pins: [
      { id: 'in_pos', name: '+', x: 0, y: 20, type: 'input' },
      { id: 'in_neg', name: '-', x: 0, y: 60, type: 'input' },
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
        'M 10,10 L 10,50 L 40,50 A 20,20 0 0,0 40,10 Z',
        'M 0,20 L 10,20',
        'M 0,40 L 10,40',
        'M 60,30 L 80,30'
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
        'M 10,10 Q 30,30 10,50 Q 40,30 70,30 Q 40,30 10,10',
        'M 0,20 L 20,20',
        'M 0,40 L 20,40',
        'M 70,30 L 80,30'
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
        'M 55,20 A 5,5 0 1,0 65,20 A 5,5 0 1,0 55,20 Z',
        'M 0,20 L 10,20',
        'M 65,20 L 70,20'
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
      width: 40,
      height: 40,
      paths: [
        'M 10,20 A 10,10 0 1,1 30,20 A 10,10 0 1,1 10,20 Z',
        'M 30,20 L 40,20',
        'M 15,20 L 25,20',
        'M 20,15 L 20,25'
      ]
    },
    pins: [
      { id: 'pin', name: '1', x: 40, y: 20, type: 'passive' }
    ],
    default_properties: {
      type: 'test_point'
    }
  },
  
  // Microcontrollers come from the datasheet catalog below: a board-level name
  // with four invented GPIO pins cannot carry a design, but the silicon on it
  // can, with every pin numbered the way the datasheet numbers it.

  // Power Management
  {
    category: 'power',
    name: 'Voltage Regulator',
    is_standard: true,
    symbol_data: {
      width: 80,
      height: 60,
      paths: [
        'M 10,10 L 70,10 L 70,50 L 10,50 Z',
        'M 0,30 L 10,30',
        'M 70,30 L 80,30',
        'M 40,50 L 40,60',
        'M 40,18 L 40,40',
        'M 34,34 L 40,40 L 46,34'
      ]
    },
    pins: [
      { id: 'vin', name: 'VIN', x: 0, y: 30, type: 'power' },
      { id: 'vout', name: 'VOUT', x: 80, y: 30, type: 'power' },
      { id: 'gnd', name: 'GND', x: 40, y: 60, type: 'ground' }
    ],
    default_properties: {
      type: 'LM7805',
      input_voltage: '7-35V',
      output_voltage: '5V',
      current: '1A'
    }
  },
  
  // Memory and displays come from the datasheet catalog: `24LC256 256Kbit I2C
  // EEPROM` carries all eight pins, and a five-pin stand-in for it would only
  // teach the designer to draw a part that cannot be bought.

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
        'M 20,30 A 10,10 0 1,0 40,30 A 10,10 0 1,0 20,30 Z',
        'M 30,20 L 30,40',
        'M 20,30 L 40,30',
        'M 0,20 L 15,20',
        'M 0,40 L 15,40',
        'M 45,30 L 60,30'
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
      width: 60,
      height: 40,
      paths: [
        'M 0,20 L 10,20',
        'M 10,8 L 10,32',
        'M 16,6 L 44,6 L 44,34 L 16,34 Z',
        'M 50,8 L 50,32',
        'M 50,20 L 60,20'
      ]
    },
    pins: [
      { id: 'p1', name: '1', x: 0, y: 20, type: 'passive' },
      { id: 'p2', name: '2', x: 60, y: 20, type: 'passive' }
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
      width: 30,
      height: 20,
      paths: [
        'M 2,10 A 8,8 0 1,0 18,10 A 8,8 0 1,0 2,10 Z',
        'M 5,10 L 15,10',
        'M 10,5 L 10,15',
        'M 18,10 L 30,10'
      ]
    },
    pins: [
      { id: 'tp', name: 'TP', x: 30, y: 10, type: 'passive' }
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