import { arManager } from '../augmentedReality/augmentedReality';
import { HolographicDisplayManager } from '../holographic/holographicDisplays';
import { KanbanBoardManager } from '../projectManagement/kanbanBoard';
import { gamificationEngine } from '../gamification/gamificationEngine';
import { speechRecognitionManager } from '../speech/speechRecognition';
import { speechSynthesisManager } from '../speech/speechSynthesis';
import { screenReaderManager } from '../accessibility/screenReader';
import { voiceControlManager } from '../voice/voiceControl';
import { GestureRecognizer } from '../gesture/gestureRecognition';
import { vrManager } from '../vr/virtualRealityEnhancements';

export interface IntegrationConfig {
  userId: string;
  enableVoiceControl: boolean;
  enableSpeechSynthesis: boolean;
  enableScreenReader: boolean;
  enableGestureRecognition: boolean;
  enableAR: boolean;
  enableVR: boolean;
  enableHolographic: boolean;
  enableGamification: boolean;
  enableKanban: boolean;
  wakeWord: string;
  voiceCommandsEnabled: boolean;
  gestureSensitivity: number;
}

export interface FeatureStatus {
  name: string;
  enabled: boolean;
  available: boolean;
  status: 'ready' | 'initializing' | 'error' | 'disabled';
  error?: string;
}

export class FeatureIntegrationManager {
  private config: IntegrationConfig;
  private featureStatuses: Map<string, FeatureStatus> = new Map();
  private canvas: HTMLCanvasElement | null = null;
  private gestureRecognizer: GestureRecognizer | null = null;
  private holographicManager: HolographicDisplayManager | null = null;
  private kanbanManager: KanbanBoardManager | null = null;
  private eventListeners: Map<string, ((data: any) => void)[]> = new Map();

  constructor(config: IntegrationConfig) {
    this.config = config;
    this.initializeFeatureStatuses();
    this.initializeIntegration();
  }

  private initializeFeatureStatuses(): void {
    const features = [
      { name: 'voiceControl', check: () => speechRecognitionManager.isSupported() },
      { name: 'speechSynthesis', check: () => speechSynthesisManager.isSupported() },
      { name: 'screenReader', check: () => true }, // Always available
      { name: 'gestureRecognition', check: () => true }, // Touch events always available
      { name: 'ar', check: () => arManager.isARSupported() },
      { name: 'vr', check: () => vrManager.isVRSupported() },
      { name: 'holographic', check: () => true }, // Three.js always available
      { name: 'gamification', check: () => true }, // Always available
      { name: 'kanban', check: () => true } // Always available
    ];

    features.forEach(({ name, check }) => {
      this.featureStatuses.set(name, {
        name,
        enabled: this.isFeatureEnabled(name),
        available: check(),
        status: 'ready'
      });
    });
  }

  private isFeatureEnabled(featureName: string): boolean {
    switch (featureName) {
      case 'voiceControl': return this.config.enableVoiceControl;
      case 'speechSynthesis': return this.config.enableSpeechSynthesis;
      case 'screenReader': return this.config.enableScreenReader;
      case 'gestureRecognition': return this.config.enableGestureRecognition;
      case 'ar': return this.config.enableAR;
      case 'vr': return this.config.enableVR;
      case 'holographic': return this.config.enableHolographic;
      case 'gamification': return this.config.enableGamification;
      case 'kanban': return this.config.enableKanban;
      default: return false;
    }
  }

  private async initializeIntegration(): Promise<void> {
    try {
      // Initialize enabled features
      if (this.config.enableVoiceControl && speechRecognitionManager.isSupported()) {
        await this.initializeVoiceControl();
      }

      if (this.config.enableSpeechSynthesis && speechSynthesisManager.isSupported()) {
        this.initializeSpeechSynthesis();
      }

      if (this.config.enableScreenReader) {
        this.initializeScreenReader();
      }

      if (this.config.enableGamification) {
        this.initializeGamification();
      }

      if (this.config.enableKanban) {
        this.initializeKanban();
      }

      // Set up cross-feature event handling
      this.setupEventBridges();

    } catch (error) {
      console.error('Error initializing feature integration:', error);
    }
  }

  private async initializeVoiceControl(): Promise<void> {
    try {
      this.updateFeatureStatus('voiceControl', 'initializing');

      // Initialize speech recognition
      const initialized = await speechRecognitionManager.initialize();
      if (!initialized) {
        throw new Error('Speech recognition initialization failed');
      }

      // Set wake word
      voiceControlManager.setWakeWord(this.config.wakeWord);

      // Start voice control if enabled
      if (this.config.voiceCommandsEnabled) {
        await voiceControlManager.activateVoiceControl();
      }

      this.updateFeatureStatus('voiceControl', 'ready');
    } catch (error) {
      this.updateFeatureStatus('voiceControl', 'error', error.message);
    }
  }

  private initializeSpeechSynthesis(): void {
    try {
      this.updateFeatureStatus('speechSynthesis', 'initializing');

      // Speech synthesis is ready to use
      this.updateFeatureStatus('speechSynthesis', 'ready');
    } catch (error) {
      this.updateFeatureStatus('speechSynthesis', 'error', error.message);
    }
  }

  private initializeScreenReader(): void {
    try {
      this.updateFeatureStatus('screenReader', 'initializing');

      // Screen reader is ready to use
      this.updateFeatureStatus('screenReader', 'ready');
    } catch (error) {
      this.updateFeatureStatus('screenReader', 'error', error.message);
    }
  }

  private initializeGamification(): void {
    try {
      this.updateFeatureStatus('gamification', 'initializing');

      // Ensure user stats exist
      gamificationEngine.getOrCreateUserStats(this.config.userId);

      this.updateFeatureStatus('gamification', 'ready');
    } catch (error) {
      this.updateFeatureStatus('gamification', 'error', error.message);
    }
  }

  private initializeKanban(): void {
    try {
      this.updateFeatureStatus('kanban', 'initializing');

      this.kanbanManager = new KanbanBoardManager();

      this.updateFeatureStatus('kanban', 'ready');
    } catch (error) {
      this.updateFeatureStatus('kanban', 'error', error.message);
    }
  }

  private setupEventBridges(): void {
    // Voice control -> Circuit actions
    voiceControlManager.onCommand((command) => {
      this.handleVoiceCommand(command);
    });

    // Circuit actions -> Gamification events
    this.addEventListener('circuit-action', (data) => {
      if (this.config.enableGamification) {
        this.trackGamificationEvent(data.action, data);
      }
    });

    // Circuit actions -> Speech feedback
    this.addEventListener('circuit-action', async (data) => {
      if (this.config.enableSpeechSynthesis) {
        await speechSynthesisManager.speakCircuitFeedback(
          `Action performed: ${data.action}`,
          'info'
        );
      }
    });

    // Circuit actions -> Screen reader announcements
    this.addEventListener('circuit-action', (data) => {
      if (this.config.enableScreenReader) {
        screenReaderManager.announceAction(`Circuit ${data.action} completed`);
      }
    });
  }

  private async handleVoiceCommand(command: any): Promise<void> {
    // Route voice commands to appropriate features
    switch (command.action) {
      case 'start_simulation':
        this.emitEvent('circuit-action', { action: 'simulation_started' });
        break;
      case 'stop_simulation':
        this.emitEvent('circuit-action', { action: 'simulation_stopped' });
        break;
      case 'add_component':
        this.emitEvent('circuit-action', {
          action: 'component_added',
          componentType: command.parameters?.componentType
        });
        break;
      case 'save_project':
        this.emitEvent('circuit-action', { action: 'project_saved' });
        break;
    }
  }

  private trackGamificationEvent(eventType: string, data: any): void {
    switch (eventType) {
      case 'simulation_started':
        gamificationEngine.trackEvent({
          type: 'simulation_completed',
          userId: this.config.userId,
          data,
          timestamp: new Date()
        });
        break;
      case 'component_added':
        gamificationEngine.trackEvent({
          type: 'circuit_created',
          userId: this.config.userId,
          data,
          timestamp: new Date()
        });
        break;
      case 'project_saved':
        // Could track as a different event
        break;
    }
  }

  // Canvas and gesture setup
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    if (this.config.enableGestureRecognition) {
      this.initializeGestureRecognition();
    }

    if (this.config.enableHolographic) {
      this.initializeHolographicDisplays();
    }
  }

  private initializeGestureRecognition(): void {
    if (!this.canvas) return;

    try {
      this.updateFeatureStatus('gestureRecognition', 'initializing');

      this.gestureRecognizer = new GestureRecognizer(this.canvas, {
        tapThreshold: 200,
        longPressThreshold: 500,
        swipeThreshold: 50,
        pinchThreshold: 0.1,
        rotateThreshold: 15,
        multiTouchEnabled: true,
        maxPointers: 5
      });

      // Add circuit-specific gesture handler
      const { createCircuitGestureHandler } = require('../gesture/gestureRecognition');
      const gestureHandler = createCircuitGestureHandler({
        onComponentSelect: (x, y) => {
          this.emitEvent('gesture-action', { type: 'component_select', x, y });
        },
        onPan: (dx, dy) => {
          this.emitEvent('gesture-action', { type: 'pan', dx, dy });
        },
        onZoom: (scale, centerX, centerY) => {
          this.emitEvent('gesture-action', { type: 'zoom', scale, centerX, centerY });
        }
      });

      this.gestureRecognizer.addGestureHandler(gestureHandler);

      this.updateFeatureStatus('gestureRecognition', 'ready');
    } catch (error) {
      this.updateFeatureStatus('gestureRecognition', 'error', error.message);
    }
  }

  private initializeHolographicDisplays(): void {
    if (!this.canvas) return;

    try {
      this.updateFeatureStatus('holographic', 'initializing');

      // Create a basic Three.js scene for holographic displays
      const scene = new (require('three')).Scene();
      const renderer = new (require('three')).WebGLRenderer({ canvas: this.canvas });

      this.holographicManager = new HolographicDisplayManager(scene, renderer);

      this.updateFeatureStatus('holographic', 'ready');
    } catch (error) {
      this.updateFeatureStatus('holographic', 'error', error.message);
    }
  }

  // VR Integration
  async initializeVR(): Promise<boolean> {
    if (!this.config.enableVR || !this.canvas) return false;

    try {
      this.updateFeatureStatus('vr', 'initializing');

      const session = await vrManager.createVRSession(`vr-session-${Date.now()}`, this.canvas);
      if (session) {
        this.updateFeatureStatus('vr', 'ready');
        return true;
      } else {
        this.updateFeatureStatus('vr', 'error', 'VR session creation failed');
        return false;
      }
    } catch (error) {
      this.updateFeatureStatus('vr', 'error', error.message);
      return false;
    }
  }

  // AR Integration
  async initializeAR(): Promise<boolean> {
    if (!this.config.enableAR || !this.canvas) return false;

    try {
      this.updateFeatureStatus('ar', 'initializing');

      const supported = await arManager.isARSupported();
      if (supported) {
        this.updateFeatureStatus('ar', 'ready');
        return true;
      } else {
        this.updateFeatureStatus('ar', 'disabled', 'AR not supported on this device');
        return false;
      }
    } catch (error) {
      this.updateFeatureStatus('ar', 'error', error.message);
      return false;
    }
  }

  // Public API methods
  updateConfig(newConfig: Partial<IntegrationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Re-initialize features based on new config
    this.initializeIntegration();
  }

  getConfig(): IntegrationConfig {
    return { ...this.config };
  }

  getFeatureStatuses(): FeatureStatus[] {
    return Array.from(this.featureStatuses.values());
  }

  getFeatureStatus(featureName: string): FeatureStatus | undefined {
    return this.featureStatuses.get(featureName);
  }

  private updateFeatureStatus(featureName: string, status: FeatureStatus['status'], error?: string): void {
    const featureStatus = this.featureStatuses.get(featureName);
    if (featureStatus) {
      featureStatus.status = status;
      featureStatus.enabled = this.isFeatureEnabled(featureName);
      if (error) {
        featureStatus.error = error;
      }
    }
  }

  // Event system
  addEventListener(eventType: string, listener: (data: any) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  removeEventListener(eventType: string, listener: (data: any) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emitEvent(eventType: string, data: any): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }

  // Quick actions
  async speakStatus(): Promise<void> {
    if (!this.config.enableSpeechSynthesis) return;

    const statuses = this.getFeatureStatuses();
    const activeFeatures = statuses.filter(s => s.enabled && s.status === 'ready');

    const message = `System status: ${activeFeatures.length} features active out of ${statuses.length} total features.`;
    await speechSynthesisManager.speakCircuitFeedback(message, 'info');
  }

  async announceFeatureStatus(): Promise<void> {
    if (!this.config.enableScreenReader) return;

    const statuses = this.getFeatureStatuses();
    const issues = statuses.filter(s => s.status === 'error' || !s.available);

    if (issues.length > 0) {
      screenReaderManager.announceError(`${issues.length} features have issues. Check system status for details.`);
    } else {
      screenReaderManager.announceStatus('All enabled features are working correctly');
    }
  }

  // Cleanup
  destroy(): void {
    // Stop voice control
    if (this.config.enableVoiceControl) {
      voiceControlManager.deactivateVoiceControl();
    }

    // Clean up gesture recognition
    if (this.gestureRecognizer) {
      this.gestureRecognizer.destroy();
    }

    // Clear event listeners
    this.eventListeners.clear();

    // Reset feature statuses
    this.featureStatuses.clear();
  }
}

// Factory function
export function createFeatureIntegrationManager(config: IntegrationConfig): FeatureIntegrationManager {
  return new FeatureIntegrationManager(config);
}