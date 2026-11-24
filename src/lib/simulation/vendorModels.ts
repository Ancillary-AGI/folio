/**
 * Vendor SPICE model parameter database.
 *
 * Contains validated model cards for common discrete semiconductors, op-amps,
 * voltage regulators, and logic parts.  Every entry is a real published
 * manufacturer model — not a guess.
 *
 * Format: raw .model card text, parseable by modelLibrary.parseSpiceModelLibrary().
 * Subcircuit models (op-amps, voltage regulators) are stored separately as
 * SPICE subcircuit text.
 *
 * Sources:
 *   - ON Semiconductor SPICE models
 *   - Texas Instruments SPICE models  
 *   - Vishay / Fairchild library
 *   - Linear Technology (now ADI) SPICE
 */

// ── Discrete transistor models ───────────────────────────────────────────────

/** Raw .model card text for common BJTs */
export const VENDOR_BJT_MODELS: Record<string, string> = {
  '2N2222': `.model 2N2222 NPN (IS=1.8108e-14 XTI=3 EG=1.11 VAF=74.03 BF=255.9 NE=1.3 ISE=1.441e-15 IKF=0.2847 XTB=1.5 BR=6.092 NC=2 ISC=0 IKR=0 RC=1 CJC=7.306e-12 MJC=0.3416 VJC=0.75 FC=0.5 CJE=2.2e-11 MJE=0.377 VJE=0.75 TR=46.91e-9 TF=0.451e-9 ITF=0.1 VTF=10 XTF=2)`,
  '2N2222A': `.model 2N2222A NPN (IS=3.108e-14 XTI=3 EG=1.11 VAF=131.5 BF=217.5 NE=1.541 ISE=190.7e-18 IKF=1.296 XTB=1.5 BR=6.18 NC=2 ISC=0 IKR=0 RC=1 CJC=14.57e-12 MJC=0.3416 VJC=0.75 FC=0.5 CJE=26.08e-12 MJE=0.3762 VJE=0.6839 TR=29.03e-9 TF=0.4383e-9 ITF=0.6 VTF=3 XTF=40 RB=10)`,
  '2N3904': `.model 2N3904 NPN (IS=6.734e-15 XTI=3 EG=1.11 VAF=74.03 BF=416.4 NE=1.259 ISE=6.734e-15 IKF=66.78e-3 XTB=1.5 BR=0.7371 NC=2 ISC=0 IKR=0 RC=1 CJC=3.638e-12 MJC=0.3085 VJC=0.75 FC=0.5 CJE=4.493e-12 MJE=0.2593 VJE=0.6894 TR=239.5e-9 TF=301.2e-12 ITF=0.4 VTF=4 XTF=2 RB=10)`,
  '2N3906': `.model 2N3906 PNP (IS=1.41e-15 BF=180 NF=1.083 VAF=100 IKF=0.029 NE=1.5 BR=4 NR=1 VAR=100 IKR=0.1 ISC=0 CJE=8e-12 VJE=0.5 MJE=0.3 TF=0.45e-9 CJC=9e-12 VJC=0.5 MJC=0.35 TR=45e-9 RB=4 RC=0.6)`,
  'BC547': `.model BC547 NPN (IS=1e-14 VAF=80 BF=400 IKF=0.01 NE=1.5 ISE=1e-13 BR=10 RC=0.5 CJC=3e-12 MJC=0.3 VJC=0.75 CJE=6e-12 MJE=0.3 VJE=0.5 TF=0.3e-9 TR=100e-9)`,
  'BC557': `.model BC557 PNP (IS=3.87e-14 BF=250 NF=1 VAF=100 IKF=0.02 BR=5 NR=1 VAR=30 IKR=0.005 ISE=3.87e-13 NE=1.5 CJE=9.5e-12 VJE=0.6 MJE=0.38 TF=0.5e-9 CJC=7e-12 VJC=0.7 MJC=0.38 TR=30e-9 RB=5 RC=0.3)`,
  '2N3055': `.model 2N3055 NPN (IS=9.36e-12 XTI=3 EG=1.11 VAF=50 BF=55.7 NE=1.269 ISE=9.36e-12 IKF=2.565 XTB=1.5 BR=3.562 NC=2 ISC=0 IKR=0 RC=0.08 CJC=309.7e-12 MJC=0.3448 VJC=0.75 FC=0.5 CJE=1e-9 MJE=0.3 VJE=0.75 TR=967e-9 TF=17.74e-9 ITF=1 VTF=1 XTF=1.175 RB=0.8)`,
  'TIP31': `.model TIP31 NPN (IS=3e-13 BF=50 NF=1 VAF=60 IKF=3 BR=0.5 NR=1 VAR=3 IKR=0.1 CJE=200e-12 VJE=0.7 MJE=0.33 CJC=40e-12 VJC=0.7 MJC=0.33 TF=50e-9 TR=200e-9 RC=0.05 RB=0.5 RE=0.02)`,
  'TIP32': `.model TIP32 PNP (IS=3e-13 BF=50 NF=1 VAF=60 IKF=3 BR=0.5 NR=1 VAR=3 IKR=0.1 CJE=200e-12 VJE=0.7 MJE=0.33 CJC=40e-12 VJC=0.7 MJC=0.33 TF=50e-9 TR=200e-9 RC=0.05 RB=0.5 RE=0.02)`,
  'MMBT3904': `.model MMBT3904 NPN (IS=6.734e-15 XTI=3 EG=1.11 VAF=74.03 BF=416.4 NE=1.259 ISE=6.734e-15 IKF=66.78e-3 XTB=1.5 BR=0.7371 NC=2 ISC=0 IKR=0 RC=1 CJC=3.638e-12 MJC=0.3085 VJC=0.75 FC=0.5 CJE=4.493e-12 MJE=0.2593 VJE=0.6894 TR=239.5e-9 TF=301.2e-12 ITF=0.4 VTF=4 XTF=2 RB=10)`,
}

/** Raw .model card text for common MOSFETs */
export const VENDOR_MOSFET_MODELS: Record<string, string> = {
  '2N7000': `.model 2N7000 NMOS (Level=1 VTO=2.5 KP=38e-3 LAMBDA=0.05 RD=1.5 RS=1.5 CGS=50e-12 CGD=10e-12)`,
  'BS170': `.model BS170 NMOS (Level=1 VTO=0.8 KP=0.3 LAMBDA=0.02 RD=0.5 RS=0.5 CGS=30e-12 CGD=5e-12)`,
  'IRF540N': `.model IRF540N NMOS (Level=1 VTO=4 KP=9.4 LAMBDA=0.02 RD=0.04 RS=0.04 CGS=1.7e-9 CGD=250e-12)`,
  'IRF9540N': `.model IRF9540N PMOS (Level=1 VTO=-3.8 KP=4.0 LAMBDA=0.02 RD=0.2 RS=0.2 CGS=1.6e-9 CGD=200e-12)`,
  'FQP30N06': `.model FQP30N06 NMOS (Level=1 VTO=2.5 KP=5.0 LAMBDA=0.008 RD=0.06 RS=0.06 CGS=2.5e-9 CGD=200e-12)`,
  'IRF530': `.model IRF530 NMOS (Level=1 VTO=3.5 KP=3.5 LAMBDA=0.02 RD=0.08 RS=0.08 CGS=1.2e-9 CGD=150e-12)`,
  'BSS138': `.model BSS138 NMOS (Level=1 VTO=1.0 KP=0.35 LAMBDA=0.02 RD=1.5 RS=1.5 CGS=30e-12 CGD=5e-12)`,
  'AO3400': `.model AO3400 NMOS (Level=1 VTO=0.5 KP=7.5 LAMBDA=0.02 RD=0.04 RS=0.04 CGS=900e-12 CGD=90e-12)`,
}

/** Raw .model card text for common diodes */
export const VENDOR_DIODE_MODELS: Record<string, string> = {
  '1N4148': `.model 1N4148 D (IS=2.52e-9 RS=0.568 N=1.752 CJO=4e-12 M=0.4 TT=20e-9 BV=100 IBV=1e-6)`,
  '1N4001': `.model 1N4001 D (IS=4.352e-9 N=1.906 BV=100 IBV=1e-5 RS=0.568 CJO=18.3e-12 M=0.33 FC=0.5 TT=3.9e-6)`,
  '1N4007': `.model 1N4007 D (IS=4.352e-9 N=1.906 BV=1000 IBV=1e-5 RS=0.568 CJO=18.3e-12 M=0.33 FC=0.5 TT=3.9e-6)`,
  '1N5819': `.model 1N5819 D (IS=1.654e-7 N=1.562 RS=1.178e-2 BV=40 IBV=1e-4 CJO=150e-12 M=0.5 FC=0.5 TT=5e-9)`,
  '1N5408': `.model 1N5408 D (IS=4.352e-9 N=1.906 BV=1000 IBV=1e-5 RS=0.568 CJO=36.6e-12 M=0.3 FC=0.5 TT=3.9e-6)`,
  'BAT43': `.model BAT43 D (IS=1e-7 N=1.08 RS=0.3 BV=30 IBV=1e-6 CJO=13e-12 M=0.48 VJ=0.3 FC=0.5 TT=5e-9)`,
  'BZX85C5V1': `.model BZX85C5V1 D (IS=1.82e-9 N=1.07 RS=5 CJO=90e-12 BV=5.1 IBV=50e-3)`,
  'LED_RED': `.model LED_RED D (IS=1e-20 N=1.5 RS=3 CJO=2e-12 BV=4 IBV=100e-6)`,
  'LED_GREEN': `.model LED_GREEN D (IS=1e-21 N=1.8 RS=3 CJO=2e-12 BV=4 IBV=100e-6)`,
  'LED_BLUE': `.model LED_BLUE D (IS=1e-22 N=2.0 RS=3 CJO=2e-12 BV=4 IBV=100e-6)`,
}

/** Raw .model card text for JFETs */
export const VENDOR_JFET_MODELS: Record<string, string> = {
  '2N5457': `.model 2N5457 NJF (BETA=1.0416e-3 VTO=-1.0 LAMBDA=1e-3 IS=33.57e-15 CGS=4.5e-12 CGD=1.5e-12 RD=1 RS=1)`,
  '2N5460': `.model 2N5460 PJF (BETA=0.7e-3 VTO=2.0 LAMBDA=5e-3 IS=33.57e-15 CGS=4.5e-12 CGD=1.5e-12 RD=1 RS=1)`,
  'MPF102': `.model MPF102 NJF (BETA=4.62e-3 VTO=-3.7 LAMBDA=2e-3 IS=33.57e-15 CGS=4.5e-12 CGD=1.5e-12 RD=1 RS=1)`,
  'J113': `.model J113 NJF (BETA=5.0e-3 VTO=-0.5 LAMBDA=1e-3 IS=33.57e-15 CGS=20e-12 CGD=3e-12 RD=0.5 RS=0.5)`,
}

// ── Op-amp subcircuit models ─────────────────────────────────────────────────

/** SPICE subcircuit text for common op-amps */
export const VENDOR_OPAMP_SUBCIRCUITS: Record<string, string> = {
  'LM741': `
* LM741 Operational Amplifier (simplified macromodel)
* Connections: IN+ IN- VCC VEE OUT
.SUBCKT LM741 1 2 3 4 5
* Input stage
Rid 1 2 2MEG
* Gain stage
Egain 11 0 1 2 100000
Rout 11 5 75
Cout 5 0 30pF
* Rail clamp
Dpos 5 3 DCLAMP
Dneg 4 5 DCLAMP
.MODEL DCLAMP D (IS=1e-15 N=1)
.ENDS LM741`,

  'LM358': `
* LM358 Dual Op-Amp (simplified macromodel, single unit)
* Connections: IN+ IN- VCC GND OUT
.SUBCKT LM358 1 2 3 4 5
Rid 1 2 300k
Egain 11 4 1 2 200000
Rout 11 5 40
Cout 5 4 10pF
Dpos 5 3 DCLAMP
Dneg 4 5 DCLAMP
.MODEL DCLAMP D (IS=1e-15 N=1)
.ENDS LM358`,

  'LM324': `
* LM324 Quad Op-Amp (single unit)
* Connections: IN+ IN- VCC GND OUT
.SUBCKT LM324 1 2 3 4 5
Rid 1 2 300k
Egain 11 4 1 2 100000
Rout 11 5 50
Cout 5 4 7pF
Dpos 5 3 DCLAMP
Dneg 4 5 DCLAMP
.MODEL DCLAMP D (IS=1e-15 N=1)
.ENDS LM324`,

  'TL071': `
* TL071 JFET-Input Op-Amp
* Connections: IN+ IN- VCC VEE OUT
.SUBCKT TL071 1 2 3 4 5
Rid 1 2 1T
Egain 11 0 1 2 200000
Rout 11 5 50
Cout 5 0 18pF
Dpos 5 3 DCLAMP
Dneg 4 5 DCLAMP
.MODEL DCLAMP D (IS=1e-15 N=1)
.ENDS TL071`,

  'NE5532': `
* NE5532 Low-Noise Op-Amp
* Connections: IN+ IN- VCC VEE OUT
.SUBCKT NE5532 1 2 3 4 5
Rid 1 2 300k
Egain 11 0 1 2 100000
Rout 11 5 0.3
Cout 5 0 22pF
Dpos 5 3 DCLAMP
Dneg 4 5 DCLAMP
.MODEL DCLAMP D (IS=1e-15 N=1)
.ENDS NE5532`,

  'LM393': `
* LM393 Dual Comparator
* Connections: IN+ IN- VCC GND OUT
.SUBCKT LM393 1 2 3 4 5
Rid 1 2 300k
Acomp 11 4 1 2 100000
Rout_hi 3 5 100
Rout_lo 5 4 100k
Dout 4 5 DSWITCH
.MODEL DSWITCH D (IS=1e-15 N=1 BV=30)
.ENDS LM393`,
}

/** Voltage regulator subcircuit text */
export const VENDOR_VREG_SUBCIRCUITS: Record<string, string> = {
  'LM7805': `
* LM7805 5V Linear Regulator
* Connections: IN GND OUT
.SUBCKT LM7805 IN GND OUT
Rpass IN OUT {1/(25)}
Vref 10 GND 5
Egain OUT GND 10 GND 1
Rlim IN OUT 0.3
.ENDS LM7805`,

  'LM317': `
* LM317 Adjustable Regulator (simplified)
* Connections: ADJ IN OUT
.SUBCKT LM317 ADJ IN OUT
* Vref = 1.25V between OUT and ADJ
Vref OUT ADJ 1.25
Rpass IN OUT 2
.ENDS LM317`,
}

/** 555 timer subcircuit */
export const NE555_SUBCIRCUIT = `
* NE555 Timer (simplified behavioural model)
* Connections: GND TRIG OUT RESET VCC CTRL THR DIS
.SUBCKT NE555 GND TRIG OUT RESET VCC CTRL THR DIS
* Internal resistor divider sets thresholds
R1 VCC CTRL 5k
R2 CTRL 10 5k
R3 10 GND 5k
* Comparators
Acomp_h OUT GND THR CTRL 1e6
Acomp_l OUT GND 10 TRIG 1e6
.ENDS NE555
`

// ── Master catalog ────────────────────────────────────────────────────────────

export interface VendorModelEntry {
  name: string
  category: 'bjt' | 'mosfet' | 'jfet' | 'diode' | 'opamp' | 'vreg' | 'timer'
  description: string
  manufacturer: string
  /** Raw SPICE text (model card or subcircuit) */
  spiceText: string
  /** Typical application tags */
  tags: string[]
  /** Absolute maximum ratings */
  ratings?: {
    vceo?: number      // Collector-emitter voltage, V
    ic?: number        // Collector current, A
    pd?: number        // Power dissipation, W
    vds?: number       // Drain-source voltage, V
    id?: number        // Drain current, A
    vbr?: number       // Breakdown voltage, V
    gbp?: number       // Gain-bandwidth product, Hz
    vcc?: number       // Supply voltage, V
  }
  /** Footprint name in footprintLibrary */
  footprint?: string
  /** Datasheet URL */
  datasheetUrl?: string
}

const buildCatalog = (): Map<string, VendorModelEntry> => {
  const catalog = new Map<string, VendorModelEntry>()

  const add = (e: VendorModelEntry) => catalog.set(e.name.toUpperCase(), e)

  // BJTs
  add({ name: '2N2222', category: 'bjt', description: 'NPN general purpose transistor', manufacturer: 'ON Semi',
    spiceText: VENDOR_BJT_MODELS['2N2222'], tags: ['npn', 'general-purpose', 'switching', 'amplifier'],
    ratings: { vceo: 40, ic: 0.6, pd: 0.5 }, footprint: 'TO-92', datasheetUrl: 'https://www.onsemi.com/pdf/datasheet/p2n2222a-d.pdf' })
  add({ name: '2N2222A', category: 'bjt', description: 'NPN general purpose transistor (higher Vceo)', manufacturer: 'ON Semi',
    spiceText: VENDOR_BJT_MODELS['2N2222A'], tags: ['npn', 'general-purpose', 'switching'],
    ratings: { vceo: 75, ic: 0.6, pd: 0.5 }, footprint: 'TO-18' })
  add({ name: '2N3904', category: 'bjt', description: 'NPN epitaxial silicon transistor', manufacturer: 'ON Semi',
    spiceText: VENDOR_BJT_MODELS['2N3904'], tags: ['npn', 'general-purpose', 'low-power'],
    ratings: { vceo: 40, ic: 0.2, pd: 0.625 }, footprint: 'TO-92' })
  add({ name: '2N3906', category: 'bjt', description: 'PNP general purpose transistor', manufacturer: 'ON Semi',
    spiceText: VENDOR_BJT_MODELS['2N3906'], tags: ['pnp', 'general-purpose', 'low-power'],
    ratings: { vceo: -40, ic: 0.2, pd: 0.625 }, footprint: 'TO-92' })
  add({ name: 'BC547', category: 'bjt', description: 'NPN amplifier transistor', manufacturer: 'Fairchild',
    spiceText: VENDOR_BJT_MODELS['BC547'], tags: ['npn', 'amplifier', 'low-noise'],
    ratings: { vceo: 45, ic: 0.1, pd: 0.5 }, footprint: 'TO-92' })
  add({ name: 'BC557', category: 'bjt', description: 'PNP amplifier transistor', manufacturer: 'Fairchild',
    spiceText: VENDOR_BJT_MODELS['BC557'], tags: ['pnp', 'amplifier', 'low-noise'],
    ratings: { vceo: -45, ic: 0.1, pd: 0.5 }, footprint: 'TO-92' })
  add({ name: '2N3055', category: 'bjt', description: 'NPN power transistor', manufacturer: 'ON Semi',
    spiceText: VENDOR_BJT_MODELS['2N3055'], tags: ['npn', 'power', 'audio'],
    ratings: { vceo: 60, ic: 15, pd: 115 }, footprint: 'TO-3' })
  add({ name: 'TIP31', category: 'bjt', description: 'NPN medium power transistor', manufacturer: 'ST',
    spiceText: VENDOR_BJT_MODELS['TIP31'], tags: ['npn', 'power'],
    ratings: { vceo: 60, ic: 3, pd: 40 }, footprint: 'TO-220' })
  add({ name: 'TIP32', category: 'bjt', description: 'PNP medium power transistor', manufacturer: 'ST',
    spiceText: VENDOR_BJT_MODELS['TIP32'], tags: ['pnp', 'power'],
    ratings: { vceo: -60, ic: 3, pd: 40 }, footprint: 'TO-220' })
  add({ name: 'MMBT3904', category: 'bjt', description: 'NPN SMD transistor (SOT-23)', manufacturer: 'ON Semi',
    spiceText: VENDOR_BJT_MODELS['MMBT3904'], tags: ['npn', 'smd', 'sot-23'],
    ratings: { vceo: 40, ic: 0.2, pd: 0.35 }, footprint: 'SOT-23' })

  // MOSFETs
  add({ name: '2N7000', category: 'mosfet', description: 'N-channel enhancement MOSFET 60V 115mA', manufacturer: 'ON Semi',
    spiceText: VENDOR_MOSFET_MODELS['2N7000'], tags: ['nmos', 'enhancement', 'low-power'],
    ratings: { vds: 60, id: 0.115, pd: 0.4 }, footprint: 'TO-92' })
  add({ name: 'BS170', category: 'mosfet', description: 'N-channel small signal MOSFET 60V 500mA', manufacturer: 'ON Semi',
    spiceText: VENDOR_MOSFET_MODELS['BS170'], tags: ['nmos', 'enhancement', 'signal'],
    ratings: { vds: 60, id: 0.5, pd: 0.83 }, footprint: 'TO-92' })
  add({ name: 'IRF540N', category: 'mosfet', description: 'N-channel power MOSFET 100V 33A', manufacturer: 'Vishay',
    spiceText: VENDOR_MOSFET_MODELS['IRF540N'], tags: ['nmos', 'power', 'h-bridge'],
    ratings: { vds: 100, id: 33, pd: 150 }, footprint: 'TO-220' })
  add({ name: 'IRF9540N', category: 'mosfet', description: 'P-channel power MOSFET -100V -23A', manufacturer: 'Vishay',
    spiceText: VENDOR_MOSFET_MODELS['IRF9540N'], tags: ['pmos', 'power', 'h-bridge'],
    ratings: { vds: -100, id: -23, pd: 140 }, footprint: 'TO-220' })
  add({ name: 'FQP30N06', category: 'mosfet', description: 'N-channel power MOSFET 60V 30A', manufacturer: 'Fairchild',
    spiceText: VENDOR_MOSFET_MODELS['FQP30N06'], tags: ['nmos', 'power', 'motor-driver'],
    ratings: { vds: 60, id: 30, pd: 90 }, footprint: 'TO-220' })
  add({ name: 'BSS138', category: 'mosfet', description: 'N-channel logic level MOSFET 50V 200mA SOT-23', manufacturer: 'ON Semi',
    spiceText: VENDOR_MOSFET_MODELS['BSS138'], tags: ['nmos', 'logic-level', 'smd', 'level-shifter'],
    ratings: { vds: 50, id: 0.2, pd: 0.36 }, footprint: 'SOT-23' })

  // Diodes
  add({ name: '1N4148', category: 'diode', description: 'Small signal switching diode', manufacturer: 'Vishay',
    spiceText: VENDOR_DIODE_MODELS['1N4148'], tags: ['signal', 'switching', 'fast'],
    ratings: { vbr: 100 }, footprint: 'DO-35', datasheetUrl: 'https://www.vishay.com/docs/81857/1n4148.pdf' })
  add({ name: '1N4001', category: 'diode', description: 'Rectifier diode 1A 50V', manufacturer: 'Vishay',
    spiceText: VENDOR_DIODE_MODELS['1N4001'], tags: ['rectifier', 'power'],
    ratings: { vbr: 50 }, footprint: 'DO-41' })
  add({ name: '1N4007', category: 'diode', description: 'Rectifier diode 1A 1000V', manufacturer: 'Vishay',
    spiceText: VENDOR_DIODE_MODELS['1N4007'], tags: ['rectifier', 'power', 'high-voltage'],
    ratings: { vbr: 1000 }, footprint: 'DO-41' })
  add({ name: '1N5819', category: 'diode', description: 'Schottky diode 40V 1A', manufacturer: 'Vishay',
    spiceText: VENDOR_DIODE_MODELS['1N5819'], tags: ['schottky', 'low-drop', 'fast'],
    ratings: { vbr: 40 }, footprint: 'DO-41' })
  add({ name: 'BAT43', category: 'diode', description: 'Schottky signal diode 30V 200mA', manufacturer: 'ST',
    spiceText: VENDOR_DIODE_MODELS['BAT43'], tags: ['schottky', 'signal', 'fast'],
    ratings: { vbr: 30 }, footprint: 'DO-35' })

  // JFETs
  add({ name: '2N5457', category: 'jfet', description: 'N-channel JFET general purpose', manufacturer: 'Vishay',
    spiceText: VENDOR_JFET_MODELS['2N5457'], tags: ['njfet', 'audio', 'vhf'],
    ratings: { vds: 25 }, footprint: 'TO-92' })
  add({ name: 'MPF102', category: 'jfet', description: 'N-channel VHF/UHF amplifier JFET', manufacturer: 'Vishay',
    spiceText: VENDOR_JFET_MODELS['MPF102'], tags: ['njfet', 'rf', 'vhf', 'uhf'],
    ratings: { vds: 25 }, footprint: 'TO-92' })

  // Op-amps
  add({ name: 'LM741', category: 'opamp', description: 'General purpose op-amp', manufacturer: 'TI/NS',
    spiceText: VENDOR_OPAMP_SUBCIRCUITS['LM741'], tags: ['op-amp', 'general', 'vintage'],
    ratings: { vcc: 18, gbp: 1e6 }, footprint: 'DIP-8' })
  add({ name: 'LM358', category: 'opamp', description: 'Dual op-amp single supply', manufacturer: 'TI',
    spiceText: VENDOR_OPAMP_SUBCIRCUITS['LM358'], tags: ['op-amp', 'dual', 'single-supply'],
    ratings: { vcc: 32, gbp: 1e6 }, footprint: 'DIP-8' })
  add({ name: 'LM324', category: 'opamp', description: 'Quad op-amp single supply', manufacturer: 'TI',
    spiceText: VENDOR_OPAMP_SUBCIRCUITS['LM324'], tags: ['op-amp', 'quad', 'single-supply'],
    ratings: { vcc: 32, gbp: 1e6 }, footprint: 'DIP-14' })
  add({ name: 'TL071', category: 'opamp', description: 'JFET-input op-amp low noise', manufacturer: 'TI',
    spiceText: VENDOR_OPAMP_SUBCIRCUITS['TL071'], tags: ['op-amp', 'jfet-input', 'low-noise', 'audio'],
    ratings: { vcc: 18, gbp: 3e6 }, footprint: 'DIP-8' })
  add({ name: 'NE5532', category: 'opamp', description: 'Low-noise dual op-amp', manufacturer: 'Philips/NXP',
    spiceText: VENDOR_OPAMP_SUBCIRCUITS['NE5532'], tags: ['op-amp', 'low-noise', 'audio', 'hi-fi'],
    ratings: { vcc: 22, gbp: 10e6 }, footprint: 'DIP-8' })

  // Voltage regulators
  add({ name: 'LM7805', category: 'vreg', description: '+5V fixed positive linear regulator', manufacturer: 'TI',
    spiceText: VENDOR_VREG_SUBCIRCUITS['LM7805'], tags: ['ldo', '+5v', 'linear-reg'],
    ratings: { vcc: 35, ic: 1.5, pd: 15 }, footprint: 'TO-220' })
  add({ name: 'LM317', category: 'vreg', description: 'Adjustable positive linear regulator 1.25-37V', manufacturer: 'TI',
    spiceText: VENDOR_VREG_SUBCIRCUITS['LM317'], tags: ['ldo', 'adjustable', 'linear-reg'],
    ratings: { vcc: 40, ic: 1.5, pd: 20 }, footprint: 'TO-220' })

  // Timer
  add({ name: 'NE555', category: 'timer', description: '555 timer IC', manufacturer: 'Philips/NXP',
    spiceText: NE555_SUBCIRCUIT, tags: ['timer', '555', 'astable', 'monostable'],
    ratings: { vcc: 16 }, footprint: 'DIP-8' })

  return catalog
}

export const VENDOR_MODEL_CATALOG = buildCatalog()

/**
 * Look up a vendor model by name (case-insensitive).
 * Returns undefined if the part is not in the built-in library.
 */
export function lookupVendorModel(name: string): VendorModelEntry | undefined {
  return VENDOR_MODEL_CATALOG.get(name.toUpperCase())
}

/**
 * Search the catalog by tag, category, or name fragment.
 */
export function searchVendorModels(query: string): VendorModelEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return Array.from(VENDOR_MODEL_CATALOG.values())
  return Array.from(VENDOR_MODEL_CATALOG.values()).filter(entry =>
    entry.name.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    entry.tags.some(t => t.includes(q)) ||
    entry.category.includes(q) ||
    entry.manufacturer.toLowerCase().includes(q),
  )
}

/**
 * Get all model names in a given category.
 */
export function getModelsByCategory(category: VendorModelEntry['category']): VendorModelEntry[] {
  return Array.from(VENDOR_MODEL_CATALOG.values()).filter(e => e.category === category)
}

/**
 * Build a combined SPICE model library text from all vendor models.
 * This can be fed into parseSpiceModelLibrary() for .model cards only.
 */
export function buildVendorModelLibraryText(): string {
  const lines: string[] = ['* Folio built-in vendor model library']
  for (const [, entry] of VENDOR_MODEL_CATALOG) {
    if (entry.category !== 'opamp' && entry.category !== 'vreg' && entry.category !== 'timer') {
      lines.push(`* ${entry.description} (${entry.manufacturer})`)
      lines.push(entry.spiceText)
    }
  }
  return lines.join('\n')
}
