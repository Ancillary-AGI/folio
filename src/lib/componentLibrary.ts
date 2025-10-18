import { Component } from './supabase';

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
    category: 'power',
    name: 'DC Voltage Source',
    is_standard: true,
    symbol_data: {
      width: 60,
      height: 60,
      paths: [
        'M 30,0 L 30,15',
        'M 30,30 A 15,15 0 1,1 30,30',
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
      voltage: '32V',
      gain: '100dB'
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
  }
];
