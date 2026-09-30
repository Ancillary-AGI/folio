import { useState, useEffect } from "react";
import { X, RotateCw, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "./ui/button";

interface ComponentInstance {
  id: string;
  reference: string;
  component: {
    name: string;
    category: string;
    pins: Array<{ id: string; name: string; type: string }>;
  };
  properties: Record<string, string | number | boolean>;
  x: number;
  y: number;
  rotation?: number;
}

interface PropertiesPanelProps {
  component: ComponentInstance | null;
  onUpdate: (id: string, properties: Record<string, string | number | boolean>) => void;
  onClose: () => void;
}

/**
 * Inspector palette: flat section bars over dense label → value rows — the
 * row rhythm of a CAD properties panel, not a web form. Edits stage locally
 * and reach the design through Apply; lock/visibility are live toggle rows.
 */
export default function PropertiesPanel({ component, onUpdate, onClose }: PropertiesPanelProps) {
  const [properties, setProperties] = useState(component?.properties || {});
  const [position, setPosition] = useState({ x: component?.x || 0, y: component?.y || 0 });
  const [rotation, setRotation] = useState(component?.rotation || 0);
  const [isLocked, setIsLocked] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (component) {
      setProperties(component.properties);
      setPosition({ x: component.x, y: component.y });
      setRotation(component.rotation ?? 0);
      setIsLocked(false);
      setIsVisible(true);
      setHasUnsavedChanges(false);
    }
  }, [component]);

  if (!component) return null;

  const handlePropertyChange = (key: string, value: string | number | boolean) => {
    setProperties((prev) => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
  };

  const handlePositionChange = (axis: "x" | "y", value: number) => {
    setPosition((prev) => ({ ...prev, [axis]: value }));
    setHasUnsavedChanges(true);
  };

  const handleRotationChange = (newRotation: number) => {
    setRotation(newRotation);
    setHasUnsavedChanges(true);
  };

  const handleSave = () => {
    onUpdate(component.id, {
      ...properties,
      x: position.x,
      y: position.y,
      rotation,
      locked: isLocked,
      visible: isVisible,
    });
    setHasUnsavedChanges(false);
  };

  const handleReset = () => {
    setProperties(component.properties);
    setPosition({ x: component.x, y: component.y });
    setRotation(component.rotation ?? 0);
    setHasUnsavedChanges(false);
  };

  const getPropertyType = (key: string, value: unknown) => {
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    if (key.toLowerCase().includes("color")) return "color";
    return "text";
  };

  const formatPropertyLabel = (key: string) =>
    key
      .replace(/_/g, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  return (
    <aside className="cad-inspector" aria-label="Properties inspector">
      {/* Palette title: refdes, part type, dirty state, close */}
      <div className="cad-palette-title">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="cad-readout text-[11px] font-bold normal-case tracking-normal text-foreground">
            {component.reference}
          </span>
          <span className="truncate font-normal normal-case tracking-normal text-muted-foreground">
            {component.component.name}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {hasUnsavedChanges && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-warning"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onClose}
            title="Close inspector"
            aria-label="Close inspector"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {/* ── General ── */}
        <div className="cad-section-title">General</div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Reference</span>
          <input
            className="cad-field"
            value={component.reference}
            readOnly
            disabled
            aria-label="Reference designator"
          />
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Type</span>
          <span className="cad-prop-value">{component.component.name}</span>
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Category</span>
          <span className="cad-prop-value">{component.component.category}</span>
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Lock</span>
          <label className="flex min-w-0 items-center gap-1.5">
            <input
              type="checkbox"
              checked={isLocked}
              onChange={(e) => {
                setIsLocked(e.target.checked);
                setHasUnsavedChanges(true);
              }}
              className="h-3 w-3 accent-primary"
            />
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {isLocked ? 'Locked' : 'Free'}
            </span>
          </label>
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Visibility</span>
          <label className="flex min-w-0 items-center gap-1.5">
            <input
              type="checkbox"
              checked={isVisible}
              onChange={(e) => {
                setIsVisible(e.target.checked);
                setHasUnsavedChanges(true);
              }}
              className="h-3 w-3 accent-primary"
            />
            {isVisible ? (
              <Eye className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {isVisible ? 'Shown' : 'Hidden'}
            </span>
          </label>
        </div>

        {/* ── Transform ── */}
        <div className="cad-section-title">Transform</div>
        <div className="cad-prop-row">
          <label className="cad-prop-label" htmlFor="insp-x">
            Position X
          </label>
          <input
            id="insp-x"
            type="number"
            className="cad-field"
            value={position.x}
            onChange={(e) => handlePositionChange('x', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="cad-prop-row">
          <label className="cad-prop-label" htmlFor="insp-y">
            Position Y
          </label>
          <input
            id="insp-y"
            type="number"
            className="cad-field"
            value={position.y}
            onChange={(e) => handlePositionChange('y', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Rotation</span>
          <div className="flex min-w-0 items-center gap-1">
            <input
              type="number"
              min={0}
              max={360}
              step={90}
              value={rotation}
              onChange={(e) => handleRotationChange(parseFloat(e.target.value) || 0)}
              className="cad-field"
              aria-label="Rotation in degrees"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-[22px] w-[22px] shrink-0"
              onClick={() => handleRotationChange((rotation + 90) % 360)}
              title="Rotate 90°"
              aria-label="Rotate 90 degrees"
            >
              <RotateCw className="h-3 w-3" />
            </Button>
            <span className="cad-readout shrink-0 text-[10px] text-muted-foreground">deg</span>
          </div>
        </div>

        {/* ── Attributes ── */}
        {Object.keys(properties).length > 0 && (
          <>
            <div className="cad-section-title">Attributes</div>
            {Object.entries(properties).map(([key, value]) => {
              const propertyType = getPropertyType(key, value);
              return (
                <div key={key} className="cad-prop-row">
                  <span className="cad-prop-label" title={key}>
                    {formatPropertyLabel(key)}
                  </span>
                  {propertyType === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={value as boolean}
                      onChange={(e) => handlePropertyChange(key, e.target.checked)}
                      className="h-3 w-3 accent-primary"
                      aria-label={formatPropertyLabel(key)}
                    />
                  ) : (
                    <input
                      type={propertyType}
                      value={value as string | number}
                      onChange={(e) =>
                        handlePropertyChange(
                          key,
                          propertyType === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
                        )
                      }
                      className="cad-field"
                      aria-label={formatPropertyLabel(key)}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ── Pins ── */}
        {component.component.pins.length > 0 && (
          <>
            <div className="cad-section-title">
              <span>Pins</span>
              <span className="font-mono tabular-nums normal-case tracking-normal">
                {component.component.pins.length}
              </span>
            </div>
            <div className="max-h-44 overflow-y-auto scrollbar-thin">
              {component.component.pins.map((pin, index) => (
                <div key={pin.id} className="cad-prop-row">
                  <span className="cad-prop-value" title={pin.name}>
                    <span className="text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>{' '}
                    {pin.name}
                  </span>
                  <span className="truncate text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    {pin.type}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer: staging state + commit */}
      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-2">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {hasUnsavedChanges ? 'Modified' : 'In sync'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={handleReset}
            disabled={!hasUnsavedChanges}
          >
            Reset
          </Button>
          <Button size="sm" className="h-6 px-3 text-[11px]" onClick={handleSave} disabled={!hasUnsavedChanges}>
            Apply
          </Button>
        </div>
      </div>
    </aside>
  );
}