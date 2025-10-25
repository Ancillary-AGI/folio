import { speechRecognitionManager, SpeechRecognitionResult, VoiceCommand } from '../speech/speechRecognition';
import { speechSynthesisManager } from '../speech/speechSynthesis';
import { screenReaderManager } from '../accessibility/screenReader';

export interface VoiceControlContext {
  currentView: 'schematic' | '3d' | 'simulation' | 'properties' | 'toolbox';
  selectedComponent?: string;
  lastAction?: string;
  circuitState: {
    componentCount: number;
    connectionCount: number;
    isSimulating: boolean;
  };
}

export interface VoiceAction {
  name: string;
  description: string;
  execute: (parameters?: Record<string, unknown>) => Promise<void>;
  requiresConfirmation: boolean;
  category: 'navigation' | 'design' | 'simulation' | 'file' | 'view';
}

export class VoiceControlManager {
  private context: VoiceControlContext;
  private actions: Map<string, VoiceAction> = new Map();
  private isActive = false;
  private commandHistory: VoiceCommand[] = [];
  private wakeWord = 'circuit';
  private confidenceThreshold = 0.7;

  constructor() {
    this.context = {
      currentView: 'schematic',
      circuitState: {
        componentCount: 0,
        connectionCount: 0,
        isSimulating: false
      }
    };

    this.initializeActions();
    this.setupEventListeners();
  }

  private initializeActions(): void {
    // Navigation actions
    this.addAction({
      name: 'switch_to_schematic',
      description: 'Switch to schematic view',
      execute: async () => {
        this.context.currentView = 'schematic';
        await speechSynthesisManager.speakCircuitFeedback('Switched to schematic view', 'info');
        screenReaderManager.announceNavigation('Schematic view activated');
      },
      requiresConfirmation: false,
      category: 'navigation'
    });

    this.addAction({
      name: 'switch_to_3d',
      description: 'Switch to 3D view',
      execute: async () => {
        this.context.currentView = '3d';
        await speechSynthesisManager.speakCircuitFeedback('Switched to 3D view', 'info');
        screenReaderManager.announceNavigation('3D view activated');
      },
      requiresConfirmation: false,
      category: 'navigation'
    });

    this.addAction({
      name: 'switch_to_simulation',
      description: 'Switch to simulation view',
      execute: async () => {
        this.context.currentView = 'simulation';
        await speechSynthesisManager.speakCircuitFeedback('Switched to simulation view', 'info');
        screenReaderManager.announceNavigation('Simulation view activated');
      },
      requiresConfirmation: false,
      category: 'navigation'
    });

    // Design actions
    this.addAction({
      name: 'add_resistor',
      description: 'Add a resistor component',
      execute: async (params) => {
        const position = params?.position || 'default position';
        await speechSynthesisManager.speakCircuitFeedback(`Added resistor at ${position}`, 'success');
        screenReaderManager.announceComponentAdded('resistor', position as string);
        this.context.circuitState.componentCount++;
      },
      requiresConfirmation: false,
      category: 'design'
    });

    this.addAction({
      name: 'add_capacitor',
      description: 'Add a capacitor component',
      execute: async (params) => {
        const position = params?.position || 'default position';
        await speechSynthesisManager.speakCircuitFeedback(`Added capacitor at ${position}`, 'success');
        screenReaderManager.announceComponentAdded('capacitor', position as string);
        this.context.circuitState.componentCount++;
      },
      requiresConfirmation: false,
      category: 'design'
    });

    this.addAction({
      name: 'add_transistor',
      description: 'Add a transistor component',
      execute: async (params) => {
        const position = params?.position || 'default position';
        await speechSynthesisManager.speakCircuitFeedback(`Added transistor at ${position}`, 'success');
        screenReaderManager.announceComponentAdded('transistor', position as string);
        this.context.circuitState.componentCount++;
      },
      requiresConfirmation: false,
      category: 'design'
    });

    this.addAction({
      name: 'connect_components',
      description: 'Connect two components',
      execute: async (params) => {
        const from = params?.from || 'component A';
        const to = params?.to || 'component B';
        await speechSynthesisManager.speakCircuitFeedback(`Connected ${from} to ${to}`, 'success');
        screenReaderManager.announceConnectionMade(from as string, to as string);
        this.context.circuitState.connectionCount++;
      },
      requiresConfirmation: false,
      category: 'design'
    });

    this.addAction({
      name: 'delete_component',
      description: 'Delete selected component',
      execute: async (params) => {
        const component = params?.component || this.context.selectedComponent || 'selected component';
        await speechSynthesisManager.speakCircuitFeedback(`Deleted ${component}`, 'info');
        screenReaderManager.announceComponentRemoved(component as string);
        this.context.circuitState.componentCount = Math.max(0, this.context.circuitState.componentCount - 1);
      },
      requiresConfirmation: true,
      category: 'design'
    });

    // Simulation actions
    this.addAction({
      name: 'start_simulation',
      description: 'Start circuit simulation',
      execute: async () => {
        if (this.context.circuitState.isSimulating) {
          await speechSynthesisManager.speakCircuitFeedback('Simulation already running', 'info');
          return;
        }
        this.context.circuitState.isSimulating = true;
        await speechSynthesisManager.speakCircuitFeedback('Starting simulation', 'info');
        screenReaderManager.announceSimulationStarted();
      },
      requiresConfirmation: false,
      category: 'simulation'
    });

    this.addAction({
      name: 'stop_simulation',
      description: 'Stop circuit simulation',
      execute: async () => {
        if (!this.context.circuitState.isSimulating) {
          await speechSynthesisManager.speakCircuitFeedback('No simulation running', 'info');
          return;
        }
        this.context.circuitState.isSimulating = false;
        await speechSynthesisManager.speakCircuitFeedback('Simulation stopped', 'info');
        screenReaderManager.announceSimulationCompleted('stopped by user');
      },
      requiresConfirmation: false,
      category: 'simulation'
    });

    // File actions
    this.addAction({
      name: 'save_project',
      description: 'Save current project',
      execute: async () => {
        await speechSynthesisManager.speakCircuitFeedback('Project saved successfully', 'success');
        screenReaderManager.announceAction('Project saved');
      },
      requiresConfirmation: false,
      category: 'file'
    });

    this.addAction({
      name: 'new_project',
      description: 'Create new project',
      execute: async () => {
        await speechSynthesisManager.speakCircuitFeedback('New project created', 'success');
        screenReaderManager.announceAction('New project created');
        this.resetContext();
      },
      requiresConfirmation: true,
      category: 'file'
    });

    // View actions
    this.addAction({
      name: 'zoom_in',
      description: 'Zoom in on circuit',
      execute: async () => {
        await speechSynthesisManager.speakCircuitFeedback('Zoomed in', 'info');
        screenReaderManager.announceAction('Zoom level increased');
      },
      requiresConfirmation: false,
      category: 'view'
    });

    this.addAction({
      name: 'zoom_out',
      description: 'Zoom out on circuit',
      execute: async () => {
        await speechSynthesisManager.speakCircuitFeedback('Zoomed out', 'info');
        screenReaderManager.announceAction('Zoom level decreased');
      },
      requiresConfirmation: false,
      category: 'view'
    });

    this.addAction({
      name: 'show_properties',
      description: 'Show properties panel',
      execute: async () => {
        this.context.currentView = 'properties';
        await speechSynthesisManager.speakCircuitFeedback('Properties panel opened', 'info');
        screenReaderManager.announceNavigation('Properties panel opened');
      },
      requiresConfirmation: false,
      category: 'view'
    });
  }

  private setupEventListeners(): void {
    speechRecognitionManager.onResult((result) => {
      this.handleSpeechResult(result);
    });

    speechRecognitionManager.onCommand((command) => {
      this.handleVoiceCommand(command);
    });

    speechRecognitionManager.onError((error) => {
      console.error('Voice control error:', error);
      speechSynthesisManager.speakCircuitFeedback(`Voice recognition error: ${error}`, 'error');
    });
  }

  private handleSpeechResult(result: SpeechRecognitionResult): void {
    // Check for wake word
    if (result.transcript.toLowerCase().includes(this.wakeWord) && !this.isActive) {
      this.activateVoiceControl();
    }
  }

  private async handleVoiceCommand(command: VoiceCommand): Promise<void> {
    if (!this.isActive) return;

    // Store command in history
    this.commandHistory.push(command);
    if (this.commandHistory.length > 50) {
      this.commandHistory.shift();
    }

    // Find and execute action
    const action = this.actions.get(command.action);
    if (action) {
      if (action.requiresConfirmation) {
        // Ask for confirmation
        await speechSynthesisManager.speakCircuitFeedback(
          `Are you sure you want to ${action.description.toLowerCase()}? Say "yes" to confirm or "no" to cancel.`,
          'info'
        );

        // Wait for confirmation (simplified - in real implementation would need more sophisticated handling)
        setTimeout(async () => {
          await action.execute(command.parameters);
          this.context.lastAction = action.name;
        }, 3000);
      } else {
        await action.execute(command.parameters);
        this.context.lastAction = action.name;
      }
    } else {
      await speechSynthesisManager.speakCircuitFeedback(`Unknown command: ${command.action}`, 'error');
    }
  }

  private async activateVoiceControl(): Promise<void> {
    this.isActive = true;
    await speechSynthesisManager.speakCircuitFeedback('Voice control activated. What would you like to do?', 'info');
    screenReaderManager.announceStatus('Voice control activated');

    // Start listening if not already
    if (!speechRecognitionManager.getIsListening()) {
      await speechRecognitionManager.startListening();
    }
  }

  public async deactivateVoiceControl(): Promise<void> {
    this.isActive = false;
    await speechSynthesisManager.speakCircuitFeedback('Voice control deactivated', 'info');
    screenReaderManager.announceStatus('Voice control deactivated');
    speechRecognitionManager.stopListening();
  }

  public addAction(action: VoiceAction): void {
    this.actions.set(action.name, action);
  }

  public removeAction(actionName: string): void {
    this.actions.delete(actionName);
  }

  public getAvailableActions(): VoiceAction[] {
    return Array.from(this.actions.values());
  }

  public getActionsByCategory(category: string): VoiceAction[] {
    return Array.from(this.actions.values()).filter(action => action.category === category);
  }

  public updateContext(updates: Partial<VoiceControlContext>): void {
    this.context = { ...this.context, ...updates };
  }

  public getContext(): VoiceControlContext {
    return { ...this.context };
  }

  public getCommandHistory(): VoiceCommand[] {
    return [...this.commandHistory];
  }

  public clearCommandHistory(): void {
    this.commandHistory = [];
  }

  public setWakeWord(word: string): void {
    this.wakeWord = word.toLowerCase();
  }

  public setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
  }

  public isVoiceControlActive(): boolean {
    return this.isActive;
  }

  private resetContext(): void {
    this.context = {
      currentView: 'schematic',
      circuitState: {
        componentCount: 0,
        connectionCount: 0,
        isSimulating: false
      }
    };
  }

  // Context-aware suggestions
  public getSuggestedCommands(): string[] {
    const suggestions: string[] = [];

    // View-based suggestions
    switch (this.context.currentView) {
      case 'schematic':
        suggestions.push('add resistor', 'add capacitor', 'connect components', 'start simulation');
        break;
      case '3d':
        suggestions.push('zoom in', 'zoom out', 'rotate view', 'switch to schematic');
        break;
      case 'simulation':
        suggestions.push('stop simulation', 'show results', 'switch to schematic');
        break;
    }

    // State-based suggestions
    if (this.context.circuitState.isSimulating) {
      suggestions.push('stop simulation');
    } else {
      suggestions.push('start simulation');
    }

    if (this.context.circuitState.componentCount === 0) {
      suggestions.push('add resistor', 'add capacitor', 'add transistor');
    }

    return suggestions;
  }

  public async speakSuggestions(): Promise<void> {
    const suggestions = this.getSuggestedCommands();
    if (suggestions.length > 0) {
      const suggestionText = `You can say: ${suggestions.slice(0, 3).join(', ')}`;
      await speechSynthesisManager.speakCircuitFeedback(suggestionText, 'info');
    }
  }

  // Help system
  public async speakHelp(): Promise<void> {
    const actions = this.getAvailableActions();
    const categories = [...new Set(actions.map(a => a.category))];

    let helpText = 'Available voice commands: ';
    categories.forEach(category => {
      const categoryActions = actions.filter(a => a.category === category);
      helpText += `${category}: ${categoryActions.map(a => a.name.replace(/_/g, ' ')).join(', ')}. `;
    });

    await speechSynthesisManager.speakCircuitFeedback(helpText, 'info');
  }
}

export const voiceControlManager = new VoiceControlManager();