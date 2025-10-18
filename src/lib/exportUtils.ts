interface CanvasComponent {
  id: string;
  reference: string;
  component: {
    name: string;
    category: string;
    pins: any[];
  };
  properties: Record<string, any>;
  x: number;
  y: number;
  rotation: number;
}

interface CanvasWire {
  id: string;
  points: Array<{ x: number; y: number }>;
  netName?: string;
  connected_pins?: any[];
}

export const exportToImage = (canvas: HTMLCanvasElement): string => {
  return canvas.toDataURL('image/png');
};

export const exportToNetlist = (
  components: CanvasComponent[],
  wires: CanvasWire[],
  projectName: string
): string => {
  const lines: string[] = [];

  lines.push(`* ${projectName} Netlist`);
  lines.push(`* Generated: ${new Date().toLocaleString()}`);
  lines.push('');

  lines.push('* Components');
  components.forEach(comp => {
    const props = Object.entries(comp.properties)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    lines.push(`${comp.reference} ${comp.component.name} ${props}`);
  });

  lines.push('');
  lines.push('* Connections');
  wires.forEach((wire, index) => {
    const netName = wire.netName || `NET${index + 1}`;
    lines.push(`* ${netName}: ${wire.points.length} points`);
  });

  lines.push('');
  lines.push('.END');

  return lines.join('\n');
};

export const exportToJSON = (
  components: CanvasComponent[],
  wires: CanvasWire[],
  projectName: string
): string => {
  const data = {
    name: projectName,
    version: '1.0',
    generated: new Date().toISOString(),
    components: components.map(comp => ({
      reference: comp.reference,
      type: comp.component.name,
      category: comp.component.category,
      position: { x: comp.x, y: comp.y },
      rotation: comp.rotation,
      properties: comp.properties
    })),
    wires: wires.map(wire => ({
      points: wire.points,
      netName: wire.netName
    }))
  };

  return JSON.stringify(data, null, 2);
};

export const downloadFile = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportToBOM = (components: CanvasComponent[]): string => {
  const lines: string[] = [];

  lines.push('Bill of Materials (BOM)');
  lines.push('Generated: ' + new Date().toLocaleString());
  lines.push('');
  lines.push('Item\tReference\tComponent\tValue\tQuantity');
  lines.push('----\t---------\t---------\t-----\t--------');

  const componentMap = new Map<string, { refs: string[], value: string, count: number }>();

  components.forEach(comp => {
    const key = `${comp.component.name}_${comp.properties.value || 'N/A'}`;
    if (componentMap.has(key)) {
      const entry = componentMap.get(key)!;
      entry.refs.push(comp.reference);
      entry.count++;
    } else {
      componentMap.set(key, {
        refs: [comp.reference],
        value: comp.properties.value || 'N/A',
        count: 1
      });
    }
  });

  let itemNum = 1;
  componentMap.forEach((entry, key) => {
    const componentName = key.split('_')[0];
    lines.push(`${itemNum}\t${entry.refs.join(', ')}\t${componentName}\t${entry.value}\t${entry.count}`);
    itemNum++;
  });

  return lines.join('\n');
};
