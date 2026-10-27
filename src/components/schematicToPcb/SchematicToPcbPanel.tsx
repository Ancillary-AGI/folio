import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { schematicToPcbConverter, PCBLayout, ConversionOptions } from '../../lib/schematicToPcb/schematicToPcbConverter';
import { runSchematicERC } from '../../lib/manufacturing/erc';
import { Schematic } from '../../types';
import { useProjectStore } from '../../stores/useProjectStore';
import { downloadFile } from '../../lib/exportUtils';
import { describeError } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface SchematicToPcbPanelProps {
  schematic: Schematic;
}

type NumericField = 'boardWidth' | 'boardHeight' | 'minTraceWidth' | 'minClearance';

const FIELD_LABELS: Record<NumericField, string> = {
  boardWidth: 'Board Width (mm)',
  boardHeight: 'Board Height (mm)',
  minTraceWidth: 'Min Trace Width (mm)',
  minClearance: 'Min Clearance (mm)',
};

/** Rules the converter needs but this panel does not expose as editable fields. */
const FIXED_DESIGN_RULES = {
  minDrillSize: 0.3,
  minAnnularRing: 0.15,
  boardThickness: 1.6,
  copperThickness: 0.035,
};

const NumberField: React.FC<{
  id: NumericField;
  value: string;
  step?: string;
  onChange: (id: NumericField, value: string) => void;
}> = ({ id, value, step, onChange }) => (
  <div className="space-y-2">
    <Label htmlFor={id}>{FIELD_LABELS[id]}</Label>
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      onChange={(e) => onChange(id, e.target.value)}
    />
  </div>
);

interface ConversionSummary {
  boardMm: { width: number; height: number };
  copperLayers: number;
  components: number;
  traces: number;
  vias: number;
  routing: PCBLayout['routing'];
}

const summarise = (layout: PCBLayout): ConversionSummary => ({
  boardMm: { width: layout.width, height: layout.height },
  copperLayers: layout.layers.filter(l => l.type === 'signal' || l.type === 'power' || l.type === 'ground').length,
  components: layout.components.length,
  traces: layout.traces.length,
  vias: layout.vias.length,
  routing: layout.routing,
});

/** Routing wording that names what the router actually finished. */
const routingLabel = (routing: ConversionSummary['routing']): string => {
  if (!routing) return 'No routing pass ran on this layout.';
  if (routing.mode === 'wire-copy') {
    return 'Auto-route was off: schematic wire geometry was copied as copper, so pad-level connectivity is unverified.';
  }
  const routeable = routing.routeableNets ?? 0;
  if (routing.unroutedNets.length === 0) {
    return `Netlist router finished ${routeable}/${routeable} nets.`;
  }
  return `Netlist router finished ${routeable - routing.unroutedNets.length}/${routeable} nets — unfinished: ${routing.unroutedNets.join(', ')}.`;
};

export const SchematicToPcbPanel: React.FC<SchematicToPcbPanelProps> = ({
  schematic
}) => {
  const [isConverting, setIsConverting] = useState(false);
  const [validation, setValidation] = useState<ReturnType<typeof schematicToPcbConverter.validateDesign> | null>(null);
  const [summary, setSummary] = useState<ConversionSummary | null>(null);
  const [convertedLayout, setConvertedLayout] = useState<PCBLayout | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const erc = useMemo(() => runSchematicERC(schematic), [schematic]);
  // The converter keys nets on `netName || wire.id`, and declared nets are only
  // present when the caller supplies them; quoting schematic.nets.length alone
  // reported "0 nets" on every live sheet.
  const derivedNetCount = useMemo(() => {
    const names = new Set<string>();
    for (const net of schematic.nets) names.add(net.name || net.id);
    for (const wire of schematic.wires) names.add(wire.netName || wire.id);
    return names.size;
  }, [schematic]);
  const [layerCount, setLayerCount] = useState(2);
  const [autoRoute, setAutoRoute] = useState(true);
  const [optimizePlacement, setOptimizePlacement] = useState(true);
  // Kept as text: parsing straight to a number made an emptied box NaN, which
  // React rejects and the router then refused with an opaque error.
  const [fields, setFields] = useState<Record<NumericField, string>>({
    boardWidth: '100',
    boardHeight: '80',
    minTraceWidth: '0.2',
    minClearance: '0.2',
  });

  const numericFields = useMemo(() => {
    const parsed = Object.fromEntries(
      (Object.keys(fields) as NumericField[]).map((key) => [key, Number.parseFloat(fields[key])]),
    ) as Record<NumericField, number>;
    const invalid = (Object.keys(parsed) as NumericField[]).filter(
      (key) => !Number.isFinite(parsed[key]) || parsed[key] <= 0,
    );
    return { parsed, invalid };
  }, [fields]);

  const conversionOptions: ConversionOptions = useMemo(() => ({
    boardSize: { width: numericFields.parsed.boardWidth, height: numericFields.parsed.boardHeight },
    layerCount,
    designRules: {
      ...FIXED_DESIGN_RULES,
      minTraceWidth: numericFields.parsed.minTraceWidth,
      minTraceClearance: numericFields.parsed.minClearance,
    },
    autoRoute,
    optimizePlacement,
  }), [numericFields, layerCount, autoRoute, optimizePlacement]);

  const setField = (id: NumericField, value: string) => setFields(prev => ({ ...prev, [id]: value }));

  const handleConvert = async () => {
    setIsConverting(true);
    setConversionError(null);
    try {
      const layout = await schematicToPcbConverter.convertSchematicToPCB(
        schematic,
        conversionOptions
      );
      setValidation(schematicToPcbConverter.validateDesign(layout));
      setSummary(summarise(layout));
      setConvertedLayout(layout);
      // Publish the board as the project's live layout: the 3-D preview, the PCB
      // editor's adopt path, the agent snapshot and version control all read it,
      // and none of them saw the conversion before.
      useProjectStore.getState().setPcbLayout(schematicToPcbConverter.toSceneInput(layout));
    } catch (error) {
      setValidation(null);
      setSummary(null);
      setConvertedLayout(null);
      setConversionError(describeError(error));
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownloadGerber = () => {
    if (!convertedLayout) return;
    downloadFile(
      schematicToPcbConverter.exportToGerber(convertedLayout),
      `converted_top_copper_${convertedLayout.id}.gbr`,
      'text/plain',
    );
  };


  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Schematic to PCB Conversion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <NumberField id="boardWidth" value={fields.boardWidth} onChange={setField} />
          <NumberField id="boardHeight" value={fields.boardHeight} onChange={setField} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="layerCount">Layer Count</Label>
          <Select
            value={layerCount.toString()}
            onValueChange={(value) => setLayerCount(Number.parseInt(value, 10))}
          >
            <SelectTrigger id="layerCount">
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
          <NumberField id="minTraceWidth" step="0.1" value={fields.minTraceWidth} onChange={setField} />
          <NumberField id="minClearance" step="0.1" value={fields.minClearance} onChange={setField} />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoRoute"
            checked={autoRoute}
            onCheckedChange={(checked) => setAutoRoute(checked === true)}
          />
          <Label htmlFor="autoRoute">Auto-route traces</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="optimizePlacement"
            checked={optimizePlacement}
            onCheckedChange={(checked) => setOptimizePlacement(checked === true)}
          />
          <Label htmlFor="optimizePlacement">Optimize component placement</Label>
        </div>

        {numericFields.invalid.length > 0 && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {numericFields.invalid.map(key => FIELD_LABELS[key]).join(', ')} must be a positive number.
          </p>
        )}

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
          disabled={isConverting || numericFields.invalid.length > 0}
          className="w-full"
        >
          {isConverting ? 'Converting...' : 'Convert to PCB'}
        </Button>

        {conversionError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            Conversion failed: {conversionError}. No board was published.
          </p>
        )}

        {summary && (
          <div className="rounded-md border border-border p-3 space-y-2 text-xs" aria-live="polite">
            <div className="flex items-center justify-between">
              <span className="font-medium">Converted board</span>
              <span className="text-muted-foreground">
                {summary.boardMm.width} × {summary.boardMm.height} mm · {summary.copperLayers} copper layer(s)
              </span>
            </div>
            <p className="text-muted-foreground">
              {summary.components} placed part(s) · {summary.traces} trace segment(s) · {summary.vias} via(s)
            </p>
            <p
              className={
                summary.routing?.mode === 'netlist' && summary.routing.unroutedNets.length > 0
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }
            >
              {routingLabel(summary.routing)}
            </p>
            <p className="text-muted-foreground">
              Published as the project board layout — the 3-D preview and the PCB editor read it.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDownloadGerber} className="text-xs">
                <Download className="w-3 h-3 mr-1" />Top-copper Gerber
              </Button>
              <span className="text-[10px] text-muted-foreground">
                One RS-274X copper file for checking the routed shape; the full fab package (masks, silk, outline,
                drill) comes from the PCB panel.
              </span>
            </div>
          </div>
        )}

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
              <p className="text-muted-foreground">No design-rule, connectivity or routing errors found.</p>
            )}
          </div>
        )}

        <div className="text-sm text-muted-foreground">
          <p>Components: {schematic.components.length}</p>
          <p>Wires: {schematic.wires.length}</p>
          <p>Nets resolved from wires and declared nets: {derivedNetCount}</p>
        </div>
      </CardContent>
    </Card>
  );
};