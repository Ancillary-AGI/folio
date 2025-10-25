import { useState, useEffect } from "react";
import {
  X,
  Save,
  RotateCw,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Info,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface ComponentInstance {
  id: string;
  reference: string;
  component: {
    name: string;
    category: string;
    pins: Array<{
      id: string;
      name: string;
      type: string;
    }>;
  };
  properties: Record<string, string | number | boolean>;
  x: number;
  y: number;
  rotation?: number;
}

interface PropertiesPanelProps {
  component: ComponentInstance | null;
  onUpdate: (
    id: string,
    properties: Record<string, string | number | boolean>
  ) => void;
  onClose: () => void;
}

export default function PropertiesPanel({
  component,
  onUpdate,
  onClose,
}: PropertiesPanelProps) {
  const [properties, setProperties] = useState(component?.properties || {});
  const [position, setPosition] = useState({
    x: component?.x || 0,
    y: component?.y || 0,
  });
  const [rotation, setRotation] = useState(component?.rotation || 0);
  const [isLocked, setIsLocked] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (component) {
      setProperties(component.properties);
      setPosition({ x: component.x, y: component.y });
      setRotation(component.rotation);
      setHasUnsavedChanges(false);
    }
  }, [component]);

  if (!component) return null;

  const handlePropertyChange = (
    key: string,
    value: string | number | boolean
  ) => {
    const updated = { ...properties, [key]: value };
    setProperties(updated);
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
    setRotation(component.rotation);
    setHasUnsavedChanges(false);
  };

  const getPropertyType = (key: string, value: unknown) => {
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    if (key.toLowerCase().includes("color")) return "color";
    return "text";
  };

  const formatPropertyLabel = (key: string) => {
    return key
      .replace(/_/g, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  return (
    <div className="w-80 h-full bg-card border-l border-border shadow-lg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-foreground">Properties</h3>
          {hasUnsavedChanges && (
            <div
              className="w-2 h-2 bg-orange-500 rounded-full"
              title="Unsaved changes"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
          >
            <Save className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-4">
          {/* Component Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="w-4 h-4" />
                Component Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Reference Designator
                </label>
                <input
                  type="text"
                  value={component.reference}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-muted/50 text-muted-foreground"
                  disabled
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Component Type
                </label>
                <input
                  type="text"
                  value={component.component.name}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-muted/50 text-muted-foreground"
                  disabled
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={component.component.category}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-muted/50 text-muted-foreground"
                  disabled
                />
              </div>
            </CardContent>
          </Card>

          {/* Transform */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Transform</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    X Position
                  </label>
                  <input
                    type="number"
                    value={position.x}
                    onChange={(e) =>
                      handlePositionChange("x", parseFloat(e.target.value) || 0)
                    }
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Y Position
                  </label>
                  <input
                    type="number"
                    value={position.y}
                    onChange={(e) =>
                      handlePositionChange("y", parseFloat(e.target.value) || 0)
                    }
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Rotation (degrees)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rotation}
                    onChange={(e) =>
                      handleRotationChange(parseFloat(e.target.value) || 0)
                    }
                    min="0"
                    max="360"
                    step="90"
                    className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleRotationChange((rotation + 90) % 360)}
                    className="h-8 w-8"
                  >
                    <RotateCw className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Component Properties */}
          {Object.keys(properties).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Electrical Properties</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(properties).map(([key, value]) => {
                  const propertyType = getPropertyType(key, value);

                  return (
                    <div key={key}>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        {formatPropertyLabel(key)}
                      </label>
                      {propertyType === "checkbox" ? (
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={value as boolean}
                            onChange={(e) =>
                              handlePropertyChange(key, e.target.checked)
                            }
                            className="rounded border-input"
                          />
                          <span className="text-sm">
                            {value ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      ) : (
                        <input
                          type={propertyType}
                          value={value as string | number}
                          onChange={(e) => {
                            const newValue =
                              propertyType === "number"
                                ? parseFloat(e.target.value) || 0
                                : e.target.value;
                            handlePropertyChange(key, newValue);
                          }}
                          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
                          placeholder={`Enter ${formatPropertyLabel(
                            key
                          ).toLowerCase()}`}
                        />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Pin Configuration */}
          {component.component.pins && component.component.pins.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Pin Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-thin">
                  {component.component.pins.map((pin) => (
                    <div
                      key={pin.id}
                      className="flex items-center justify-between text-xs p-2 bg-muted/30 rounded"
                    >
                      <span className="font-medium">{pin.name}</span>
                      <span className="text-muted-foreground capitalize">
                        {pin.type}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Component Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Copy className="w-3 h-3" />
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setIsLocked(!isLocked)}
                >
                  <Lock className="w-3 h-3" />
                  {isLocked ? "Unlock" : "Lock"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setIsVisible(!isVisible)}
                >
                  {isVisible ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3" />
                  )}
                  {isVisible ? "Hide" : "Show"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border bg-card">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasUnsavedChanges}
            className="flex-1"
          >
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
            className="flex-1"
          >
            Apply Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
