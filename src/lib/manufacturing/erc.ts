import { Component, Wire, Net, Pin } from '../../types';

export interface ERCViolation {
  type: 'unconnected_pin' | 'short_circuit' | 'power_ground' | 'input_floating' | 'output_conflict' | 'power_supply';
  severity: 'error' | 'warning' | 'info';
  message: string;
  componentId?: string;
  pinId?: string;
  netId?: string;
  location?: { x: number; y: number };
  suggestion?: string;
}

export interface ERCResult {
  isValid: boolean;
  violations: ERCViolation[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    totalViolations: number;
  };
}

export class ElectricalRuleChecker {
  private components: Component[];
  private wires: Wire[];
  private nets: Net[];

  constructor(components: Component[], wires: Wire[], nets: Net[]) {
    this.components = components;
    this.wires = wires;
    this.nets = nets;
  }

  runERC(): ERCResult {
    const violations: ERCViolation[] = [];

    // Check for unconnected pins
    violations.push(...this.checkUnconnectedPins());

    // Check for short circuits
    violations.push(...this.checkShortCircuits());

    // Check power and ground connections
    violations.push(...this.checkPowerGroundConnections());

    // Check for floating inputs
    violations.push(...this.checkFloatingInputs());

    // Check for output conflicts
    violations.push(...this.checkOutputConflicts());

    // Check power supply connections
    violations.push(...this.checkPowerSupplyConnections());

    const errors = violations.filter(v => v.severity === 'error').length;
    const warnings = violations.filter(v => v.severity === 'warning').length;
    const info = violations.filter(v => v.severity === 'info').length;

    return {
      isValid: errors === 0,
      violations,
      summary: {
        errors,
        warnings,
        info,
        totalViolations: violations.length
      }
    };
  }

  private checkUnconnectedPins(): ERCViolation[] {
    const violations: ERCViolation[] = [];

    this.components.forEach(component => {
      component.pins.forEach(pin => {
        const isConnected = this.isPinConnected(component.id, pin.id);

        if (!isConnected) {
          let severity: 'error' | 'warning' | 'info' = 'warning';
          let message = `Pin "${pin.name}" of ${component.name} is not connected`;
          let suggestion = 'Connect this pin to a net or leave it unconnected if intentional';

          // Special handling for different pin types
          switch (pin.electricalType) {
            case 'power':
              severity = 'error';
              message = `Power pin "${pin.name}" of ${component.name} is not connected`;
              suggestion = 'Connect this power pin to the appropriate power net';
              break;
            case 'ground':
              severity = 'error';
              message = `Ground pin "${pin.name}" of ${component.name} is not connected`;
              suggestion = 'Connect this ground pin to the ground net';
              break;
            case 'input':
              severity = 'warning';
              message = `Input pin "${pin.name}" of ${component.name} is not connected`;
              suggestion = 'Connect this input pin to a signal source or pull it up/down if unused';
              break;
            case 'output':
              severity = 'info';
              message = `Output pin "${pin.name}" of ${component.name} is not connected`;
              suggestion = 'This is acceptable for unused outputs';
              break;
          }

          violations.push({
            type: 'unconnected_pin',
            severity,
            message,
            componentId: component.id,
            pinId: pin.id,
            suggestion
          });
        }
      });
    });

    return violations;
  }

  private checkShortCircuits(): ERCViolation[] {
    const violations: ERCViolation[] = [];

    // Check for multiple outputs connected to the same net
    this.nets.forEach(net => {
      const connectedOutputs: Array<{ componentId: string; pinId: string }> = [];

      net.connectedPins.forEach(connection => {
        const component = this.components.find(c => c.id === connection.componentId);
        const pin = component?.pins.find(p => p.id === connection.pinId);

        if (pin?.electricalType === 'output') {
          connectedOutputs.push(connection);
        }
      });

      if (connectedOutputs.length > 1) {
        connectedOutputs.forEach(connection => {
          violations.push({
            type: 'short_circuit',
            severity: 'error',
            message: `Multiple output pins connected to net "${net.name}"`,
            componentId: connection.componentId,
            pinId: connection.pinId,
            netId: net.id,
            suggestion: 'Separate outputs or use proper bus/multiplexing logic'
          });
        });
      }
    });

    // Check for power and ground short circuits
    this.nets.forEach(net => {
      const powerPins = net.connectedPins.filter(connection => {
        const component = this.components.find(c => c.id === connection.componentId);
        const pin = component?.pins.find(p => p.id === connection.pinId);
        return pin?.electricalType === 'power';
      });

      const groundPins = net.connectedPins.filter(connection => {
        const component = this.components.find(c => c.id === connection.componentId);
        const pin = component?.pins.find(p => p.id === connection.pinId);
        return pin?.electricalType === 'ground';
      });

      if (powerPins.length > 0 && groundPins.length > 0) {
        violations.push({
          type: 'short_circuit',
          severity: 'error',
          message: `Power and ground pins shorted on net "${net.name}"`,
          netId: net.id,
          suggestion: 'Separate power and ground nets'
        });
      }
    });

    return violations;
  }

  private checkPowerGroundConnections(): ERCViolation[] {
    const violations: ERCViolation[] = [];

    this.components.forEach(component => {
      const powerPins = component.pins.filter(pin => pin.electricalType === 'power');
      const groundPins = component.pins.filter(pin => pin.electricalType === 'ground');

      // Check if component has required power/ground connections
      if (powerPins.length > 0) {
        const connectedPowerPins = powerPins.filter(pin => this.isPinConnected(component.id, pin.id));
        if (connectedPowerPins.length === 0) {
          violations.push({
            type: 'power_ground',
            severity: 'error',
            message: `${component.name} has unconnected power pins`,
            componentId: component.id,
            suggestion: 'Connect all power pins to appropriate power nets'
          });
        }
      }

      if (groundPins.length > 0) {
        const connectedGroundPins = groundPins.filter(pin => this.isPinConnected(component.id, pin.id));
        if (connectedGroundPins.length === 0) {
          violations.push({
            type: 'power_ground',
            severity: 'error',
            message: `${component.name} has unconnected ground pins`,
            componentId: component.id,
            suggestion: 'Connect all ground pins to ground net'
          });
        }
      }
    });

    return violations;
  }

  private checkFloatingInputs(): ERCViolation[] {
    const violations: ERCViolation[] = [];

    this.components.forEach(component => {
      const inputPins = component.pins.filter(pin => pin.electricalType === 'input');

      inputPins.forEach(pin => {
        if (!this.isPinConnected(component.id, pin.id)) {
          violations.push({
            type: 'input_floating',
            severity: 'warning',
            message: `Input pin "${pin.name}" of ${component.name} is floating`,
            componentId: component.id,
            pinId: pin.id,
            suggestion: 'Connect input to a signal source or add pull-up/pull-down resistor'
          });
        }
      });
    });

    return violations;
  }

  private checkOutputConflicts(): ERCViolation[] {
    const violations: ERCViolation[] = [];

    // Check for outputs connected to outputs (already covered in short circuit check)
    // Additional checks for tri-state conflicts, etc. could be added here

    this.nets.forEach(net => {
      const connectedOutputs = net.connectedPins.filter(connection => {
        const component = this.components.find(c => c.id === connection.componentId);
        const pin = component?.pins.find(p => p.id === connection.pinId);
        return pin?.electricalType === 'output';
      });

      if (connectedOutputs.length > 1) {
        // This is already caught by short circuit check, but we can add more specific messaging
        violations.push({
          type: 'output_conflict',
          severity: 'error',
          message: `Multiple outputs driving net "${net.name}" simultaneously`,
          netId: net.id,
          suggestion: 'Use tri-state buffers or separate the outputs'
        });
      }
    });

    return violations;
  }

  private checkPowerSupplyConnections(): ERCViolation[] {
    const violations: ERCViolation[] = [];

    // Find power supply components (like voltage regulators, batteries)
    const powerSupplies = this.components.filter(comp =>
      comp.category.toLowerCase().includes('power') ||
      comp.category.toLowerCase().includes('supply') ||
      comp.name.toLowerCase().includes('regulator') ||
      comp.name.toLowerCase().includes('battery')
    );

    powerSupplies.forEach(supply => {
      const outputPins = supply.pins.filter(pin => pin.electricalType === 'output');

      outputPins.forEach(pin => {
        if (!this.isPinConnected(supply.id, pin.id)) {
          violations.push({
            type: 'power_supply',
            severity: 'warning',
            message: `Power supply output "${pin.name}" of ${supply.name} is not connected`,
            componentId: supply.id,
            pinId: pin.id,
            suggestion: 'Connect power supply output to load circuit'
          });
        }
      });
    });

    return violations;
  }

  private isPinConnected(componentId: string, pinId: string): boolean {
    // Check if pin is connected to any wire/net
    return this.wires.some(wire =>
      wire.connectedPins.some(connection =>
        connection.componentId === componentId && connection.pinId === pinId
      )
    ) || this.nets.some(net =>
      net.connectedPins.some(connection =>
        connection.componentId === componentId && connection.pinId === pinId
      )
    );
  }

  getConnectedNet(componentId: string, pinId: string): Net | null {
    for (const net of this.nets) {
      if (net.connectedPins.some(connection =>
        connection.componentId === componentId && connection.pinId === pinId
      )) {
        return net;
      }
    }
    return null;
  }

  getPinConnections(componentId: string, pinId: string): Array<{ componentId: string; pinId: string }> {
    const connections: Array<{ componentId: string; pinId: string }> = [];

    this.wires.forEach(wire => {
      wire.connectedPins.forEach(connection => {
        if (connection.componentId === componentId && connection.pinId === pinId) {
          // Add all other connections on this wire
          wire.connectedPins.forEach(otherConnection => {
            if (otherConnection.componentId !== componentId || otherConnection.pinId !== pinId) {
              connections.push(otherConnection);
            }
          });
        }
      });
    });

    return connections;
  }

  updateComponents(components: Component[]): void {
    this.components = components;
  }

  updateWires(wires: Wire[]): void {
    this.wires = wires;
  }

  updateNets(nets: Net[]): void {
    this.nets = nets;
  }
}