import { PCBDesign, PCBTrace, PCBPad, PCBVIA, PCBValidationError, PCBValidationWarning } from './pcb';

export interface DRCViolation {
  type: 'clearance' | 'width' | 'drill' | 'annular_ring' | 'silk_to_pad' | 'courtyard_overlap';
  severity: 'error' | 'warning';
  message: string;
  location: { x: number; y: number };
  elementId: string;
  layer?: string;
  value?: number;
  required?: number;
}

export interface DRCResult {
  isValid: boolean;
  violations: DRCViolation[];
  summary: {
    errors: number;
    warnings: number;
    totalViolations: number;
  };
}

export class DesignRuleChecker {
  private design: PCBDesign;
  private rules: DRCSettings;

  constructor(design: PCBDesign, rules?: Partial<DRCSettings>) {
    this.design = design;
    this.rules = { ...this.getDefaultRules(), ...rules };
  }

  private getDefaultRules(): DRCSettings {
    return {
      minTraceWidth: 0.2,
      minTraceClearance: 0.2,
      minViaDiameter: 0.4,
      minViaDrillDiameter: 0.2,
      minPadDiameter: 0.5,
      minAnnularRing: 0.1,
      minSilkToPadClearance: 0.15,
      minCourtyardClearance: 0.25,
      maxTraceWidth: 2.0,
      minHoleDiameter: 0.3,
      solderMaskClearance: 0.1,
      checkUnconnectedNets: true,
      checkAcuteAngles: true,
      checkTraceLength: false,
      maxTraceLength: 100.0
    };
  }

  runDRC(): DRCResult {
    const violations: DRCViolation[] = [];

    // Check trace widths
    violations.push(...this.checkTraceWidths());

    // Check trace clearances
    violations.push(...this.checkTraceClearances());

    // Check via sizes
    violations.push(...this.checkViaSizes());

    // Check pad sizes and annular rings
    violations.push(...this.checkPadSizes());

    // Check silk screen clearances
    violations.push(...this.checkSilkScreenClearances());

    // Check courtyard overlaps
    violations.push(...this.checkCourtyardOverlaps());

    // Check unconnected nets
    if (this.rules.checkUnconnectedNets) {
      violations.push(...this.checkUnconnectedNets());
    }

    // Check acute angles
    if (this.rules.checkAcuteAngles) {
      violations.push(...this.checkAcuteAngles());
    }

    // Check trace lengths
    if (this.rules.checkTraceLength) {
      violations.push(...this.checkTraceLengths());
    }

    const errors = violations.filter(v => v.severity === 'error').length;
    const warnings = violations.filter(v => v.severity === 'warning').length;

    return {
      isValid: errors === 0,
      violations,
      summary: {
        errors,
        warnings,
        totalViolations: violations.length
      }
    };
  }

  private checkTraceWidths(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    this.design.traces.forEach(trace => {
      if (trace.width < this.rules.minTraceWidth) {
        violations.push({
          type: 'width',
          severity: 'error',
          message: `Trace width ${trace.width}mm is below minimum ${this.rules.minTraceWidth}mm`,
          location: this.getTraceCenter(trace),
          elementId: trace.id,
          layer: trace.layerId,
          value: trace.width,
          required: this.rules.minTraceWidth
        });
      }

      if (trace.width > this.rules.maxTraceWidth) {
        violations.push({
          type: 'width',
          severity: 'warning',
          message: `Trace width ${trace.width}mm exceeds maximum ${this.rules.maxTraceWidth}mm`,
          location: this.getTraceCenter(trace),
          elementId: trace.id,
          layer: trace.layerId,
          value: trace.width,
          required: this.rules.maxTraceWidth
        });
      }
    });

    return violations;
  }

  private checkTraceClearances(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    for (let i = 0; i < this.design.traces.length; i++) {
      for (let j = i + 1; j < this.design.traces.length; j++) {
        const trace1 = this.design.traces[i];
        const trace2 = this.design.traces[j];

        // Skip if same net
        if (trace1.netId === trace2.netId) continue;

        const clearance = this.calculateTraceClearance(trace1, trace2);
        if (clearance < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Trace clearance ${clearance.toFixed(3)}mm is below minimum ${this.rules.minTraceClearance}mm`,
            location: this.getTraceCenter(trace1),
            elementId: trace1.id,
            layer: trace1.layerId,
            value: clearance,
            required: this.rules.minTraceClearance
          });
        }
      }
    }

    return violations;
  }

  private checkViaSizes(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    this.design.vias.forEach(via => {
      if (via.diameter < this.rules.minViaDiameter) {
        violations.push({
          type: 'drill',
          severity: 'error',
          message: `Via diameter ${via.diameter}mm is below minimum ${this.rules.minViaDiameter}mm`,
          location: via.position,
          elementId: via.id,
          value: via.diameter,
          required: this.rules.minViaDiameter
        });
      }

      if (via.drillDiameter < this.rules.minViaDrillDiameter) {
        violations.push({
          type: 'drill',
          severity: 'error',
          message: `Via drill diameter ${via.drillDiameter}mm is below minimum ${this.rules.minViaDrillDiameter}mm`,
          location: via.position,
          elementId: via.id,
          value: via.drillDiameter,
          required: this.rules.minViaDrillDiameter
        });
      }

      // Check annular ring
      const annularRing = (via.diameter - via.drillDiameter) / 2;
      if (annularRing < this.rules.minAnnularRing) {
        violations.push({
          type: 'annular_ring',
          severity: 'error',
          message: `Via annular ring ${annularRing.toFixed(3)}mm is below minimum ${this.rules.minAnnularRing}mm`,
          location: via.position,
          elementId: via.id,
          value: annularRing,
          required: this.rules.minAnnularRing
        });
      }
    });

    return violations;
  }

  private checkPadSizes(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    this.design.pads.forEach(pad => {
      const padSize = Math.min(pad.size.width, pad.size.height);

      if (padSize < this.rules.minPadDiameter) {
        violations.push({
          type: 'width',
          severity: 'error',
          message: `Pad size ${padSize}mm is below minimum ${this.rules.minPadDiameter}mm`,
          location: pad.position,
          elementId: pad.id,
          value: padSize,
          required: this.rules.minPadDiameter
        });
      }

      if (pad.drillDiameter) {
        if (pad.drillDiameter < this.rules.minHoleDiameter) {
          violations.push({
            type: 'drill',
            severity: 'error',
            message: `Pad drill diameter ${pad.drillDiameter}mm is below minimum ${this.rules.minHoleDiameter}mm`,
            location: pad.position,
            elementId: pad.id,
            value: pad.drillDiameter,
            required: this.rules.minHoleDiameter
          });
        }

        // Check annular ring for through-hole pads
        const annularRing = (padSize - pad.drillDiameter) / 2;
        if (annularRing < this.rules.minAnnularRing) {
          violations.push({
            type: 'annular_ring',
            severity: 'error',
            message: `Pad annular ring ${annularRing.toFixed(3)}mm is below minimum ${this.rules.minAnnularRing}mm`,
            location: pad.position,
            elementId: pad.id,
            value: annularRing,
            required: this.rules.minAnnularRing
          });
        }
      }
    });

    return violations;
  }

  private checkSilkScreenClearances(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    // This would check silk screen elements against pads
    // Simplified implementation - in real DRC this would check actual silk screen geometry
    this.design.pads.forEach(pad => {
      // Assume silk screen elements are placed near pads
      // In a real implementation, this would check actual silk screen geometry
      const silkClearance = this.rules.minSilkToPadClearance;
      if (silkClearance < this.rules.minSilkToPadClearance) {
        violations.push({
          type: 'silk_to_pad',
          severity: 'warning',
          message: `Silk screen clearance is below minimum ${this.rules.minSilkToPadClearance}mm`,
          location: pad.position,
          elementId: pad.id,
          value: silkClearance,
          required: this.rules.minSilkToPadClearance
        });
      }
    });

    return violations;
  }

  private checkCourtyardOverlaps(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    // Simplified courtyard checking
    // In a real implementation, this would check actual courtyard polygons
    for (let i = 0; i < this.design.components.length; i++) {
      for (let j = i + 1; j < this.design.components.length; j++) {
        const comp1 = this.design.components[i];
        const comp2 = this.design.components[j];

        // Simplified distance check
        const dx = (comp1.position?.x || 0) - (comp2.position?.x || 0);
        const dy = (comp1.position?.y || 0) - (comp2.position?.y || 0);
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.rules.minCourtyardClearance) {
          violations.push({
            type: 'courtyard_overlap',
            severity: 'warning',
            message: `Component courtyard clearance ${distance.toFixed(3)}mm is below minimum ${this.rules.minCourtyardClearance}mm`,
            location: { x: (comp1.position?.x || 0 + comp2.position?.x || 0) / 2, y: (comp1.position?.y || 0 + comp2.position?.y || 0) / 2 },
            elementId: comp1.id,
            value: distance,
            required: this.rules.minCourtyardClearance
          });
        }
      }
    }

    return violations;
  }

  private checkUnconnectedNets(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    this.design.nets.forEach(net => {
      const connectedPads = this.design.pads.filter(pad => pad.netId === net.id);
      const connectedTraces = this.design.traces.filter(trace => trace.netId === net.id);
      const connectedVias = this.design.vias.filter(via => via.netId === net.id);

      if (connectedPads.length === 0 && connectedTraces.length === 0 && connectedVias.length === 0) {
        violations.push({
          type: 'clearance',
          severity: 'warning',
          message: `Net "${net.name}" is not connected to any pads, traces, or vias`,
          location: { x: 0, y: 0 },
          elementId: net.id
        });
      }
    });

    return violations;
  }

  private checkAcuteAngles(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    this.design.traces.forEach(trace => {
      if (trace.points.length >= 3) {
        for (let i = 1; i < trace.points.length - 1; i++) {
          const angle = this.calculateAngle(trace.points[i - 1], trace.points[i], trace.points[i + 1]);
          if (angle < 90) { // Acute angle
            violations.push({
              type: 'clearance',
              severity: 'warning',
              message: `Acute angle ${angle.toFixed(1)}° found in trace`,
              location: trace.points[i],
              elementId: trace.id,
              layer: trace.layerId
            });
          }
        }
      }
    });

    return violations;
  }

  private checkTraceLengths(): DRCViolation[] {
    const violations: DRCViolation[] = [];

    this.design.traces.forEach(trace => {
      const length = this.calculateTraceLength(trace);
      if (length > this.rules.maxTraceLength) {
        violations.push({
          type: 'width',
          severity: 'warning',
          message: `Trace length ${length.toFixed(2)}mm exceeds maximum ${this.rules.maxTraceLength}mm`,
          location: this.getTraceCenter(trace),
          elementId: trace.id,
          layer: trace.layerId,
          value: length,
          required: this.rules.maxTraceLength
        });
      }
    });

    return violations;
  }

  private calculateTraceClearance(trace1: PCBTrace, trace2: PCBTrace): number {
    let minClearance = Infinity;

    trace1.points.forEach(p1 => {
      trace2.points.forEach(p2 => {
        const distance = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        const clearance = distance - (trace1.width + trace2.width) / 2;
        minClearance = Math.min(minClearance, clearance);
      });
    });

    return Math.max(0, minClearance);
  }

  private getTraceCenter(trace: PCBTrace): { x: number; y: number } {
    if (trace.points.length === 0) return { x: 0, y: 0 };

    let sumX = 0, sumY = 0;
    trace.points.forEach(point => {
      sumX += point.x;
      sumY += point.y;
    });

    return {
      x: sumX / trace.points.length,
      y: sumY / trace.points.length
    };
  }

  private calculateAngle(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }): number {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    const cosAngle = dot / (mag1 * mag2);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);

    return angle;
  }

  private calculateTraceLength(trace: PCBTrace): number {
    let length = 0;
    for (let i = 1; i < trace.points.length; i++) {
      const p1 = trace.points[i - 1];
      const p2 = trace.points[i];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  updateRules(newRules: Partial<DRCSettings>): void {
    this.rules = { ...this.rules, ...newRules };
  }

  getRules(): DRCSettings {
    return { ...this.rules };
  }
}

export interface DRCSettings {
  minTraceWidth: number;
  minTraceClearance: number;
  minViaDiameter: number;
  minViaDrillDiameter: number;
  minPadDiameter: number;
  minAnnularRing: number;
  minSilkToPadClearance: number;
  minCourtyardClearance: number;
  maxTraceWidth: number;
  minHoleDiameter: number;
  solderMaskClearance: number;
  checkUnconnectedNets: boolean;
  checkAcuteAngles: boolean;
  checkTraceLength: boolean;
  maxTraceLength: number;
}