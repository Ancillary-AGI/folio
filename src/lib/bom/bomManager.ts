import { Component } from '../../types';

export interface BOMItem {
  id: string;
  componentId: string;
  component: Component;
  quantity: number;
  referenceDesignators: string[];
  supplier: string;
  supplierPartNumber: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  description: string;
  cost: number;
  currency: string;
  leadTime: number; // days
  availability: 'high' | 'medium' | 'low' | 'obsolete';
  substitutes: Array<{
    manufacturer: string;
    partNumber: string;
    cost: number;
    availability: string;
  }>;
  attributes: Record<string, any>;
}

export interface BOM {
  id: string;
  name: string;
  version: string;
  projectId: string;
  items: BOMItem[];
  metadata: {
    created: Date;
    modified: Date;
    author: string;
    approvedBy?: string;
    status: 'draft' | 'review' | 'approved' | 'released';
  };
  totals: {
    totalItems: number;
    uniqueComponents: number;
    totalCost: number;
    totalWeight?: number;
    totalVolume?: number;
  };
  variants: BOMVariant[];
}

export interface BOMVariant {
  id: string;
  name: string;
  description: string;
  differences: Array<{
    itemId: string;
    originalComponent: string;
    variantComponent: string;
    reason: string;
  }>;
  additionalCost: number;
  performanceImpact: string;
}

export interface BOMComparison {
  id: string;
  name: string;
  bom1: BOM;
  bom2: BOM;
  differences: Array<{
    type: 'added' | 'removed' | 'changed' | 'quantity_changed';
    itemId?: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
  }>;
  costImpact: number;
  recommendations: string[];
}

export class BOMManager {
  private boms: Map<string, BOM> = new Map();
  private comparisons: Map<string, BOMComparison> = new Map();

  createBOM(name: string, projectId: string, components: Component[], quantities: Record<string, number>): BOM {
    const items: BOMItem[] = components.map(component => {
      const quantity = quantities[component.id] || 1;
      const referenceDesignators = this.generateReferenceDesignators(component, quantity);

      return {
        id: `bom_item_${component.id}`,
        componentId: component.id,
        component,
        quantity,
        referenceDesignators,
        supplier: this.getDefaultSupplier(component),
        supplierPartNumber: this.generateSupplierPartNumber(component),
        manufacturer: component.manufacturer || 'Unknown',
        manufacturerPartNumber: component.partNumber || component.name,
        description: component.description || component.name,
        cost: component.cost || 0.1,
        currency: 'USD',
        leadTime: 7, // Default 7 days
        availability: 'high',
        substitutes: this.findSubstitutes(component),
        attributes: {
          package: component.package || 'Unknown',
          tolerance: '±5%',
          temperature: '-40°C to +85°C'
        }
      };
    });

    const totalCost = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);

    const bom: BOM = {
      id: `bom_${Date.now()}`,
      name,
      version: '1.0',
      projectId,
      items,
      metadata: {
        created: new Date(),
        modified: new Date(),
        author: 'System',
        status: 'draft'
      },
      totals: {
        totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
        uniqueComponents: items.length,
        totalCost
      },
      variants: []
    };

    this.boms.set(bom.id, bom);
    return bom;
  }

  private generateReferenceDesignators(component: Component, quantity: number): string[] {
    const designators = [];
    const prefix = this.getComponentPrefix(component.category);

    for (let i = 1; i <= quantity; i++) {
      designators.push(`${prefix}${i}`);
    }

    return designators;
  }

  private getComponentPrefix(category: string): string {
    const prefixes = {
      resistor: 'R',
      capacitor: 'C',
      inductor: 'L',
      diode: 'D',
      transistor: 'Q',
      integrated_circuit: 'U',
      microcontroller: 'U',
      connector: 'J',
      switch: 'SW',
      relay: 'K',
      transformer: 'T',
      crystal: 'Y',
      fuse: 'F'
    };

    return prefixes[category as keyof typeof prefixes] || 'U';
  }

  private getDefaultSupplier(component: Component): string {
    // Simplified supplier assignment
    const suppliers = ['Digi-Key', 'Mouser', 'Arrow', 'Newark'];
    return suppliers[Math.floor(Math.random() * suppliers.length)];
  }

  private generateSupplierPartNumber(component: Component): string {
    return `${component.manufacturer || 'GEN'}-${component.partNumber || component.name}-${Date.now().toString().slice(-4)}`;
  }

  private findSubstitutes(component: Component): BOMItem['substitutes'] {
    // Generate substitute components
    const substitutes = [];
    const manufacturers = ['Texas Instruments', 'Analog Devices', 'Microchip', 'STMicroelectronics'];

    for (let i = 0; i < 2; i++) {
      substitutes.push({
        manufacturer: manufacturers[Math.floor(Math.random() * manufacturers.length)],
        partNumber: `${component.name}_ALT${i + 1}`,
        cost: component.cost ? component.cost * (0.8 + Math.random() * 0.4) : 0.1,
        availability: Math.random() > 0.2 ? 'high' : 'medium'
      });
    }

    return substitutes;
  }

  updateBOMItem(bomId: string, itemId: string, updates: Partial<BOMItem>): boolean {
    const bom = this.boms.get(bomId);
    if (!bom) return false;

    const itemIndex = bom.items.findIndex(item => item.id === itemId);
    if (itemIndex === -1) return false;

    Object.assign(bom.items[itemIndex], updates);
    bom.metadata.modified = new Date();
    bom.totals.totalCost = bom.items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);

    return true;
  }

  addBOMVariant(bomId: string, variant: Omit<BOMVariant, 'id'>): boolean {
    const bom = this.boms.get(bomId);
    if (!bom) return false;

    const newVariant: BOMVariant = {
      ...variant,
      id: `variant_${Date.now()}`
    };

    bom.variants.push(newVariant);
    return true;
  }

  compareBOMs(bom1Id: string, bom2Id: string, name: string): BOMComparison {
    const bom1 = this.boms.get(bom1Id);
    const bom2 = this.boms.get(bom2Id);

    if (!bom1 || !bom2) {
      throw new Error('BOM not found');
    }

    const differences = this.findBOMDifferences(bom1, bom2);
    const costImpact = bom2.totals.totalCost - bom1.totals.totalCost;
    const recommendations = this.generateBOMRecommendations(differences, costImpact);

    const comparison: BOMComparison = {
      id: `comp_${Date.now()}`,
      name,
      bom1,
      bom2,
      differences,
      costImpact,
      recommendations
    };

    this.comparisons.set(comparison.id, comparison);
    return comparison;
  }

  private findBOMDifferences(bom1: BOM, bom2: BOM): BOMComparison['differences'] {
    const differences = [];

    // Find added items
    bom2.items.forEach(item2 => {
      const item1 = bom1.items.find(i => i.componentId === item2.componentId);
      if (!item1) {
        differences.push({
          type: 'added',
          itemId: item2.id,
          description: `Added ${item2.component.name} (Qty: ${item2.quantity})`,
          impact: item2.cost * item2.quantity > 10 ? 'high' : 'medium'
        });
      }
    });

    // Find removed items
    bom1.items.forEach(item1 => {
      const item2 = bom2.items.find(i => i.componentId === item1.componentId);
      if (!item2) {
        differences.push({
          type: 'removed',
          itemId: item1.id,
          description: `Removed ${item1.component.name}`,
          impact: item1.cost * item1.quantity > 10 ? 'high' : 'medium'
        });
      }
    });

    // Find changed items
    bom1.items.forEach(item1 => {
      const item2 = bom2.items.find(i => i.componentId === item1.componentId);
      if (item2) {
        if (item1.quantity !== item2.quantity) {
          differences.push({
            type: 'quantity_changed',
            itemId: item1.id,
            description: `Quantity changed for ${item1.component.name}: ${item1.quantity} → ${item2.quantity}`,
            impact: Math.abs(item1.quantity - item2.quantity) > 5 ? 'high' : 'low'
          });
        }

        if (item1.supplier !== item2.supplier) {
          differences.push({
            type: 'changed',
            itemId: item1.id,
            description: `Supplier changed for ${item1.component.name}: ${item1.supplier} → ${item2.supplier}`,
            impact: 'medium'
          });
        }
      }
    });

    return differences;
  }

  private generateBOMRecommendations(differences: BOMComparison['differences'], costImpact: number): string[] {
    const recommendations = [];

    if (costImpact > 100) {
      recommendations.push('High cost increase - review component selections for cost optimization');
    } else if (costImpact < -100) {
      recommendations.push('Cost reduction achieved - verify performance impact');
    }

    const highImpactChanges = differences.filter(d => d.impact === 'high');
    if (highImpactChanges.length > 0) {
      recommendations.push(`${highImpactChanges.length} high-impact changes detected - conduct thorough validation`);
    }

    const addedItems = differences.filter(d => d.type === 'added');
    if (addedItems.length > 5) {
      recommendations.push('Significant number of new components - review design complexity');
    }

    return recommendations;
  }

  exportBOM(bomId: string, format: 'csv' | 'excel' | 'xml' | 'json' = 'csv'): string {
    const bom = this.boms.get(bomId);
    if (!bom) {
      throw new Error('BOM not found');
    }

    switch (format) {
      case 'csv':
        return this.exportBOMToCSV(bom);
      case 'xml':
        return this.exportBOMToXML(bom);
      case 'json':
        return JSON.stringify(bom, null, 2);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private exportBOMToCSV(bom: BOM): string {
    const headers = [
      'Reference',
      'Quantity',
      'Manufacturer',
      'Manufacturer Part Number',
      'Supplier',
      'Supplier Part Number',
      'Description',
      'Cost',
      'Total Cost',
      'Lead Time',
      'Availability'
    ];

    const rows = bom.items.map(item => [
      item.referenceDesignators.join(', '),
      item.quantity.toString(),
      item.manufacturer,
      item.manufacturerPartNumber,
      item.supplier,
      item.supplierPartNumber,
      item.description,
      item.cost.toString(),
      (item.cost * item.quantity).toString(),
      item.leadTime.toString(),
      item.availability
    ]);

    return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  }

  private exportBOMToXML(bom: BOM): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<BOM>\n';
    xml += `  <Name>${bom.name}</Name>\n`;
    xml += `  <Version>${bom.version}</Version>\n`;
    xml += '  <Items>\n';

    bom.items.forEach(item => {
      xml += '    <Item>\n';
      xml += `      <Reference>${item.referenceDesignators.join(', ')}</Reference>\n`;
      xml += `      <Quantity>${item.quantity}</Quantity>\n`;
      xml += `      <Manufacturer>${item.manufacturer}</Manufacturer>\n`;
      xml += `      <ManufacturerPartNumber>${item.manufacturerPartNumber}</ManufacturerPartNumber>\n`;
      xml += `      <Supplier>${item.supplier}</Supplier>\n`;
      xml += `      <SupplierPartNumber>${item.supplierPartNumber}</SupplierPartNumber>\n`;
      xml += `      <Description>${item.description}</Description>\n`;
      xml += `      <Cost>${item.cost}</Cost>\n`;
      xml += `      <TotalCost>${item.cost * item.quantity}</TotalCost>\n`;
      xml += `      <LeadTime>${item.leadTime}</LeadTime>\n`;
      xml += `      <Availability>${item.availability}</Availability>\n`;
      xml += '    </Item>\n';
    });

    xml += '  </Items>\n';
    xml += '</BOM>\n';

    return xml;
  }

  validateBOM(bomId: string): {
    valid: boolean;
    errors: Array<{
      itemId: string;
      field: string;
      error: string;
    }>;
    warnings: Array<{
      itemId: string;
      field: string;
      warning: string;
    }>;
  } {
    const bom = this.boms.get(bomId);
    if (!bom) {
      return { valid: false, errors: [{ itemId: '', field: '', error: 'BOM not found' }], warnings: [] };
    }

    const errors = [];
    const warnings = [];

    bom.items.forEach(item => {
      // Check required fields
      if (!item.manufacturer || item.manufacturer.trim() === '') {
        errors.push({
          itemId: item.id,
          field: 'manufacturer',
          error: 'Manufacturer is required'
        });
      }

      if (!item.manufacturerPartNumber || item.manufacturerPartNumber.trim() === '') {
        errors.push({
          itemId: item.id,
          field: 'manufacturerPartNumber',
          error: 'Manufacturer part number is required'
        });
      }

      if (item.quantity <= 0) {
        errors.push({
          itemId: item.id,
          field: 'quantity',
          error: 'Quantity must be greater than 0'
        });
      }

      if (item.cost < 0) {
        errors.push({
          itemId: item.id,
          field: 'cost',
          error: 'Cost cannot be negative'
        });
      }

      // Warnings
      if (item.availability === 'low') {
        warnings.push({
          itemId: item.id,
          field: 'availability',
          warning: 'Component has low availability'
        });
      }

      if (item.leadTime > 30) {
        warnings.push({
          itemId: item.id,
          field: 'leadTime',
          warning: 'Component has long lead time (>30 days)'
        });
      }

      if (item.substitutes.length === 0) {
        warnings.push({
          itemId: item.id,
          field: 'substitutes',
          warning: 'No substitute components defined'
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  generateProcurementList(bomId: string): Array<{
    supplier: string;
    items: Array<{
      manufacturerPartNumber: string;
      quantity: number;
      unitCost: number;
      totalCost: number;
      leadTime: number;
    }>;
    totalCost: number;
    totalLeadTime: number;
  }> {
    const bom = this.boms.get(bomId);
    if (!bom) {
      throw new Error('BOM not found');
    }

    const supplierGroups = new Map<string, any[]>();

    bom.items.forEach(item => {
      if (!supplierGroups.has(item.supplier)) {
        supplierGroups.set(item.supplier, []);
      }

      supplierGroups.get(item.supplier)!.push({
        manufacturerPartNumber: item.manufacturerPartNumber,
        quantity: item.quantity,
        unitCost: item.cost,
        totalCost: item.cost * item.quantity,
        leadTime: item.leadTime
      });
    });

    const procurementList = Array.from(supplierGroups.entries()).map(([supplier, items]) => ({
      supplier,
      items,
      totalCost: items.reduce((sum, item) => sum + item.totalCost, 0),
      totalLeadTime: Math.max(...items.map(item => item.leadTime))
    }));

    return procurementList;
  }

  getBOM(id: string): BOM | undefined {
    return this.boms.get(id);
  }

  getBOMComparison(id: string): BOMComparison | undefined {
    return this.comparisons.get(id);
  }

  getAllBOMs(): BOM[] {
    return Array.from(this.boms.values());
  }

  getAllComparisons(): BOMComparison[] {
    return Array.from(this.comparisons.values());
  }
}

export const bomManager = new BOMManager();