import { Point } from '../../types';

/**
 * Stable codes for design results the implemented physics cannot deliver.
 * They are machine-readable so a consumer can render an explicit
 * "not modelled — reason" state instead of a blank cell or a fabricated number.
 */
export type AntennaNotModeledReason =
  | 'reactance-not-modeled'
  | 'cavity-q-not-modeled'
  | 'no-complex-input-impedance'
  | 'azimuthally-symmetric-pattern';

/** Model assumptions a result rests on. The UI must label these as assumptions. */
export type AntennaAssumption =
  | 'loss-free-efficiency'
  | 'mutual-slot-conductance-neglected'
  | 'resistive-only-feed-match';

export const ANTENNA_NOT_MODELED_TEXT: Record<AntennaNotModeledReason, string> = {
  'reactance-not-modeled':
    'thin-wire reactance kernel (needs the wire radius) is not implemented, so only the radiation resistance is computed',
  'cavity-q-not-modeled':
    'bandwidth needs the cavity quality factors (radiation, conductor, dielectric); only the aperture conductance and far field are computed',
  'no-complex-input-impedance':
    'VSWR needs the complex input impedance against a defined load; the model reports a real radiation resistance only',
  'azimuthally-symmetric-pattern':
    'the wire pattern is azimuthally symmetric, so there is no separate H-plane lobe to measure',
};

export const ANTENNA_ASSUMPTION_TEXT: Record<AntennaAssumption, string> = {
  'loss-free-efficiency':
    'assumed, not computed: conductor, dielectric and surface-wave loss are not modelled, so gain equals the integrated directivity',
  'mutual-slot-conductance-neglected':
    'edge resistance is 1/(2*G1) and drops the mutual slot conductance G12, which under-reports it for electrically short patches',
  'resistive-only-feed-match':
    'the inset depth transforms the computed edge resistance to 50 ohms resistively; with no reactance modelled the match is not verified over frequency',
};

export interface AntennaParameters {
  frequency: number; // Hz
  wavelength: number; // meters
  gain: number; // dBi
  directivity: number; // dBi, integrated from the computed far field
  /** Percent. Read `assumptions`: with no loss model attached this is 100 by assumption. */
  efficiency: number;
  /** Hz. null when the model cannot compute it — see `notModeled`. */
  bandwidth: number | null;
  /** null when the model cannot compute it — see `notModeled`. */
  vsWR: number | null;
  /**
   * Real part of the input impedance, ohms (wire: radiation resistance referred
   * to the feed current; patch: two-slot edge resistance). The reactive term is
   * not modelled, so this is not a matched-50-ohm claim.
   */
  impedance: number;
  /** Full -3 dB beamwidth of the computed main lobe in the E-plane cut, degrees. */
  ePlaneBeamwidth: number | null;
  /**
   * Full -3 dB beamwidth in the H-plane cut, degrees. null for the wire
   * geometries — see `notModeled.hPlaneBeamwidth` — whose pattern is
   * azimuthally symmetric and so has no H-plane lobe.
   */
  hPlaneBeamwidth: number | null;
  polarization: 'linear' | 'circular' | 'elliptical';
  notModeled: Partial<Record<'bandwidth' | 'vsWR' | 'hPlaneBeamwidth', AntennaNotModeledReason>>;
  assumptions: AntennaAssumption[];
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

/** sinc(x) = sin(x)/x with the removable singularity at zero filled in. */
function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(x) / x;
}

export class AntennaDesigner {
  private arrays: Map<string, AntennaArray> = new Map();
  /** Monotonic suffix so designs created in the same millisecond stay distinct. */
  private nextId = 0;

  private static speedOfLight = 299792458;
  /** eta_0 = 120 pi ohms, so (eta_0 / 2 pi) = 60 in the radiation-resistance integral. */
  private static freeSpaceImpedance = 120 * Math.PI;
  /** Simpson nodes for the 1D wire integral (converged to ~1e-13 relative at 200). */
  private static readonly wireSegments = 2000;
  /**
   * Simpson nodes per axis for the aperture integral. The two-slot integrand is
   * analytic on the hemisphere, so 200 nodes reproduce the exact small-aperture
   * limit D = 480/101 to better than 1e-6.
   */
  private static readonly apertureSegments = 200;
  /** Balanis's transmission-line slot model: G1 drops the mutual conductance G12. */
  private static readonly slotWidthRatioLimit = 0.5;
  /** S1 = 1 + (k0h)^2/2 - (k0h)^4/24 is a truncated thin-substrate series. */
  private static readonly slotElectricalHeightLimit = 0.75;
  private static readonly targetFeedImpedance = 50;

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
   * Composite Simpson integral on [from, to]. Both the wire and the aperture
   * integrands are smooth on their own interval, which is why the interval is
   * passed explicitly rather than always integrating to pi.
   */
  private integrateSimpson(
    f: (x: number) => number,
    from: number,
    to: number,
    segments: number,
  ): number {
    const step = (to - from) / segments;
    let sum = 0;
    for (let i = 0; i <= segments; i += 1) {
      const weight = i === 0 || i === segments ? 1 : i % 2 === 1 ? 4 : 2;
      sum += weight * f(from + i * step);
    }
    return (sum * step) / 3;
  }

  /**
   * Power pattern U(theta) of a centre-fed linear dipole of arbitrary length,
   * `([cos(kL/2*cos theta) - cos(kL/2)] / sin theta)^2`, unnormalised. The analytic limit on
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

  /**
   * Peak and the solid-angle integral of the *same* far field, in one pass:
   * `integral = int_0^pi g^2 sin(theta) d theta`. Directivity, radiation
   * resistance and pattern normalisation all read these two numbers, so a
   * reported resistance cannot drift away from the plotted pattern.
   */
  private dipolePatternMoments(length: number, wavelength: number): { peak: number; integral: number } {
    const pattern = this.dipolePattern(length, wavelength);
    const segments = AntennaDesigner.wireSegments;
    let peak = 0;
    const integral = this.integrateSimpson(
      (theta) => {
        const power = pattern(theta);
        if (power > peak) peak = power;
        return power * Math.sin(theta);
      },
      0,
      Math.PI,
      segments,
    );
    if (!(peak > 0) || !(integral > 0)) {
      throw new Error('Dipole length produced a degenerate radiation pattern.');
    }
    return { peak, integral };
  }

  /**
   * Directivity of a centre-fed linear dipole of arbitrary length from that same
   * far field: D = 4*pi*Umax / (2*pi*integral). Numerically integrated rather
   * than assuming the half-wave value for every length.
   */
  private dipoleDirectivityLinear(length: number, wavelength: number): number {
    const { peak, integral } = this.dipolePatternMoments(length, wavelength);
    return (2 * peak) / integral;
  }

  /**
   * Input resistance of a centre-fed thin dipole, referred to the *feed-point*
   * current, from the same far field: P = (eta_0*I_m^2/4*pi)*integral, so
   * Rr = 2P/I_m^2 = 60*integral. The sinusoidal standing wave has a feed-point
   * current of I_m*sin(kL/2), and dividing by it is what turns the
   * (L/lambda)^4 law of the current maximum into the (L/lambda)^2 law measured at
   * the terminals (73 ohms at half-wave, 20*pi^2*(L/lambda)^2 when short).
   *
   * The reactive term is NOT modelled: getting X requires the thin-wire kernel
   * with the wire radius as an argument, which is not implemented here.
   */
  private dipoleInputResistance(length: number, wavelength: number): number {
    const { integral } = this.dipolePatternMoments(length, wavelength);
    const feedCurrentFactor = Math.sin((Math.PI * length) / wavelength);
    if (Math.abs(feedCurrentFactor) < 1e-6) {
      throw new Error(
        `A ${length / wavelength} wavelength dipole is fed at a current null, so its input ` +
        'resistance diverges in the thin-wire model and cannot be reported.',
      );
    }
    return (
      (AntennaDesigner.freeSpaceImpedance / (2 * Math.PI)) *
      integral /
      (feedCurrentFactor * feedCurrentFactor)
    );
  }

  /**
   * Full -3 dB beamwidth, in degrees, of the main lobe of a power pattern on the
   * cut [from, to]. The peak is located on a fine grid, then each half-power
   * crossing is bracketed and refined by bisection. A peak pinned to the edge of
   * the scanned cut means the physical lobe continues symmetrically outside it
   * (patch boresight), so that side is mirrored rather than truncated.
   */
  private mainLobeBeamwidthDeg(power: (theta: number) => number, from: number, to: number): number {
    const segments = 4096;
    const step = (to - from) / segments;
    const values = new Float64Array(segments + 1);
    let peakIndex = 0;
    for (let i = 0; i <= segments; i += 1) {
      values[i] = power(from + i * step);
      if (values[i] > values[peakIndex]) peakIndex = i;
    }
    const half = values[peakIndex] * 0.5;
    const bisect = (lo: number, hi: number): number => {
      for (let k = 0; k < 64; k += 1) {
        const mid = (lo + hi) * 0.5;
        if (power(mid) > half) lo = mid;
        else hi = mid;
      }
      return (lo + hi) * 0.5;
    };
    let right = to;
    for (let i = peakIndex; i < segments; i += 1) {
      if (values[i + 1] <= half) {
        right = bisect(from + i * step, from + (i + 1) * step);
        break;
      }
    }
    let left = from;
    for (let i = peakIndex; i > 0; i -= 1) {
      if (values[i - 1] <= half) {
        left = bisect(from + (i - 1) * step, from + i * step);
        break;
      }
    }
    const oneSided =
      (peakIndex === 0 ? right - from : 0) + (peakIndex === segments ? to - left : 0);
    return ((right - left + oneSided) * 180) / Math.PI;
  }

  /**
   * Parameters shared by the centre-fed dipole and the monopole.
   * `dipoleLength` is the total length of the equivalent centre-fed dipole; for
   * a monopole of height h over an infinite ground plane, image theory makes
   * that 2h and halves both the radiated power and the resistance at the same
   * terminal current, while doubling the directivity.
   */
  private wireAntennaParameters(
    kind: 'dipole' | 'monopole',
    frequency: number,
    wavelength: number,
    dipoleLength: number,
    efficiency: number,
  ): AntennaParameters {
    const moments = this.dipolePatternMoments(dipoleLength, wavelength);
    const groundPlaneFactor = kind === 'monopole' ? 10 * Math.log10(2) : 0;
    const directivity = 10 * Math.log10((2 * moments.peak) / moments.integral) + groundPlaneFactor;
    const dipoleResistance = this.dipoleInputResistance(dipoleLength, wavelength);
    // Image theory: the monopole radiates half the dipole's power at the same
    // base current, so its radiation resistance is exactly half. Derived here
    // rather than quoted as the textbook 36.5 ohms.
    const impedance = kind === 'monopole' ? dipoleResistance / 2 : dipoleResistance;
    const pattern = this.dipolePattern(dipoleLength, wavelength);
    const peak = moments.peak;
    return {
      frequency,
      wavelength,
      gain: directivity + 10 * Math.log10(efficiency / 100),
      directivity,
      efficiency,
      // A resistance-only bandwidth claim would be wildly optimistic: the -3 dB
      // bandwidth of a wire is set by the reactance slope, which is not modelled.
      bandwidth: null,
      vsWR: null,
      impedance,
      // The dipole pattern is even about broadside for any length, and the
      // ground plane only mirrors the half that is kept, so the same width
      // applies to both terminals' lobe.
      ePlaneBeamwidth: this.mainLobeBeamwidthDeg((theta) => pattern(theta) / peak, 0, Math.PI),
      // No H-plane lobe exists to measure; `notModeled` carries the reason so the
      // consumer can label it instead of showing a dash.
      hPlaneBeamwidth: null,
      polarization: 'linear',
      notModeled: {
        bandwidth: 'reactance-not-modeled',
        vsWR: 'no-complex-input-impedance',
        hPlaneBeamwidth: 'azimuthally-symmetric-pattern',
      },
      assumptions: ['loss-free-efficiency'],
    };
  }

  /** Peak of a power pattern over a restricted cut (the hemisphere below a ground plane). */
  private powerPatternPeak(power: (theta: number) => number, from: number, to: number): number {
    const segments = AntennaDesigner.wireSegments;
    let peak = 0;
    for (let i = 0; i <= segments; i += 1) {
      peak = Math.max(peak, power(from + ((to - from) * i) / segments));
    }
    if (!(peak > 0)) throw new Error('Antenna length produced a degenerate radiation pattern.');
    return peak;
  }

  designDipole(frequency: number, length?: number): AntennaElement {
    const wavelength = this.wavelengthAt(frequency);

    // Half-wave dipole only when no length was supplied; an explicit 0/NaN is
    // rejected rather than silently replaced by the default.
    const dipoleLength = length ?? wavelength / 2;
    if (!Number.isFinite(dipoleLength) || dipoleLength <= 0) {
      throw new Error(`Dipole length must be a positive finite number, got ${dipoleLength}.`);
    }

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
      parameters: this.wireAntennaParameters('dipole', frequency, wavelength, dipoleLength, 100)
    };
  }

  designMonopole(frequency: number, height?: number, groundPlaneRadius?: number): AntennaElement {
    const wavelength = this.wavelengthAt(frequency);

    const monopoleHeight = height ?? wavelength / 4;
    const gpRadius = groundPlaneRadius ?? wavelength / 4;
    if (!Number.isFinite(monopoleHeight) || !Number.isFinite(gpRadius) || monopoleHeight <= 0 || gpRadius <= 0) {
      throw new Error('Monopole height and ground-plane radius must be positive and finite.');
    }

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
      // Image theory: the monopole is the upper half of a 2h dipole.
      parameters: this.wireAntennaParameters('monopole', frequency, wavelength, 2 * monopoleHeight, 100)
    };
  }

  /**
   * Edge conductance of one radiating slot, Balanis's transmission-line model:
   * G1 = (1/90)*(W/lambda0)^2*S1 with S1 = 1 + (k0h)^2/2 - (k0h)^4/24. The
   * truncated S1 series and the drop of the mutual conductance G12 both require
   * a narrow slot on a thin substrate, which the caller enforces.
   */
  private slotConductance(patchWidth: number, wavelength: number, substrateHeight: number): number {
    const k0h = (2 * Math.PI * substrateHeight) / wavelength;
    const s1 = 1 + (k0h * k0h) / 2 - (k0h ** 4) / 24;
    const ratio = patchWidth / wavelength;
    return (ratio * ratio * s1) / 90;
  }

  /**
   * Two-slot (magnetic current) aperture power pattern of a rectangular patch,
   * normalised to 1 at boresight. theta is measured from broadside, phi = 0 is
   * the E-plane (the plane containing the length L, along which the cavity
   * fields fringe and the two slots sit) and phi = 90 degrees is the H-plane:
   *
   *   - the cos distribution along the length puts equal, in-phase voltages on
   *     the two edges, so their separation gives the array factor
   *     cos(k0*L*sin(theta)*cos(phi)/2);
   *   - each slot is uniformly illuminated across the width, giving
   *     sinc(k0*W*sin(theta)*sin(phi)/2);
   *   - an aperture in a ground plane carries the (1 + cos theta)/2 obliquity
   *     factor, and the transversality projection cos^2(phi) + cos^2(theta) *
   *     sin^2(phi) of the slot's magnetic current, which is what kills the
   *     grazing radiation the array factor alone would leave standing.
   */
  private patchAperturePower(
    patchWidth: number,
    patchLength: number,
    wavelength: number,
  ): (theta: number, phi: number) => number {
    if (!(patchWidth > 0) || !(patchLength > 0) || !(wavelength > 0)) {
      throw new Error('Patch aperture needs a positive width, length and wavelength.');
    }
    const k0 = (2 * Math.PI) / wavelength;
    return (theta: number, phi: number): number => {
      const cosTheta = Math.cos(theta);
      // Nothing radiates into the lower hemisphere: the ground plane shadows it.
      // The horizon is only ever evaluated as a quadrature endpoint, where
      // floating point can land a hair past pi/2; treating that rounding as
      // "below the plane" would put the model's one discontinuity exactly on a
      // Simpson node and cost the integral its fourth-order convergence.
      if (cosTheta < -1e-12) return 0;
      const sinTheta = Math.sin(theta);
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const obliquity = (1 + cosTheta) / 2;
      const projection = cosPhi * cosPhi + cosTheta * cosTheta * sinPhi * sinPhi;
      const slotSeparation = Math.cos((k0 * patchLength * sinTheta * cosPhi) / 2);
      const slotWidth = sinc((k0 * patchWidth * sinTheta * sinPhi) / 2);
      const amplitude = obliquity * slotSeparation * slotWidth;
      return amplitude * amplitude * projection;
    };
  }

  /**
   * Directivity of the two-slot aperture, integrated over the hemisphere the
   * ground plane actually radiates into. Cross-checks exactly in the limit
   * W, L -> 0, where the pattern collapses to the obliquity times the
   * transversality projection and D -> 480/101.
   */
  private patchDirectivityLinear(
    patchWidth: number,
    patchLength: number,
    wavelength: number,
  ): number {
    const pattern = this.patchAperturePower(patchWidth, patchLength, wavelength);
    const peak = pattern(0, 0);
    const segments = AntennaDesigner.apertureSegments;
    const inner = (theta: number): number =>
      this.integrateSimpson((phi) => pattern(theta, phi) * Math.sin(theta), 0, Math.PI / 2, segments);
    // P = integral over 0..2pi of phi; the pattern is periodic and even in phi
    // about both axes, so one quadrant times four is the whole hemisphere.
    const radiated = 4 * this.integrateSimpson(inner, 0, Math.PI / 2, segments);
    if (!(radiated > 0) || !(peak > 0)) {
      throw new Error('Patch geometry produced a degenerate aperture pattern.');
    }
    return (4 * Math.PI * peak) / radiated;
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

    /*
     * Two-slot model limits. W/lambda0 > 0.5 is rejected rather than
     * extrapolated because G12, which this implementation drops, is no longer
     * negligible there; the (k0h)^2 series for S1 is truncated, so an
     * electrically thick substrate is rejected for the same reason.
     */
    const widthRatio = patchWidth / wavelength;
    if (widthRatio > AntennaDesigner.slotWidthRatioLimit) {
      throw new Error(
        `W/lambda0 = ${widthRatio.toFixed(3)} exceeds the ${AntennaDesigner.slotWidthRatioLimit} ` +
        'limit of the two-slot model: the mutual slot conductance is no longer negligible.',
      );
    }
    const k0h = (2 * Math.PI * substrateHeight) / wavelength;
    if (k0h > AntennaDesigner.slotElectricalHeightLimit) {
      throw new Error(
        `k0*h = ${k0h.toFixed(3)} exceeds the ${AntennaDesigner.slotElectricalHeightLimit} limit of the ` +
        'thin-substrate slot admittance series; the substrate is electrically thick.',
      );
    }

    const conductance = this.slotConductance(patchWidth, wavelength, substrateHeight);
    // Real part of the input resistance at the radiating edge. This replaces the
    // old "50 ohm matched" claim: a probe at the edge sees a few hundred ohms.
    const edgeResistance = 1 / (2 * conductance);
    const directivity = 10 * Math.log10(this.patchDirectivityLinear(patchWidth, patchLength, wavelength));
    const pattern = this.patchAperturePower(patchWidth, patchLength, wavelength);
    const peak = pattern(0, 0);
    const insetDepth = edgeResistance > AntennaDesigner.targetFeedImpedance
      // R(x) = R(edge)*cos^2(pi*x/L) for a feed moved inward from the edge.
      ? (patchLength / Math.PI) * Math.acos(Math.sqrt(AntennaDesigner.targetFeedImpedance / edgeResistance))
      : 0;

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
        feedOffset: insetDepth
      },
      material: 'copper',
      parameters: {
        frequency,
        wavelength,
        // Loss-free aperture: gain is the integrated aperture directivity, and
        // the efficiency below is an assumption the UI has to label as one.
        gain: directivity,
        directivity,
        efficiency: 100,
        // Cavity Q (radiation + conductor + dielectric) is not implemented, so
        // neither bandwidth nor VSWR can be computed. See notModeled.
        bandwidth: null,
        vsWR: null,
        impedance: edgeResistance,
        ePlaneBeamwidth: this.mainLobeBeamwidthDeg((theta) => pattern(theta, 0) / peak, 0, Math.PI / 2),
        hPlaneBeamwidth: this.mainLobeBeamwidthDeg((theta) => pattern(theta, Math.PI / 2) / peak, 0, Math.PI / 2),
        polarization: 'linear',
        notModeled: {
          bandwidth: 'cavity-q-not-modeled',
          vsWR: 'no-complex-input-impedance',
        },
        assumptions: [
          'loss-free-efficiency',
          'mutual-slot-conductance-neglected',
          'resistive-only-feed-match',
        ],
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
      // A wire's quoted gain is its peak directivity, so the far-field shape
      // must be normalized by the peak for that length (1 for a half-wave).
      const patternWavelength = element.parameters.wavelength;
      const wireLength = element.type === 'monopole'
        ? 2 * (element.dimensions.height ?? patternWavelength / 4)
        : element.dimensions.length ?? patternWavelength / 2;
      const wireShape = element.type === 'dipole' || element.type === 'monopole'
        ? this.dipolePattern(wireLength, patternWavelength)
        : null;
      // A monopole only exists above the ground plane, so its plotted peak is
      // the peak of the hemisphere, not of the full dipole lobe.
      const wirePeak = wireShape
        ? this.powerPatternPeak(wireShape, 0, element.type === 'monopole' ? Math.PI / 2 : Math.PI)
        : 1;
      const patchAperture = element.type === 'patch'
        ? this.patchAperturePower(
          element.dimensions.width,
          element.dimensions.length,
          patternWavelength,
        )
        : null;

      for (let i = 0; i < numPoints; i++) {
        const theta_rad = (theta[i] * Math.PI) / 180;
        let elementGain = 0;

        // Each case returns a *power* pattern (0..1); the common conversion
        // below is 10·log10 so a field expression must be squared first.
        switch (element.type) {
          case 'dipole':
          case 'monopole': {
            /*
             * Centre-fed linear wire of the element's own length (twice the
             * monopole height, by image theory), from the same far field the
             * directivity and radiation-resistance integrals use. Using the
             * half-wave expression for every length would draw a plausible but
             * wrong pattern for an optimised or full-wave element.
             */
            // The monopole's ground plane screens the lower hemisphere: image
            // theory only holds above it, so there is no lobe to plot below.
            elementGain = wireShape && !(element.type === 'monopole' && theta_rad > Math.PI / 2)
              ? wireShape(theta_rad) / wirePeak
              : 0;
            break;
          }
          case 'patch': {
            /*
             * E-plane cut of the two-slot aperture, with the width and length
             * this element actually derived: the -3 dB beamwidth falls out of
             * the geometry instead of being forced by choosing a cos^n exponent.
             */
            elementGain = theta_rad <= Math.PI / 2 && patchAperture ? patchAperture(theta_rad, 0) : 0;
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
   * the one that meets the target. A bandwidth target is rejected outright: the
   * thin-wire model reports the radiation resistance only, so it cannot say
   * whether any bandwidth is met, and quoting one would be a fabricated result.
   */
  optimizeAntenna(
    antenna: AntennaElement,
    targetGain: number,
    targetBandwidth?: number,
  ): AntennaElement {
    if (!Number.isFinite(targetGain)) {
      throw new Error('Antenna optimisation needs a finite target gain.');
    }
    if (targetBandwidth !== undefined && (!Number.isFinite(targetBandwidth) || targetBandwidth <= 0)) {
      throw new Error('Antenna optimisation needs a positive bandwidth target.');
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

    // Checked last so an unreachable gain is still reported as unreachable.
    if (targetBandwidth !== undefined) {
      throw new Error(
        `Bandwidth is not modelled for a ${antenna.type}: only the radiation resistance is ` +
        `computed, so a ${(targetBandwidth / 1e6).toFixed(3)} MHz bandwidth target can neither be met nor refused.`,
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
        return this.wireAntennaParameters('dipole', frequency, wavelength, length, efficiency * 100);
      }
      case 'monopole': {
        const height = antenna.dimensions.height ?? wavelength / 4;
        return this.wireAntennaParameters('monopole', frequency, wavelength, 2 * height, efficiency * 100);
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
