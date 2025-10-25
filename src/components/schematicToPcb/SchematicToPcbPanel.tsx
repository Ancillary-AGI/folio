import React, { useState } from 'react';
import { schematicToPcbConverter, PCBLayout, ConversionOptions } from '../../lib/schematicToPcb/schematicToPcbConverter';
import { Schematic } from '../../types';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface SchematicToPcbPanelProps {
  schematic: Schematic;
  onPcbGenerated?: (layout: PCBLayout) => void;
}

export const SchematicToPcbPanel: React.FC<SchematicToPcbPanelProps> = ({
  schematic,
  onPcbGenerated
}) => {
  const [isConverting, setIsConverting] = useState(false);
  const [conversionOptions, setConversionOptions] = useState<ConversionOptions>({
    boardSize: { width: 100, height: 80 },
    layerCount: 2,
    designRules: {
      minTraceWidth: 0.2,
      minTraceClearance: 0.2,
      minDrillSize: 0.3,
      minAnnularRing: 0.15,
      boardThickness: 1.6,
      copperThickness: 0.035
    },
    autoRoute: true,
    optimizePlacement: true
  });

  const handleConvert = async () => {
    setIsConverting(true);
    try {
      const layout = await schematicToPcbConverter.convertSchematicToPCB(
        schematic,
        conversionOptions
      );

      if (onPcbGenerated) {
        onPcbGenerated(layout);
      }
    } catch (error) {
      console.error('Conversion failed:', error);
    } finally {
      setIsConverting(false);
    }
  };

  const handleExportGerber = (layout: PCBLayout) => {
    const gerberData = schematicToPcbConverter.exportToGerber(layout);
    const blob = new Blob([gerberData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${layout.name}.gbr`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const validateLayout = (layout: PCBLayout) => {
    return schematicToPcbConverter.validateDesign(layout);
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Schematic to PCB Conversion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="boardWidth">Board Width (mm)</Label>
            <Input
              id="boardWidth"
              type="number"
              value={conversionOptions.boardSize.width}
              onChange={(e) => setConversionOptions(prev => ({
                ...prev,
                boardSize: { ...prev.boardSize, width: parseFloat(e.target.value) }
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="boardHeight">Board Height (mm)</Label>
            <Input
              id="boardHeight"
              type="number"
              value={conversionOptions.boardSize.height}
              onChange={(e) => setConversionOptions(prev => ({
                ...prev,
                boardSize: { ...prev.boardSize, height: parseFloat(e.target.value) }
              }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="layerCount">Layer Count</Label>
          <Select
            value={conversionOptions.layerCount.toString()}
            onValueChange={(value) => setConversionOptions(prev => ({
              ...prev,
              layerCount: parseInt(value)
            }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 Layer</SelectItem>
              <SelectItem value="2">2 Layers</SelectItem>
              <SelectItem value="4">4 Layers</SelectItem>
              <SelectItem value="6">6 Layers</SelectItem>
              <SelectItem value="8">8 Layers</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="traceWidth">Min Trace Width (mm)</Label>
            <Input
              id="traceWidth"
              type="number"
              step="0.1"
              value={conversionOptions.designRules.minTraceWidth}
              onChange={(e) => setConversionOptions(prev => ({
                ...prev,
                designRules: { ...prev.designRules, minTraceWidth: parseFloat(e.target.value) }
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clearance">Min Clearance (mm)</Label>
            <Input
              id="clearance"
              type="number"
              step="0.1"
              value={conversionOptions.designRules.minTraceClearance}
              onChange={(e) => setConversionOptions(prev => ({
                ...prev,
                designRules: { ...prev.designRules, minTraceClearance: parseFloat(e.target.value) }
              }))}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoRoute"
            checked={conversionOptions.autoRoute}
            onCheckedChange={(checked) => setConversionOptions(prev => ({
              ...prev,
              autoRoute: checked as boolean
            }))}
          />
          <Label htmlFor="autoRoute">Auto-route traces</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="optimizePlacement"
            checked={conversionOptions.optimizePlacement}
            onCheckedChange={(checked) => setConversionOptions(prev => ({
              ...prev,
              optimizePlacement: checked as boolean
            }))}
          />
          <Label htmlFor="optimizePlacement">Optimize component placement</Label>
        </div>

        <Button
          onClick={handleConvert}
          disabled={isConverting}
          className="w-full"
        >
          {isConverting ? 'Converting...' : 'Convert to PCB'}
        </Button>

        <div className="text-sm text-muted-foreground">
          <p>Components: {schematic.components.length}</p>
          <p>Wires: {schematic.wires.length}</p>
          <p>Nets: {schematic.nets.length}</p>
        </div>
      </CardContent>
    </Card>
  );
};