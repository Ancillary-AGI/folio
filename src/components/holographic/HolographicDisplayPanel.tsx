import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { HolographicDisplayManager, HolographicDisplay } from '../../lib/holographic/holographicDisplays';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';

interface HolographicDisplayPanelProps {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  onClose?: () => void;
}

export const HolographicDisplayPanel: React.FC<HolographicDisplayPanelProps> = ({
  scene,
  renderer,
  onClose
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [holoManager] = useState(() => new HolographicDisplayManager(scene, renderer));
  const [displays, setDisplays] = useState<HolographicDisplay[]>([]);
  const [selectedDisplay, setSelectedDisplay] = useState<HolographicDisplay | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Form state for new display
  const [newDisplay, setNewDisplay] = useState({
    name: '',
    type: 'circuit' as const,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#00ff88',
    opacity: 0.8,
    glow: true,
    scanlines: false,
    flicker: false,
    animation: true
  });

  useEffect(() => {
    let animationId: number;

    if (isAnimating) {
      const animate = () => {
        holoManager.animateDisplays();
        renderer.render(scene, new THREE.PerspectiveCamera());
        animationId = requestAnimationFrame(animate);
      };
      animate();
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isAnimating, holoManager, renderer, scene]);

  const createDisplay = () => {
    if (!newDisplay.name.trim()) return;

    const display = holoManager.createHolographicDisplay({
      name: newDisplay.name,
      position: new THREE.Vector3(newDisplay.position.x, newDisplay.position.y, newDisplay.position.z),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(newDisplay.scale.x, newDisplay.scale.y, newDisplay.scale.z),
      content: {
        type: newDisplay.type,
        data: {}
      },
      effects: {
        glow: newDisplay.glow,
        scanlines: newDisplay.scanlines,
        flicker: newDisplay.flicker,
        depth: 1,
        opacity: newDisplay.opacity,
        color: newDisplay.color,
        animation: newDisplay.animation
      },
      visible: true
    });

    setDisplays(holoManager.getAllDisplays());
    setNewDisplay({
      name: '',
      type: 'circuit',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: '#00ff88',
      opacity: 0.8,
      glow: true,
      scanlines: false,
      flicker: false,
      animation: true
    });
  };

  const updateDisplay = (displayId: string, updates: Partial<HolographicDisplay>) => {
    holoManager.updateHolographicDisplay(displayId, updates);
    setDisplays(holoManager.getAllDisplays());
  };

  const removeDisplay = (displayId: string) => {
    holoManager.removeHolographicDisplay(displayId);
    setDisplays(holoManager.getAllDisplays());
    if (selectedDisplay?.id === displayId) {
      setSelectedDisplay(null);
    }
  };

  const toggleVisibility = (displayId: string) => {
    const display = displays.find(d => d.id === displayId);
    if (display) {
      holoManager.setDisplayVisibility(displayId, !display.visible);
      setDisplays(holoManager.getAllDisplays());
    }
  };

  return (
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Holographic Displays
          <div className="flex gap-2">
            <Button
              variant={isAnimating ? "default" : "outline"}
              onClick={() => setIsAnimating(!isAnimating)}
            >
              {isAnimating ? 'Stop Animation' : 'Start Animation'}
            </Button>
            {onClose && (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Create New Display Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create New Holographic Display</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={newDisplay.name}
                  onChange={(e) => setNewDisplay(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Display name"
                />
              </div>
              <div>
                <Label htmlFor="type">Type</Label>
                <Select
                  value={newDisplay.type}
                  onValueChange={(value: 'circuit' | 'component' | 'data' | 'text' | 'model') => setNewDisplay(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="circuit">Circuit</SelectItem>
                    <SelectItem value="component">Component</SelectItem>
                    <SelectItem value="data">Data</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="model">3D Model</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Position X</Label>
                <Input
                  type="number"
                  value={newDisplay.position.x}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    position: { ...prev.position, x: parseFloat(e.target.value) || 0 }
                  }))}
                />
              </div>
              <div>
                <Label>Position Y</Label>
                <Input
                  type="number"
                  value={newDisplay.position.y}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    position: { ...prev.position, y: parseFloat(e.target.value) || 0 }
                  }))}
                />
              </div>
              <div>
                <Label>Position Z</Label>
                <Input
                  type="number"
                  value={newDisplay.position.z}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    position: { ...prev.position, z: parseFloat(e.target.value) || 0 }
                  }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label>Scale X</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={newDisplay.scale.x}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    scale: { ...prev.scale, x: parseFloat(e.target.value) || 1 }
                  }))}
                />
              </div>
              <div>
                <Label>Scale Y</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={newDisplay.scale.y}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    scale: { ...prev.scale, y: parseFloat(e.target.value) || 1 }
                  }))}
                />
              </div>
              <div>
                <Label>Scale Z</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={newDisplay.scale.z}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    scale: { ...prev.scale, z: parseFloat(e.target.value) || 1 }
                  }))}
                />
              </div>
              <div>
                <Label>Opacity</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={newDisplay.opacity}
                  onChange={(e) => setNewDisplay(prev => ({
                    ...prev,
                    opacity: parseFloat(e.target.value) || 0.8
                  }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="color">Color</Label>
                <Input
                  id="color"
                  type="color"
                  value={newDisplay.color}
                  onChange={(e) => setNewDisplay(prev => ({ ...prev, color: e.target.value }))}
                />
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="glow"
                    checked={newDisplay.glow}
                    onCheckedChange={(checked) => setNewDisplay(prev => ({ ...prev, glow: checked }))}
                  />
                  <Label htmlFor="glow">Glow</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="scanlines"
                    checked={newDisplay.scanlines}
                    onCheckedChange={(checked) => setNewDisplay(prev => ({ ...prev, scanlines: checked }))}
                  />
                  <Label htmlFor="scanlines">Scanlines</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="flicker"
                    checked={newDisplay.flicker}
                    onCheckedChange={(checked) => setNewDisplay(prev => ({ ...prev, flicker: checked }))}
                  />
                  <Label htmlFor="flicker">Flicker</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="animation"
                    checked={newDisplay.animation}
                    onCheckedChange={(checked) => setNewDisplay(prev => ({ ...prev, animation: checked }))}
                  />
                  <Label htmlFor="animation">Animation</Label>
                </div>
              </div>
            </div>

            <Button onClick={createDisplay} className="w-full">
              Create Holographic Display
            </Button>
          </CardContent>
        </Card>

        {/* Display List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Displays ({displays.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {displays.length === 0 ? (
              <p className="text-muted-foreground">No holographic displays created yet.</p>
            ) : (
              <div className="space-y-2">
                {displays.map(display => (
                  <div key={display.id} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-4 h-4 rounded"
                        style={{ backgroundColor: display.effects.color }}
                      />
                      <div>
                        <p className="font-medium">{display.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {display.content.type} • {display.visible ? 'Visible' : 'Hidden'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleVisibility(display.id)}
                      >
                        {display.visible ? 'Hide' : 'Show'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedDisplay(display)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeDisplay(display.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Selected Display */}
        {selectedDisplay && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Edit Display: {selectedDisplay.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Position X</Label>
                  <Input
                    type="number"
                    value={selectedDisplay.position.x}
                    onChange={(e) => updateDisplay(selectedDisplay.id, {
                      position: new THREE.Vector3(
                        parseFloat(e.target.value) || 0,
                        selectedDisplay.position.y,
                        selectedDisplay.position.z
                      )
                    })}
                  />
                </div>
                <div>
                  <Label>Position Y</Label>
                  <Input
                    type="number"
                    value={selectedDisplay.position.y}
                    onChange={(e) => updateDisplay(selectedDisplay.id, {
                      position: new THREE.Vector3(
                        selectedDisplay.position.x,
                        parseFloat(e.target.value) || 0,
                        selectedDisplay.position.z
                      )
                    })}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={selectedDisplay.effects.glow}
                    onCheckedChange={(checked) => updateDisplay(selectedDisplay.id, {
                      effects: { ...selectedDisplay.effects, glow: checked }
                    })}
                  />
                  <Label>Glow</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={selectedDisplay.effects.scanlines}
                    onCheckedChange={(checked) => updateDisplay(selectedDisplay.id, {
                      effects: { ...selectedDisplay.effects, scanlines: checked }
                    })}
                  />
                  <Label>Scanlines</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={selectedDisplay.effects.flicker}
                    onCheckedChange={(checked) => updateDisplay(selectedDisplay.id, {
                      effects: { ...selectedDisplay.effects, flicker: checked }
                    })}
                  />
                  <Label>Flicker</Label>
                </div>
              </div>

              <Button onClick={() => setSelectedDisplay(null)}>
                Done Editing
              </Button>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
};