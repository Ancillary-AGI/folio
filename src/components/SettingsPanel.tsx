import { useState } from 'react';
import { X, Monitor, Palette, Grid3X3, Save, RotateCcw, Globe, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAppStore } from '../stores/useAppStore';

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, updateSettings } = useAppStore();
  const [localSettings, setLocalSettings] = useState(settings);
  const [hasChanges, setHasChanges] = useState(false);

  const handleSettingChange = (key: keyof typeof settings, value: unknown) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings(localSettings);
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalSettings(settings);
    setHasChanges(false);
  };

  const themes = [
    { id: 'light', name: 'Light', description: 'Clean and bright interface' },
    { id: 'dark', name: 'Dark', description: 'Easy on the eyes' },
    { id: 'professional', name: 'Professional', description: 'Technical dark theme' },
    { id: 'high-contrast', name: 'High Contrast', description: 'Maximum accessibility' },
    { id: 'solarized', name: 'Solarized', description: 'Reduced eye strain' }
  ];

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'zh', name: '中文' },
    { code: 'ja', name: '日本語' }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">Settings</h2>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
                <Button onClick={handleSave}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)] scrollbar-thin">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Appearance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  Appearance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Theme
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {themes.map((theme) => (
                      <div
                        key={theme.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-all ${
                          localSettings.theme === theme.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => handleSettingChange('theme', theme.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-sm">{theme.name}</div>
                            <div className="text-xs text-muted-foreground">{theme.description}</div>
                          </div>
                          <div className="w-4 h-4 rounded-full border-2 border-current">
                            {localSettings.theme === theme.id && (
                              <div className="w-full h-full rounded-full bg-current scale-50" />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Canvas & Grid */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Grid3X3 className="w-4 h-4" />
                  Canvas & Grid
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Grid Size (pixels)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="50"
                    step="5"
                    value={localSettings.gridSize}
                    onChange={(e) => handleSettingChange('gridSize', parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">Show Grid</label>
                    <input
                      type="checkbox"
                      checked={localSettings.showGrid}
                      onChange={(e) => handleSettingChange('showGrid', e.target.checked)}
                      className="rounded"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">Snap to Grid</label>
                    <input
                      type="checkbox"
                      checked={localSettings.snapToGrid}
                      onChange={(e) => handleSettingChange('snapToGrid', e.target.checked)}
                      className="rounded"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">Show Rulers</label>
                    <input
                      type="checkbox"
                      checked={localSettings.showRulers}
                      onChange={(e) => handleSettingChange('showRulers', e.target.checked)}
                      className="rounded"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Auto-Save */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  Auto-Save
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Enable Auto-Save</label>
                  <input
                    type="checkbox"
                    checked={localSettings.autoSave}
                    onChange={(e) => handleSettingChange('autoSave', e.target.checked)}
                    className="rounded"
                  />
                </div>

                {localSettings.autoSave && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Auto-Save Interval (seconds)
                    </label>
                    <select
                      value={localSettings.autoSaveInterval / 1000}
                      onChange={(e) => handleSettingChange('autoSaveInterval', parseInt(e.target.value) * 1000)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background"
                    >
                      <option value={10}>10 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={300}>5 minutes</option>
                      <option value={600}>10 minutes</option>
                    </select>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Localization */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Localization
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Language
                  </label>
                  <select
                    value={localSettings.language}
                    onChange={(e) => handleSettingChange('language', e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  >
                    {languages.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Units
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSettingChange('units', 'metric')}
                      className={`flex-1 px-3 py-2 text-sm border rounded-md transition-colors ${
                        localSettings.units === 'metric'
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      Metric
                    </button>
                    <button
                      onClick={() => handleSettingChange('units', 'imperial')}
                      className={`flex-1 px-3 py-2 text-sm border rounded-md transition-colors ${
                        localSettings.units === 'imperial'
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      Imperial
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Performance */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Performance & Advanced
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-medium text-foreground">Rendering</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-foreground">Hardware Acceleration</label>
                        <input type="checkbox" defaultChecked className="rounded" />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-foreground">Anti-aliasing</label>
                        <input type="checkbox" defaultChecked className="rounded" />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-foreground">High DPI Support</label>
                        <input type="checkbox" defaultChecked className="rounded" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium text-foreground">Memory</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm text-foreground mb-1">
                          Undo History Limit
                        </label>
                        <input
                          type="number"
                          min="10"
                          max="100"
                          defaultValue={50}
                          className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-foreground mb-1">
                          Cache Size (MB)
                        </label>
                        <input
                          type="number"
                          min="50"
                          max="500"
                          defaultValue={100}
                          className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer */}
        {hasChanges && (
          <div className="p-4 border-t border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                You have unsaved changes. Don't forget to save your preferences.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleReset}>
                  Discard Changes
                </Button>
                <Button onClick={handleSave}>
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}