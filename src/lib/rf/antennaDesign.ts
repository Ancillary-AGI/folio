import { Point } from '../../types';

export interface AntennaParameters {
  frequency: number; // Hz
  wavelength: number; // meters
  gain: number; // dBi
  directivity: number; // dBi
  efficiency: number; // percentage
  bandwidth: number; // Hz
  vsWR: number; // Voltage Standing Wave Ratio
  impedance: number; // ohms
  polarization: 'linear' | 'circular' | 'elliptical';
}

export interface AntennaPattern {
  frequency: number;
  theta: number[]; // Elevation angles (degrees)
  phi: number[]; // Azimuth angles (degrees)
  gain: number[][]; // 2D gain pattern (dBi)
  phase?: number[][]; // Phase pattern (degrees)
}

export interface AntennaElement {
  id: string;
  type: 'dipole' | 'monopole' | 'patch' | 'horn' | 'parabolic' | 'helical' | 'yagi' | 'log_periodic';
  position: Point;
  orientation: { theta: number; phi: number; psi: number }; // Euler angles
  dimensions: Record<string, number>; // Type-specific dimensions
  material: string;
  parameters: AntennaParameters;
}

export interface AntennaArray {
  id: string;
  name: string;
  elements: AntennaElement[];
  arrayType: 'linear' | 'circular' | 'planar' | 'conformal';
  spacing: { dx: number; dy: number; dz: number }; // Element spacing
  amplitudeTaper: number[]; // Amplitude weighting
  phaseTaper: number[]; // Phase weighting (degrees)
  feedingNetwork: 'corporate' | 'series' | 'corporate-series';
}

export class AntennaDesigner {
  private arrays: Map<string, AntennaArray> = new Map();

  designDipole(frequency: number, length?: number): AntennaElement {
    const c = 299792458; // Speed of light (m/s)
    const wavelength = c / frequency;

    // Half-wave dipole by default
    const dipoleLength = length || wavelength / 2;

    return {
      id: `dipole_${Date.now()}`,
      type: 'dipole',
      position: { x: 0, y: 0 },
      orientation: { theta: 0, phi: 0, psi: 0 },
      dimensions: {
        length: dipoleLength,
        radius: wavelength / 200 // Thin wire approximation
      },
      material: 'copper',
      parameters: {
        frequency,
        wavelength,
        gain: 2.15, // dBi for half-wave dipole
        directivity: 2.15,
        efficiency: 95,
        bandwidth: frequency * 0.1, // 10% bandwidth
        vsWR: 1.5,
        impedance: 73, // ohms
        polarization: 'linear'
      }
    };
  }

  designMonopole(frequency: number, height?: number, groundPlaneRadius?: number): AntennaElement {
    const c = 299792458;
    const wavelength = c / frequency;

    const monopoleHeight = height || wavelength / 4;
    const gpRadius = groundPlaneRadius || wavelength / 4;

    return {
      id: `monopole_${Date.now()}`,
      type: 'monopole',
      position: { x: 0, y: 0 },
      orientation: { theta: 0, phi: 0, psi: 0 },
      dimensions: {
        height: monopoleHeight,
        radius: wavelength / 200,
        groundPlaneRadius: gpRadius
      },
      material: 'copper',
      parameters: {
        frequency,
        wavelength,
        gain: 2.15, // Same as dipole
        directivity: 2.15,
        efficiency: 90,
        bandwidth: frequency * 0.15,
        vsWR: 1.8,
        impedance: 36.5, // ohms (half of dipole)
        polarization: 'linear'
      }
    };
  }

  designPatchAntenna(frequency: number, substrateHeight: number, dielectricConstant: number): AntennaElement {
    const c = 299792458;
    const wavelength = c / frequency;
    const epsilon_r = dielectricConstant;

    // Calculate patch dimensions for dominant TM010 mode
    const effectiveEpsilon = (epsilon_r + 1) / 2 + (epsilon_r - 1) / 2 * (1 + 12 * substrateHeight / wavelength) ** -0.5;
    const patchLength = wavelength / (2 * Math.sqrt(effectiveEpsilon));
    const patchWidth = wavelength / (2 * Math.sqrt(epsilon_r));

    return {
      id: `patch_${Date.now()}`,
      type: 'patch',
      position: { x: 0, y: 0 },
      orientation: { theta: 0, phi: 0, psi: 0 },
      dimensions: {
        length: patchLength,
        width: patchWidth,
        height: substrateHeight,
        feedOffset: patchLength / 4 // Quarter-wave feed
      },
      material: 'copper',
      parameters: {
        frequency,
        wavelength,
        gain: 6, // dBi typical for patch
        directivity: 6,
        efficiency: 70,
        bandwidth: frequency * 0.05, // 5% bandwidth
        vsWR: 2.0,
        impedance: 50, // ohms (matched)
        polarization: 'linear'
      }
    };
  }

  designYagiUda(frequency: number, numElements: number = 5): AntennaArray {
    const c = 299792458;
    const wavelength = c / frequency;

    const elements: AntennaElement[] = [];
    const spacing = wavelength * 0.25; // Quarter wavelength spacing

    // Driven element (folded dipole for better impedance)
    const drivenElement = this.designDipole(frequency);
    drivenElement.position.x = 0;
    elements.push(drivenElement);

    // Directors
    for (let i = 1; i < numElements; i++) {
      const director = this.designDipole(frequency, wavelength * 0.45); // Slightly shorter
      director.position.x = i * spacing;
      elements.push(director);
    }

    // Reflector (slightly longer)
    const reflector = this.designDipole(frequency, wavelength * 0.55);
    reflector.position.x = -spacing;
    elements.unshift(reflector);

    const array: AntennaArray = {
      id: `yagi_${Date.now()}`,
      name: `Yagi-Uda ${numElements} elements`,
      elements,
      arrayType: 'linear',
      spacing: { dx: spacing, dy: 0, dz: 0 },
      amplitudeTaper: new Array(numElements).fill(1),
      phaseTaper: new Array(numElements).fill(0),
      feedingNetwork: 'series'
    };

    this.arrays.set(array.id, array);
    return array;
  }

  designPhasedArray(frequency: number, numElements: number, arrayType: 'linear' | 'circular' = 'linear'): AntennaArray {
    const c = 299792458;
    const wavelength = c / frequency;
    const spacing = wavelength / 2; // Half wavelength for grating lobe suppression

    const elements: AntennaElement[] = [];

    if (arrayType === 'linear') {
      for (let i = 0; i < numElements; i++) {
        const element = this.designPatchAntenna(frequency, wavelength / 20, 4.5);
        element.position.x = i * spacing - (numElements - 1) * spacing / 2;
        elements.push(element);
      }
    } else { // circular
      const radius = (numElements * spacing) / (2 * Math.PI);
      for (let i = 0; i < numElements; i++) {
        const angle = (2 * Math.PI * i) / numElements;
        const element = this.designPatchAntenna(frequency, wavelength / 20, 4.5);
        element.position.x = radius * Math.cos(angle);
        element.position.y = radius * Math.sin(angle);
        elements.push(element);
      }
    }

    const array: AntennaArray = {
      id: `phased_${Date.now()}`,
      name: `Phased Array ${numElements} elements`,
      elements,
      arrayType,
      spacing: { dx: spacing, dy: spacing, dz: 0 },
      amplitudeTaper: this.calculateTaylorWeights(numElements), // Taylor weighting for sidelobe suppression
      phaseTaper: new Array(numElements).fill(0),
      feedingNetwork: 'corporate'
    };

    this.arrays.set(array.id, array);
    return array;
  }

  private calculateTaylorWeights(n: number): number[] {
    // Simplified Taylor weighting for sidelobe suppression
    const weights: number[] = [];
    const sigma = 2; // Sidelobe level parameter

    for (let i = 0; i < n; i++) {
      const x = (2 * i - n + 1) / (n - 1);
      const weight = Math.cosh(sigma * Math.sqrt(1 - x * x));
      weights.push(weight);
    }

    // Normalize
    const maxWeight = Math.max(...weights);
    return weights.map(w => w / maxWeight);
  }

  calculateRadiationPattern(antenna: AntennaElement | AntennaArray, numPoints: number = 360): AntennaPattern {
    const theta = [];
    const phi = [];
    const gain = [];

    // Generate angular points
    for (let i = 0; i < numPoints; i++) {
      theta.push((i / numPoints) * 180); // 0 to 180 degrees
      phi.push(0); // Principal plane (phi = 0)
    }

    // Calculate gain pattern
    if ('elements' in antenna) {
      // Array pattern
      const array = antenna as AntennaArray;
      for (let i = 0; i < numPoints; i++) {
        const theta_rad = (theta[i] * Math.PI) / 180;
        let totalField = 0;

        array.elements.forEach((element, idx) => {
          const phase = array.phaseTaper[idx] * Math.PI / 180;
          const amplitude = array.amplitudeTaper[idx];

          // Calculate element factor (simplified isotropic)
          const elementFactor = Math.sin(theta_rad) > 0 ? 1 : 0;

          // Calculate array factor
          const k = 2 * Math.PI / element.parameters.wavelength;
          const pathLength = element.position.x * Math.sin(theta_rad);
          const arrayPhase = k * pathLength;

          const field = multiply(complex(amplitude * elementFactor), exp(multiply(complex1, complex(phase + arrayPhase))));
          totalField = multiply(totalField, complex(1)).re + field.re; // Simplified accumulation
        });

        const gain_dBi = 20 * Math.log10(Math.abs(totalField) / array.elements.length) + 2.15;
        gain.push([gain_dBi]);
      }
    } else {
      // Single element pattern
      const element = antenna as AntennaElement;

      for (let i = 0; i < numPoints; i++) {
        const theta_rad = (theta[i] * Math.PI) / 180;
        let elementGain = 0;

        switch (element.type) {
          case 'dipole':
            // Half-wave dipole pattern
            elementGain = Math.abs(Math.cos(Math.PI / 2 * Math.cos(theta_rad)) / Math.sin(theta_rad));
            break;
          case 'monopole':
            // Monopole pattern (hemispherical)
            elementGain = theta_rad <= Math.PI / 2 ? Math.sin(theta_rad) : 0;
            break;
          case 'patch': {
            // Patch antenna pattern (broadside)
            const theta_3dB = 60 * Math.PI / 180; // 60° beamwidth
            elementGain = Math.abs(Math.sinc(theta_rad / theta_3dB));
            break;
          }
          default:
            elementGain = 1; // Isotropic
        }

        const gain_dBi = 20 * Math.log10(elementGain) + element.parameters.gain;
        gain.push([gain_dBi]);
      }
    }

    return {
      frequency: ('elements' in antenna) ? antenna.elements[0].parameters.frequency : antenna.parameters.frequency,
      theta,
      phi,
      gain
    };
  }

  optimizeAntenna(antenna: AntennaElement, targetGain: number, targetBandwidth: number): AntennaElement {
    // Simple optimization - adjust dimensions for target performance
    const optimized = { ...antenna };

    // Adjust length for gain
    if (targetGain > antenna.parameters.gain) {
      optimized.dimensions.length *= Math.sqrt(targetGain / antenna.parameters.gain);
    }

    // Adjust dimensions for bandwidth
    if (targetBandwidth > antenna.parameters.bandwidth) {
      optimized.dimensions.length *= 0.9; // Shorter for wider bandwidth
    }

    // Recalculate parameters
    optimized.parameters = this.calculateAntennaParameters(optimized);

    return optimized;
  }

  private calculateAntennaParameters(antenna: AntennaElement): AntennaParameters {
    // Simplified parameter calculation
    const frequency = antenna.parameters.frequency;
    const c = 299792458;
    const wavelength = c / frequency;

    let gain = 2.15; // Default dipole gain
    let impedance = 50;
    let bandwidth = frequency * 0.1;

    switch (antenna.type) {
      case 'dipole':
        gain = 2.15;
        impedance = 73;
        break;
      case 'monopole':
        gain = 2.15;
        impedance = 36.5;
        break;
      case 'patch':
        gain = 6;
        impedance = 50;
        bandwidth = frequency * 0.05;
        break;
    }

    return {
      frequency,
      wavelength,
      gain,
      directivity: gain, // Simplified
      efficiency: 85,
      bandwidth,
      vsWR: 1.5,
      impedance,
      polarization: 'linear'
    };
  }

  getArray(id: string): AntennaArray | undefined {
    return this.arrays.get(id);
  }

  getAllArrays(): AntennaArray[] {
    return Array.from(this.arrays.values());
  }
}

// Helper function for complex numbers (simplified)
function complex(re: number, im: number = 0) {
  return { re, im };
}

function multiply(a: { re: number; im: number }, b: { re: number; im: number }) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re
  };
}

function exp(i: { re: number; im: number }) {
  const r = Math.exp(i.re);
  return {
    re: r * Math.cos(i.im),
    im: r * Math.sin(i.im)
  };
}

// TypeScript doesn't have built-in complex numbers, so we'll use a simple implementation
const complex1 = { re: 0, im: 1 };

export const antennaDesigner = new AntennaDesigner();