import React, { useMemo, useState } from 'react';
import { schematicToPcbConverter, PCBLayout, ConversionOptions } from '../../lib/schematicToPcb/schematicToPcbConverter';
import { runSchematicERC } from '../../lib/manufacturing/erc';
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
  const [validation, setValidation] = useState<ReturnType<typeof schematicToPcbConverter.validateDesign> | null>(null);
  const erc = useMemo(() => runSchematicERC(schematic), [schematic]);
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
      setValidation(schematicToPcbConverter.validateDesign(layout));

      if (onPcbGenerated) {
        onPcbGenerated(layout);
      }
    } catch (error) {
      console.error('Conversion failed:', error);
    } finally {
      setIsConverting(false);
    }
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

        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Electrical rules</span>
            <span className={erc.summary.errors > 0 ? 'text-destructive' : 'text-muted-foreground'}>
              {erc.summary.errors} errors · {erc.summary.warnings} warnings · {erc.summary.info} info
            </span>
          </div>
          {erc.violations.length === 0 ? (
            <p className="text-xs text-success">No electrical rule violations.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {erc.violations.map((violation, index) => (
                <li
                  key={`${violation.type}-${violation.componentId ?? ''}-${violation.pinId ?? ''}-${index}`}
                  className={`rounded px-2 py-1 text-xs ${
                    violation.severity === 'error'
                      ? 'bg-destructive/10 text-destructive'
                      : violation.severity === 'warning'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {violation.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button
          onClick={handleConvert}
          disabled={isConverting}
          className="w-full"
        >
          {isConverting ? 'Converting...' : 'Convert to PCB'}
        </Button>

        {validation && (
          <div className="rounded-md border border-border p-3 text-xs space-y-1" aria-live="polite">
            <div className="flex items-center justify-between">
              <span className="font-medium">Post-conversion DRC</span>
              <span className={validation.valid ? 'text-success' : 'text-destructive'}>
                {validation.valid ? 'Clean' : `${validation.errors.length} error(s)`}
              </span>
            </div>
            {validation.errors.map((message, index) => (
              <p key={`error-${index}`} className="text-destructive">{message}</p>
            ))}
            {validation.warnings.map((message, index) => (
              <p key={`warning-${index}`} className="text-warning">{message}</p>
            ))}
            {validation.errors.length === 0 && validation.warnings.length === 0 && (
              <p className="text-muted-foreground">No design-rule or connectivity issues found.</p>
            )}
          </div>
        )}

        <div className="text-sm text-muted-foreground">
          <p>Components: {schematic.components.length}</p>
          <p>Wires: {schematic.wires.length}</p>
          <p>Nets: {schematic.nets.length}</p>
        </div>
      </CardContent>
    </Card>
  );
};