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
  /** Monotonic suffix so designs created in the same millisecond stay distinct. */
  private nextId = 0;

  private static speedOfLight = 299792458;

  private makeId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}_${Date.now()}_${this.nextId}`;
  }

  private wavelengthAt(frequency: number): number {
    if (!Number.isFinite(frequency) || frequency <= 0) {
      throw new Error(`Antenna frequency must be a positive finite number, got ${frequency}.`);
    }
    return AntennaDesigner.speedOfLight / frequency;
  }

  /**
   * Power pattern U(θ) of a centre-fed linear dipole of arbitrary length,
   * `([cos(kL/2·cosθ) − cos(kL/2)] / sinθ)²`, unnormalised. The analytic limit on
   * the axis is zero, so the singular denominator is never evaluated there.
   */
  private dipolePattern(length: number, wavelength: number): (theta: number) => number {
    if (!(length > 0) || !(wavelength > 0)) {
      throw new Error('Dipole pattern needs a positive length and wavelength.');
    }
    const halfElectricalLength = Math.PI * length / wavelength;
    return (theta: number): number => {
      const sinTheta = Math.sin(theta);
      if (Math.abs(sinTheta) < 1e-12) return 0;
      const field = (Math.cos(halfElectricalLength * Math.cos(theta)) - Math.cos(halfElectricalLength)) / sinTheta;
      return field * field;
    };
  }

  /** Peak of the dipole power pattern, used to normalise plotted patterns. */
  private dipolePatternPeak(length: number, wavelength: number): number {
    const pattern = this.dipolePattern(length, wavelength);
    const samples = 2000;
    let peak = 0;
    for (let i = 0; i <= samples; i += 1) {
      peak = Math.max(peak, pattern((i / samples) * Math.PI));
    }
    if (!(peak > 0)) throw new Error('Dipole length produced a degenerate radiation pattern.');
    return peak;
  }

  /**
   * Directivity of a centre-fed linear dipole of arbitrary length, from that
   * same far-field pattern. Numerically integrates it rather than assuming the
   * half-wave value for every length. Returns a linear ratio (not dBi).
   */
  private dipoleDirectivityLinear(length: number, wavelength: number): number {
    const pattern = this.dipolePattern(length, wavelength);
    const samples = 2000;
    const step = Math.PI / samples;
    let peak = 0;
    // Simpson's rule keeps the 2.15 dBi half-wave value accurate to ~1e-9 dB.
    let weightedSum = 0;
    for (let i = 0; i <= samples; i += 1) {
      const theta = i * step;
      const power = pattern(theta);
      peak = Math.max(peak, power);
      const weight = i === 0 || i === samples ? 1 : i % 2 === 1 ? 4 : 2;
      weightedSum += weight * power * Math.sin(theta);
    }
    const integral = (weightedSum * step) / 3;
    if (!(peak > 0) || !(integral > 0)) {
      throw new Error('Dipole length produced a degenerate radiation pattern.');
    }
    // D = 4π·Umax / (2π·∫U sinθ dθ)
    return (2 * peak) / integral;
  }

  private directivityDbi(length: number, wavelength: number): number {
    return 10 * Math.log10(this.dipoleDirectivityLinear(length, wavelength));
  }

  designDipole(frequency: number, length?: number): AntennaElement {
    const wavelength = this.wavelengthAt(frequency);

    // Half-wave dipole only when no length was supplied; an explicit 0/NaN is
    // rejected rather than silently replaced by the default.
    const dipoleLength = length ?? wavelength / 2;
    if (!Number.isFinite(dipoleLength) || dipoleLength <= 0) {
      throw new Error(`Dipole length must be a positive finite number, got ${dipoleLength}.`);
    }

    const directivity = this.directivityDbi(dipoleLength, wavelength);

    return {
      id: this.makeId('dipole'),
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
        // No ohmic-loss model is bundled, so efficiency is 100% and gain equals
        // the numerically integrated directivity (2.15 dBi at half-wave).
        gain: directivity,
        directivity,
        efficiency: 100,
        bandwidth: frequency * 0.1, // 10% bandwidth
        vsWR: 1.5,
        impedance: 73, // ohms
        polarization: 'linear'
      }
    };
  }

  designMonopole(frequency: number, height?: number, groundPlaneRadius?: number): AntennaElement {
    const wavelength = this.wavelengthAt(frequency);

    const monopoleHeight = height ?? wavelength / 4;
    const gpRadius = groundPlaneRadius ?? wavelength / 4;
    if (!Number.isFinite(monopoleHeight) || !Number.isFinite(gpRadius) || monopoleHeight <= 0 || gpRadius <= 0) {
      throw new Error('Monopole height and ground-plane radius must be positive and finite.');
    }

    // A monopole over an infinite ground plane radiates into a hemisphere, so
    // its directivity is twice the dipole's (3 dB) for twice the wire length.
    const directivity = this.directivityDbi(2 * monopoleHeight, wavelength) + 10 * Math.log10(2);

    return {
      id: this.makeId('monopole'),
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
        gain: directivity,
        directivity,
        efficiency: 100,
        bandwidth: frequency * 0.15,
        vsWR: 1.8,
        impedance: 36.5, // ohms (half of dipole)
        polarization: 'linear'
      }
    };
  }

  designPatchAntenna(frequency: number, substrateHeight: number, dielectricConstant: number): AntennaElement {
    const wavelength = this.wavelengthAt(frequency);
    const epsilon_r = dielectricConstant;

    if (!(substrateHeight > 0) || !(epsilon_r >= 1)) {
      throw new Error('Patch antennas need a positive substrate height and dielectric constant >= 1.');
    }

    /*
     * Dominant TM010 mode. The effective permittivity depends on the patch
     * width (not the free-space wavelength), and the physical length is
     * shortened by the fringing extension on both radiating edges.
     */
    const patchWidth = (AntennaDesigner.speedOfLight / (2 * frequency)) * Math.sqrt(2 / (epsilon_r + 1));
    const ratio = patchWidth / substrateHeight;
    const effectiveEpsilon = (epsilon_r + 1) / 2 + (epsilon_r - 1) / 2 * Math.pow(1 + 12 / ratio, -0.5);
    const extension = 0.412 * substrateHeight *
      ((effectiveEpsilon + 0.3) * (ratio + 0.264)) /
      ((effectiveEpsilon - 0.258) * (ratio + 0.8));
    const patchLength = AntennaDesigner.speedOfLight / (2 * frequency * Math.sqrt(effectiveEpsilon)) - 2 * extension;
    if (!Number.isFinite(patchLength) || patchLength <= 0) {
      throw new Error(
        `Substrate ${substrateHeight} m at εr=${epsilon_r} makes the fringing extension ` +
        'larger than the half-wave resonator; the design has no positive patch length.',
      );
    }

    return {
      id: this.makeId('patch'),
      type: 'patch',
      position: { x: 0, y: 0 },
      orientation: { theta: 0, phi: 0, psi: 0 },
      dimensions: {
        length: patchLength,
        width: patchWidth,
        height: substrateHeight,
        effectiveEpsilon,
        feedOffset: patchLength / 4 // Quarter-wave feed
      },
      material: 'copper',
      parameters: {
        frequency,
        wavelength,
        gain: 6, // dBi typical for patch
        // G = η·D, so D is 1.55 dB above the quoted realised gain at 70% efficiency.
        directivity: 6 - 10 * Math.log10(0.7),
        efficiency: 70,
        bandwidth: frequency * 0.05, // 5% bandwidth
        vsWR: 2.0,
        impedance: 50, // ohms (matched)
        polarization: 'linear'
      }
    };
  }

  designYagiUda(frequency: number, numElements: number = 5): AntennaArray {
    const wavelength = this.wavelengthAt(frequency);
    if (!Number.isInteger(numElements) || numElements < 2) {
      throw new Error('A Yagi-Uda array needs at least two elements (reflector and driven element).');
    }

    const elements: AntennaElement[] = [];
    const spacing = wavelength * 0.25; // Quarter wavelength spacing

    // Driven element
    const drivenElement = this.designDipole(frequency);
    drivenElement.position.x = 0;
    elements.push(drivenElement);

    // Directors (the reflector below brings the total to numElements)
    for (let i = 1; i < numElements - 1; i++) {
      const director = this.designDipole(frequency, wavelength * 0.45); // Slightly shorter
      director.position.x = i * spacing;
      elements.push(director);
    }

    // Reflector (slightly longer)
    const reflector = this.designDipole(frequency, wavelength * 0.55);
    reflector.position.x = -spacing;
    elements.unshift(reflector);

    const array: AntennaArray = {
      id: this.makeId('yagi'),
      name: `Yagi-Uda ${elements.length} elements`,
      elements,
      arrayType: 'linear',
      spacing: { dx: spacing, dy: 0, dz: 0 },
      amplitudeTaper: new Array(elements.length).fill(1),
      phaseTaper: new Array(elements.length).fill(0),
      feedingNetwork: 'series'
    };

    this.arrays.set(array.id, array);
    return array;
  }

  designPhasedArray(frequency: number, numElements: number, arrayType: 'linear' | 'circular' = 'linear'): AntennaArray {
    const wavelength = this.wavelengthAt(frequency);
    if (!Number.isInteger(numElements) || numElements < 2) {
      throw new Error('A phased array needs at least two elements.');
    }
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
      id: this.makeId('phased'),
      name: `Phased Array ${numElements} elements`,
      elements,
      arrayType,
      spacing: { dx: spacing, dy: spacing, dz: 0 },
      amplitudeTaper: this.calculateCoshAmplitudeTaper(numElements),
      phaseTaper: new Array(numElements).fill(0),
      feedingNetwork: 'corporate'
    };

    this.arrays.set(array.id, array);
    return array;
  }

  private calculateCoshAmplitudeTaper(n: number): number[] {
    // Symmetric cosh taper: low sidelobes at the cost of a wider main beam.
    // This is not a Taylor-Σ distribution; no sidelobe-level argument is exposed.
    if (n <= 1) return new Array(Math.max(1, n)).fill(1)
    const weights: number[] = [];
    const sigma = 2; // Taper steepness

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
    if (!Number.isInteger(numPoints) || numPoints < 2) {
      throw new Error('A radiation pattern needs at least two angular samples.');
    }
    const theta: number[] = [];
    const phi: number[] = [];
    const gain: number[][] = [];

    // Generate angular points
    for (let i = 0; i < numPoints; i++) {
      theta.push((i / numPoints) * 180); // 0 to 180 degrees
      phi.push(0); // Principal plane (phi = 0)
    }

    // Calculate gain pattern
    if ('elements' in antenna) {
      // Array pattern
      const array = antenna as AntennaArray;
      const peakElementGain = array.elements[0]?.parameters.gain ?? 2.15;
      const weightPower = array.elements.reduce((sum, _element, index) => {
        const weight = array.amplitudeTaper[index] ?? 1;
        return sum + weight * weight;
      }, 0);

      for (let i = 0; i < numPoints; i++) {
        const theta_rad = (theta[i] * Math.PI) / 180;
        let totalFieldRe = 0;
        let totalFieldIm = 0;

        array.elements.forEach((element, idx) => {
          const phase = (array.phaseTaper[idx] ?? 0) * Math.PI / 180;
          const amplitude = array.amplitudeTaper[idx] ?? 1;

          // Array factor on a principal-plane cut; element patterns are
          // represented by their peak gain, so the pattern is not renormalized
          // away. Dividing by sqrt(sum(w^2)) scales a uniform aperture to the
          // physical 10*log10(N) coherent gain instead of 20*log10(N).
          const k = 2 * Math.PI / element.parameters.wavelength;
          const pathLength = element.position.x * Math.sin(theta_rad);
          const arrayPhase = k * pathLength;
          const angle = phase + arrayPhase;

          totalFieldRe += amplitude * Math.cos(angle);
          totalFieldIm += amplitude * Math.sin(angle);
        });

        const normalized = weightPower > 0
          ? Math.hypot(totalFieldRe, totalFieldIm) / Math.sqrt(weightPower)
          : 0;
        // Clamp the nulls so a plotted pattern stays finite; -60 dBi is the floor.
        const gain_dBi = Math.max(-60, 20 * Math.log10(Math.max(normalized, 1e-6)) + peakElementGain);
        gain.push([gain_dBi]);
      }
    } else {
      // Single element pattern
      const element = antenna as AntennaElement;
      // A dipole's quoted gain is its peak directivity, so the far-field shape
      // must be normalized by the peak for that length (1 for a half-wave).
      const dipoleLength = element.dimensions.length ?? element.parameters.wavelength / 2;
      const patternWavelength = element.parameters.wavelength;
      const dipoleShape = element.type === 'dipole'
        ? this.dipolePattern(dipoleLength, patternWavelength)
        : null;
      const dipolePeakPower = dipoleShape
        ? this.dipolePatternPeak(dipoleLength, patternWavelength)
        : 1;

      for (let i = 0; i < numPoints; i++) {
        const theta_rad = (theta[i] * Math.PI) / 180;
        let elementGain = 0;

        // Each case returns a *power* pattern (0..1); the common conversion
        // below is 10·log10 so a field expression must be squared first.
        switch (element.type) {
          case 'dipole': {
            /*
             * Centre-fed linear dipole of the element's own length, from the
             * same far field the directivity integrator uses. Using the
             * half-wave expression for every length would draw a plausible but
             * wrong pattern for an optimised or full-wave element.
             */
            elementGain = (dipoleShape ? dipoleShape(theta_rad) : 0) / dipolePeakPower;
            break;
          }
          case 'monopole':
            // Monopole over an infinite ground plane: sin²θ power pattern.
            elementGain = theta_rad <= Math.PI / 2 ? Math.sin(theta_rad) ** 2 : 0;
            break;
          case 'patch': {
            // Broadside patch: a cos^n power taper whose half-power point is
            // 30 degrees off broadside (60 degree full -3 dB beamwidth).
            const halfPowerExponent = Math.log(0.5) / Math.log(Math.cos(Math.PI / 6));
            elementGain = theta_rad <= Math.PI / 2
              ? Math.pow(Math.max(Math.cos(theta_rad), 0), halfPowerExponent)
              : 0;
            break;
          }
          default:
            elementGain = 1; // Isotropic
        }

        const gain_dBi = elementGain > 0
          ? Math.max(-60, 10 * Math.log10(elementGain) + element.parameters.gain)
          : -60;
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

  /**
   * Resize a wire antenna for a target realised gain. The dipole directivity is
   * integrated from the true far-field pattern, so the returned length really is
   * the one that meets the target. Unreachable targets and bandwidth requests
   * that the lossless-wire model cannot deliver are rejected, not approximated.
   */
  optimizeAntenna(antenna: AntennaElement, targetGain: number, targetBandwidth: number): AntennaElement {
    if (!Number.isFinite(targetGain) || !Number.isFinite(targetBandwidth) || targetBandwidth <= 0) {
      throw new Error('Antenna optimisation needs a finite target gain and a positive bandwidth.');
    }
    if (antenna.type !== 'dipole' && antenna.type !== 'monopole') {
      throw new Error(`Gain optimisation is modelled for dipole/monopole wire antennas, not '${antenna.type}'.`);
    }

    const frequency = antenna.parameters.frequency;
    const wavelength = this.wavelengthAt(frequency);
    const efficiency = antenna.parameters.efficiency / 100;
    const gainForLength = (length: number): number => {
      const directivity = antenna.type === 'dipole'
        ? this.dipoleDirectivityLinear(length, wavelength)
        : 2 * this.dipoleDirectivityLinear(2 * length, wavelength);
      return 10 * Math.log10(directivity * efficiency);
    };

    const minLength = 0.05 * wavelength;
    const maxLength = 1.25 * wavelength;
    let bestLength = minLength;
    let bestGain = gainForLength(minLength);
    const step = (maxLength - minLength) / 200;
    for (let i = 0; i <= 200; i += 1) {
      const length = minLength + i * step;
      const gain = gainForLength(length);
      if (Math.abs(gain - targetGain) < Math.abs(bestGain - targetGain)) {
        bestLength = length;
        bestGain = gain;
      }
    }
    // Refine around the coarse minimum.
    const refineStep = step / 40;
    for (let i = -40; i <= 40; i += 1) {
      const length = Math.min(maxLength, Math.max(minLength, bestLength + i * refineStep));
      const gain = gainForLength(length);
      if (Math.abs(gain - targetGain) < Math.abs(bestGain - targetGain)) {
        bestLength = length;
        bestGain = gain;
      }
    }

    if (Math.abs(bestGain - targetGain) > 0.25) {
      const low = gainForLength(minLength);
      const high = gainForLength(maxLength);
      throw new Error(
        `A ${antenna.type} of 0.05λ–1.25λ reaches ${low.toFixed(2)}–${high.toFixed(2)} dBi; ` +
        `${targetGain.toFixed(2)} dBi is outside that range.`,
      );
    }

    const modelledBandwidth = frequency * (antenna.type === 'dipole' ? 0.1 : 0.15);
    if (targetBandwidth > modelledBandwidth * 1.0001) {
      throw new Error(
        `The wire model supports ${(modelledBandwidth / 1e6).toFixed(3)} MHz bandwidth; ` +
        `${(targetBandwidth / 1e6).toFixed(3)} MHz needs a thicker conductor or a different geometry.`,
      );
    }

    const optimized: AntennaElement = {
      ...antenna,
      dimensions: { ...antenna.dimensions },
    };
    if (antenna.type === 'dipole') {
      optimized.dimensions.length = bestLength;
    } else {
      optimized.dimensions.height = bestLength;
    }
    optimized.parameters = this.calculateAntennaParameters(optimized);
    return optimized;
  }

  private calculateAntennaParameters(antenna: AntennaElement): AntennaParameters {
    const frequency = antenna.parameters.frequency;
    const wavelength = this.wavelengthAt(frequency);
    const efficiency = antenna.parameters.efficiency / 100;

    switch (antenna.type) {
      case 'dipole': {
        const length = antenna.dimensions.length ?? wavelength / 2;
        const directivity = this.directivityDbi(length, wavelength);
        return {
          ...antenna.parameters,
          frequency,
          wavelength,
          gain: directivity + 10 * Math.log10(efficiency),
          directivity,
          impedance: 73,
          bandwidth: frequency * 0.1,
        };
      }
      case 'monopole': {
        const height = antenna.dimensions.height ?? wavelength / 4;
        const directivity = this.directivityDbi(2 * height, wavelength) + 10 * Math.log10(2);
        return {
          ...antenna.parameters,
          frequency,
          wavelength,
          gain: directivity + 10 * Math.log10(efficiency),
          directivity,
          impedance: 36.5,
          bandwidth: frequency * 0.15,
        };
      }
      default:
        return { ...antenna.parameters, frequency, wavelength };
    }
  }

  getArray(id: string): AntennaArray | undefined {
    return this.arrays.get(id);
  }

  getAllArrays(): AntennaArray[] {
    return Array.from(this.arrays.values());
  }
}

export const antennaDesigner = new AntennaDesigner();
