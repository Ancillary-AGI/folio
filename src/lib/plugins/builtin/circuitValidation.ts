import { PluginInstance, PluginAPI, PluginContext } from '../../types/plugins'

export default class CircuitValidationPlugin implements PluginInstance {
  private api: PluginAPI | null = null
  private context: PluginContext | null = null

  async init(api: PluginAPI, context: PluginContext): Promise<void> {
    this.api = api
    this.context = context

    // Register validation rules
    this.registerValidationRules()

    // Listen for circuit changes
    api.on('circuit:changed', this.validateCircuit.bind(this))
    api.on('component:added', this.validateComponent.bind(this))
    api.on('wire:added', this.validateWire.bind(this))
  }

  private registerValidationRules(): void {
    if (!this.api) return

    // Register built-in validation rules
    const rules = [
      {
        id: 'power-ground-connection',
        name: 'Power and Ground Connections',
        description: 'Ensures all power and ground pins are properly connected',
        check: this.checkPowerGroundConnections.bind(this)
      },
      {
        id: 'floating-pins',
        name: 'Floating Pins',
        description: 'Detects unconnected component pins',
        check: this.checkFloatingPins.bind(this)
      },
      {
        id: 'short-circuits',
        name: 'Short Circuits',
        description: 'Detects potential short circuits',
        check: this.checkShortCircuits.bind(this)
      },
      {
        id: 'component-values',
        name: 'Component Values',
        description: 'Validates component values are within reasonable ranges',
        check: this.checkComponentValues.bind(this)
      },
      {
        id: 'net-naming',
        name: 'Net Naming',
        description: 'Ensures consistent net naming conventions',
        check: this.checkNetNaming.bind(this)
      }
    ]

    rules.forEach(rule => {
      this.api?.emit('validation:register-rule', rule)
    })
  }

  private async validateCircuit(circuitData: any): Promise<void> {
    if (!this.api) return

    try {
      const results = await this.runAllValidations(circuitData)
      
      // Emit validation results
      this.api.emit('validation:results', {
        circuitId: circuitData.id,
        results,
        timestamp: Date.now()
      })

      // Show notifications for critical errors
      const criticalErrors = results.filter(r => r.severity === 'error')
      if (criticalErrors.length > 0) {
        this.api.showNotification(
          `Circuit validation found ${criticalErrors.length} critical error(s)`,
          'error'
        )
      }
    } catch (error) {
      console.error('Circuit validation error:', error)
      this.api?.showNotification('Circuit validation failed', 'error')
    }
  }

  private async validateComponent(component: any): Promise<void> {
    if (!this.api) return

    try {
      const results = await this.validateComponentRules(component)
      
      if (results.length > 0) {
        this.api.emit('validation:component-results', {
          componentId: component.id,
          results,
          timestamp: Date.now()
        })
      }
    } catch (error) {
      console.error('Component validation error:', error)
    }
  }

  private async validateWire(wire: any): Promise<void> {
    if (!this.api) return

    try {
      const results = await this.validateWireRules(wire)
      
      if (results.length > 0) {
        this.api.emit('validation:wire-results', {
          wireId: wire.id,
          results,
          timestamp: Date.now()
        })
      }
    } catch (error) {
      console.error('Wire validation error:', error)
    }
  }

  private async runAllValidations(circuitData: any): Promise<any[]> {
    const results: any[] = []

    // Check power and ground connections
    results.push(...await this.checkPowerGroundConnections(circuitData))
    
    // Check for floating pins
    results.push(...await this.checkFloatingPins(circuitData))
    
    // Check for short circuits
    results.push(...await this.checkShortCircuits(circuitData))
    
    // Check component values
    results.push(...await this.checkComponentValues(circuitData))
    
    // Check net naming
    results.push(...await this.checkNetNaming(circuitData))

    return results
  }

  private async checkPowerGroundConnections(circuitData: any): Promise<any[]> {
    const results: any[] = []
    const powerPins: any[] = []
    const groundPins: any[] = []

    // Collect all power and ground pins
    circuitData.components?.forEach((component: any) => {
      component.pins?.forEach((pin: any) => {
        if (pin.type === 'power') {
          powerPins.push({ componentId: component.id, pinId: pin.id, pin })
        } else if (pin.type === 'ground') {
          groundPins.push({ componentId: component.id, pinId: pin.id, pin })
        }
      })
    })

    // Check if power pins are connected
    powerPins.forEach(({ componentId, pinId, pin }) => {
      const isConnected = circuitData.wires?.some((wire: any) =>
        wire.connectedPins?.some((cp: any) =>
          cp.componentId === componentId && cp.pinId === pinId
        )
      )

      if (!isConnected) {
        results.push({
          ruleId: 'power-ground-connection',
          severity: 'warning',
          message: `Power pin ${pin.name} on ${componentId} is not connected`,
          componentId,
          pinId,
          suggestion: 'Connect power pin to a power supply or voltage source'
        })
      }
    })

    // Check if ground pins are connected
    groundPins.forEach(({ componentId, pinId, pin }) => {
      const isConnected = circuitData.wires?.some((wire: any) =>
        wire.connectedPins?.some((cp: any) =>
          cp.componentId === componentId && cp.pinId === pinId
        )
      )

      if (!isConnected) {
        results.push({
          ruleId: 'power-ground-connection',
          severity: 'warning',
          message: `Ground pin ${pin.name} on ${componentId} is not connected`,
          componentId,
          pinId,
          suggestion: 'Connect ground pin to ground reference'
        })
      }
    })

    return results
  }

  private async checkFloatingPins(circuitData: any): Promise<any[]> {
    const results: any[] = []
    const connectedPins = new Set<string>()

    // Collect all connected pins
    circuitData.wires?.forEach((wire: any) => {
      wire.connectedPins?.forEach((cp: any) => {
        connectedPins.add(`${cp.componentId}:${cp.pinId}`)
      })
    })

    // Check for floating pins
    circuitData.components?.forEach((component: any) => {
      component.pins?.forEach((pin: any) => {
        if (pin.type !== 'nc' && !connectedPins.has(`${component.id}:${pin.id}`)) {
          results.push({
            ruleId: 'floating-pins',
            severity: 'warning',
            message: `Pin ${pin.name} on ${component.id} is floating`,
            componentId: component.id,
            pinId: pin.id,
            suggestion: 'Connect pin to another component or mark as no-connect'
          })
        }
      })
    })

    return results
  }

  private async checkShortCircuits(circuitData: any): Promise<any[]> {
    const results: any[] = []
    const netMap = new Map<string, string[]>()

    // Build net map
    circuitData.wires?.forEach((wire: any) => {
      const netName = wire.netName || `net_${wire.id}`
      if (!netMap.has(netName)) {
        netMap.set(netName, [])
      }
      
      wire.connectedPins?.forEach((cp: any) => {
        netMap.get(netName)?.push(`${cp.componentId}:${cp.pinId}`)
      })
    })

    // Check for potential short circuits
    netMap.forEach((pins, netName) => {
      const powerPins = pins.filter(pin => {
        const [componentId, pinId] = pin.split(':')
        const component = circuitData.components?.find((c: any) => c.id === componentId)
        const pinObj = component?.pins?.find((p: any) => p.id === pinId)
        return pinObj?.type === 'power'
      })

      const groundPins = pins.filter(pin => {
        const [componentId, pinId] = pin.split(':')
        const component = circuitData.components?.find((c: any) => c.id === componentId)
        const pinObj = component?.pins?.find((p: any) => p.id === pinId)
        return pinObj?.type === 'ground'
      })

      if (powerPins.length > 0 && groundPins.length > 0) {
        results.push({
          ruleId: 'short-circuits',
          severity: 'error',
          message: `Potential short circuit detected in net ${netName}`,
          netName,
          suggestion: 'Check connections between power and ground pins'
        })
      }
    })

    return results
  }

  private async checkComponentValues(circuitData: any): Promise<any[]> {
    const results: any[] = []

    circuitData.components?.forEach((component: any) => {
      // Check resistor values
      if (component.category === 'resistor') {
        const resistance = parseFloat(component.properties?.resistance || '0')
        if (resistance <= 0) {
          results.push({
            ruleId: 'component-values',
            severity: 'error',
            message: `Resistor ${component.id} has invalid resistance value`,
            componentId: component.id,
            suggestion: 'Set a positive resistance value'
          })
        } else if (resistance > 1e12) {
          results.push({
            ruleId: 'component-values',
            severity: 'warning',
            message: `Resistor ${component.id} has very high resistance`,
            componentId: component.id,
            suggestion: 'Verify resistance value is correct'
          })
        }
      }

      // Check capacitor values
      if (component.category === 'capacitor') {
        const capacitance = parseFloat(component.properties?.capacitance || '0')
        if (capacitance <= 0) {
          results.push({
            ruleId: 'component-values',
            severity: 'error',
            message: `Capacitor ${component.id} has invalid capacitance value`,
            componentId: component.id,
            suggestion: 'Set a positive capacitance value'
          })
        }
      }

      // Check voltage source values
      if (component.category === 'voltage-source') {
        const voltage = parseFloat(component.properties?.voltage || '0')
        if (Math.abs(voltage) > 1000) {
          results.push({
            ruleId: 'component-values',
            severity: 'warning',
            message: `Voltage source ${component.id} has high voltage`,
            componentId: component.id,
            suggestion: 'Verify voltage value is safe for the application'
          })
        }
      }
    })

    return results
  }

  private async checkNetNaming(circuitData: any): Promise<any[]> {
    const results: any[] = []
    const netNames = new Set<string>()
    const duplicateNets: string[] = []

    // Collect net names
    circuitData.wires?.forEach((wire: any) => {
      if (wire.netName) {
        if (netNames.has(wire.netName)) {
          duplicateNets.push(wire.netName)
        } else {
          netNames.add(wire.netName)
        }
      }
    })

    // Check for duplicate net names
    duplicateNets.forEach(netName => {
      results.push({
        ruleId: 'net-naming',
        severity: 'warning',
        message: `Duplicate net name: ${netName}`,
        netName,
        suggestion: 'Use unique net names for different electrical connections'
      })
    })

    return results
  }

  private async validateComponentRules(component: any): Promise<any[]> {
    const results: any[] = []

    // Check if component has required properties
    if (component.category === 'resistor' && !component.properties?.resistance) {
      results.push({
        ruleId: 'component-values',
        severity: 'error',
        message: `Resistor ${component.id} missing resistance value`,
        componentId: component.id,
        suggestion: 'Set resistance value'
      })
    }

    if (component.category === 'capacitor' && !component.properties?.capacitance) {
      results.push({
        ruleId: 'component-values',
        severity: 'error',
        message: `Capacitor ${component.id} missing capacitance value`,
        componentId: component.id,
        suggestion: 'Set capacitance value'
      })
    }

    return results
  }

  private async validateWireRules(wire: any): Promise<any[]> {
    const results: any[] = []

    // Check if wire has at least two connection points
    if (!wire.connectedPins || wire.connectedPins.length < 2) {
      results.push({
        ruleId: 'wire-connections',
        severity: 'warning',
        message: `Wire ${wire.id} has insufficient connections`,
        wireId: wire.id,
        suggestion: 'Connect wire to at least two pins'
      })
    }

    return results
  }

  async cleanup(): Promise<void> {
    if (this.api) {
      this.api.off('circuit:changed', this.validateCircuit.bind(this))
      this.api.off('component:added', this.validateComponent.bind(this))
      this.api.off('wire:added', this.validateWire.bind(this))
    }
  }
}
