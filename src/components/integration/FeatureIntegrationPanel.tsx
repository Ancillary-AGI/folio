import React, { useState, useEffect } from 'react';
import { FeatureIntegrationManager, IntegrationConfig, FeatureStatus } from '../../lib/integration/featureIntegration';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Alert, AlertDescription } from '../ui/alert';
import {
  Mic,
  Volume2,
  Eye,
  Hand,
  Camera,
  Glasses,
  Sparkles,
  Trophy,
  Kanban,
  Settings,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2
} from 'lucide-react';

interface FeatureIntegrationPanelProps {
  userId: string;
  canvas?: HTMLCanvasElement;
  onClose?: () => void;
}

export const FeatureIntegrationPanel: React.FC<FeatureIntegrationPanelProps> = ({
  userId,
  canvas,
  onClose
}) => {
  const [integrationManager, setIntegrationManager] = useState<FeatureIntegrationManager | null>(null);
  const [config, setConfig] = useState<IntegrationConfig>({
    userId,
    enableVoiceControl: true,
    enableSpeechSynthesis: true,
    enableScreenReader: true,
    enableGestureRecognition: true,
    enableAR: false,
    enableVR: false,
    enableHolographic: true,
    enableGamification: true,
    enableKanban: true,
    wakeWord: 'circuit',
    voiceCommandsEnabled: true,
    gestureSensitivity: 1.0
  });
  const [featureStatuses, setFeatureStatuses] = useState<FeatureStatus[]>([]);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    // Initialize integration manager
    const manager = new FeatureIntegrationManager(config);
    setIntegrationManager(manager);

    // Set canvas if provided
    if (canvas) {
      manager.setCanvas(canvas);
    }

    // Get initial feature statuses
    setFeatureStatuses(manager.getFeatureStatuses());

    // Set up status update listener
    const updateStatuses = () => {
      setFeatureStatuses(manager.getFeatureStatuses());
    };

    // Update statuses periodically
    const interval = setInterval(updateStatuses, 2000);

    return () => {
      clearInterval(interval);
      manager.destroy();
    };
  }, [config, canvas]);

  const updateConfig = (updates: Partial<IntegrationConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
    if (integrationManager) {
      integrationManager.updateConfig({ ...config, ...updates });
    }
  };

  const getFeatureIcon = (featureName: string) => {
    switch (featureName) {
      case 'voiceControl': return <Mic className="w-4 h-4" />;
      case 'speechSynthesis': return <Volume2 className="w-4 h-4" />;
      case 'screenReader': return <Eye className="w-4 h-4" />;
      case 'gestureRecognition': return <Hand className="w-4 h-4" />;
      case 'ar': return <Camera className="w-4 h-4" />;
      case 'vr': return <Glasses className="w-4 h-4" />;
      case 'holographic': return <Sparkles className="w-4 h-4" />;
      case 'gamification': return <Trophy className="w-4 h-4" />;
      case 'kanban': return <Kanban className="w-4 h-4" />;
      default: return <Settings className="w-4 h-4" />;
    }
  };

  const getStatusIcon = (status: FeatureStatus['status']) => {
    switch (status) {
      case 'ready': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'initializing': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'disabled': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default: return <Settings className="w-4 h-4" />;
    }
  };

  const getStatusBadgeVariant = (status: FeatureStatus['status']) => {
    switch (status) {
      case 'ready': return 'default';
      case 'initializing': return 'secondary';
      case 'error': return 'destructive';
      case 'disabled': return 'outline';
      default: return 'outline';
    }
  };

  const handleQuickAction = async (action: string) => {
    if (!integrationManager) return;

    switch (action) {
      case 'speak-status':
        await integrationManager.speakStatus();
        break;
      case 'announce-status':
        integrationManager.announceFeatureStatus();
        break;
      case 'initialize-vr':
        await integrationManager.initializeVR();
        break;
      case 'initialize-ar':
        await integrationManager.initializeAR();
        break;
    }
  };

  const enabledFeatures = featureStatuses.filter(f => f.enabled);
  const availableFeatures = featureStatuses.filter(f => f.available);
  const readyFeatures = featureStatuses.filter(f => f.status === 'ready');
  const errorFeatures = featureStatuses.filter(f => f.status === 'error');

  return (
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-6 h-6" />
            Feature Integration Hub
          </div>
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Status Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{enabledFeatures.length}</p>
                      <p className="text-xs text-muted-foreground">Enabled</p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{availableFeatures.length}</p>
                      <p className="text-xs text-muted-foreground">Available</p>
                    </div>
                    <Glasses className="w-8 h-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{readyFeatures.length}</p>
                      <p className="text-xs text-muted-foreground">Ready</p>
                    </div>
                    <Loader2 className="w-8 h-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{errorFeatures.length}</p>
                      <p className="text-xs text-muted-foreground">Errors</p>
                    </div>
                    <XCircle className="w-8 h-8 text-red-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleQuickAction('speak-status')}
                    disabled={!config.enableSpeechSynthesis}
                  >
                    <Volume2 className="w-4 h-4 mr-2" />
                    Speak Status
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleQuickAction('announce-status')}
                    disabled={!config.enableScreenReader}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Announce Status
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleQuickAction('initialize-vr')}
                    disabled={!config.enableVR}
                  >
                    <Glasses className="w-4 h-4 mr-2" />
                    Init VR
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleQuickAction('initialize-ar')}
                    disabled={!config.enableAR}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Init AR
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Feature Status Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Feature Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {featureStatuses.map(feature => (
                    <div key={feature.name} className="flex items-center justify-between p-3 border rounded">
                      <div className="flex items-center gap-3">
                        {getFeatureIcon(feature.name)}
                        <div>
                          <p className="font-medium capitalize">{feature.name.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="text-sm text-muted-foreground">
                            {feature.available ? 'Available' : 'Not Available'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getStatusBadgeVariant(feature.status)}>
                          {feature.status}
                        </Badge>
                        {getStatusIcon(feature.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {featureStatuses.map(feature => (
                <Card key={feature.name}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getFeatureIcon(feature.name)}
                        <span className="capitalize">{feature.name.replace(/([A-Z])/g, ' $1')}</span>
                      </div>
                      <Switch
                        checked={feature.enabled}
                        onCheckedChange={(enabled) => {
                          const configKey = `enable${feature.name.charAt(0).toUpperCase() + feature.name.slice(1)}` as keyof IntegrationConfig;
                          updateConfig({ [configKey]: enabled });
                        }}
                      />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Status:</span>
                        <Badge variant={getStatusBadgeVariant(feature.status)}>
                          {feature.status}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm">Available:</span>
                        <span className={feature.available ? 'text-green-600' : 'text-red-600'}>
                          {feature.available ? 'Yes' : 'No'}
                        </span>
                      </div>

                      {feature.error && (
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>{feature.error}</AlertDescription>
                        </Alert>
                      )}

                      <div className="text-xs text-muted-foreground">
                        {feature.name === 'voiceControl' && 'Voice commands and wake word detection'}
                        {feature.name === 'speechSynthesis' && 'Text-to-speech feedback and announcements'}
                        {feature.name === 'screenReader' && 'Accessibility announcements and keyboard navigation'}
                        {feature.name === 'gestureRecognition' && 'Touch and multi-touch gesture support'}
                        {feature.name === 'ar' && 'Augmented reality circuit visualization'}
                        {feature.name === 'vr' && 'Virtual reality design environment'}
                        {feature.name === 'holographic' && '3D holographic display system'}
                        {feature.name === 'gamification' && 'Achievements, levels, and leaderboards'}
                        {feature.name === 'kanban' && 'Project management and task tracking'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Voice Control Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="wake-word">Wake Word</Label>
                  <Input
                    id="wake-word"
                    value={config.wakeWord}
                    onChange={(e) => updateConfig({ wakeWord: e.target.value })}
                    placeholder="Enter wake word"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="voice-commands"
                    checked={config.voiceCommandsEnabled}
                    onCheckedChange={(enabled) => updateConfig({ voiceCommandsEnabled: enabled })}
                  />
                  <Label htmlFor="voice-commands">Enable Voice Commands</Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Gesture Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="gesture-sensitivity">Gesture Sensitivity: {config.gestureSensitivity.toFixed(1)}</Label>
                  <input
                    id="gesture-sensitivity"
                    type="range"
                    min="0.1"
                    max="2.0"
                    step="0.1"
                    value={config.gestureSensitivity}
                    onChange={(e) => updateConfig({ gestureSensitivity: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Feature Toggles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="ar-toggle"
                      checked={config.enableAR}
                      onCheckedChange={(enabled) => updateConfig({ enableAR: enabled })}
                    />
                    <Label htmlFor="ar-toggle">Augmented Reality</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="vr-toggle"
                      checked={config.enableVR}
                      onCheckedChange={(enabled) => updateConfig({ enableVR: enabled })}
                    />
                    <Label htmlFor="vr-toggle">Virtual Reality</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="holographic-toggle"
                      checked={config.enableHolographic}
                      onCheckedChange={(enabled) => updateConfig({ enableHolographic: enabled })}
                    />
                    <Label htmlFor="holographic-toggle">Holographic Displays</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="gamification-toggle"
                      checked={config.enableGamification}
                      onCheckedChange={(enabled) => updateConfig({ enableGamification: enabled })}
                    />
                    <Label htmlFor="gamification-toggle">Gamification</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="diagnostics" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>System Diagnostics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Browser Capabilities</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Speech Recognition: {speechSynthesisManager.isSupported() ? '✅' : '❌'}</div>
                      <div>Speech Synthesis: {speechSynthesisManager.isSupported() ? '✅' : '❌'}</div>
                      <div>WebGL: {'WebGLRenderingContext' in window ? '✅' : '❌'}</div>
                      <div>WebXR: {navigator.xr ? '✅' : '❌'}</div>
                      <div>Touch Events: {'ontouchstart' in window ? '✅' : '❌'}</div>
                      <div>Gamepad API: {navigator.getGamepads ? '✅' : '❌'}</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Integration Status</h4>
                    <div className="space-y-2">
                      {errorFeatures.map(feature => (
                        <Alert key={feature.name}>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <strong>{feature.name}:</strong> {feature.error}
                          </AlertDescription>
                        </Alert>
                      ))}
                      {errorFeatures.length === 0 && (
                        <p className="text-green-600 text-sm">All features are functioning correctly</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Performance Metrics</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Active Features: {enabledFeatures.length}</div>
                      <div>Ready Features: {readyFeatures.length}</div>
                      <div>Memory Usage: Checking...</div>
                      <div>Event Listeners: {integrationManager ? 'Active' : 'Inactive'}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};