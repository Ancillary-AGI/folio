export interface SpeechSynthesisConfig {
  voice: string | null;
  rate: number;
  pitch: number;
  volume: number;
  language: string;
}

export interface SpeechSynthesisUtterance {
  text: string;
  priority: 'low' | 'normal' | 'high';
  interrupt: boolean;
  config?: Partial<SpeechSynthesisConfig>;
}

export class SpeechSynthesisManager {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private utteranceQueue: SpeechSynthesisUtterance[] = [];
  private isSpeaking = false;
  private config: SpeechSynthesisConfig;
  private onStartCallbacks: (() => void)[] = [];
  private onEndCallbacks: (() => void)[] = [];
  private onErrorCallbacks: ((error: string) => void)[] = [];

  constructor(config: Partial<SpeechSynthesisConfig> = {}) {
    this.config = {
      voice: null,
      rate: 1.0,
      pitch: 1.0,
      volume: 0.8,
      language: 'en-US',
      ...config
    };

    this.initializeSpeechSynthesis();
  }

  private initializeSpeechSynthesis(): void {
    if ('speechSynthesis' in window) {
      this.synth = window.speechSynthesis;

      // Load voices
      this.loadVoices();

      // Reload voices when they become available
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
          this.loadVoices();
        };
      }
    } else {
      console.warn('Speech synthesis not supported');
    }
  }

  private loadVoices(): void {
    if (this.synth) {
      this.voices = this.synth.getVoices();
    }
  }

  speak(text: string, config?: Partial<SpeechSynthesisConfig>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.synth) {
        reject(new Error('Speech synthesis not supported'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);

      // Apply configuration
      const finalConfig = { ...this.config, ...config };
      utterance.rate = finalConfig.rate;
      utterance.pitch = finalConfig.pitch;
      utterance.volume = finalConfig.volume;
      utterance.lang = finalConfig.language;

      // Set voice
      if (finalConfig.voice) {
        const voice = this.voices.find(v => v.name === finalConfig.voice);
        if (voice) {
          utterance.voice = voice;
        }
      }

      // Event handlers
      utterance.onstart = () => {
        this.isSpeaking = true;
        this.onStartCallbacks.forEach(callback => callback());
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.processQueue();
        this.onEndCallbacks.forEach(callback => callback());
        resolve();
      };

      utterance.onerror = (event) => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        const error = `Speech synthesis error: ${event.error}`;
        this.onErrorCallbacks.forEach(callback => callback(error));
        this.processQueue();
        reject(new Error(error));
      };

      // Add to queue or speak immediately
      const speechUtterance: SpeechSynthesisUtterance = {
        text,
        priority: 'normal',
        interrupt: false,
        config: finalConfig
      };

      this.addToQueue(speechUtterance);
    });
  }

  speakWithPriority(utterance: SpeechSynthesisUtterance): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.synth) {
        reject(new Error('Speech synthesis not supported'));
        return;
      }

      const speechUtterance = new SpeechSynthesisUtterance(utterance.text);

      // Apply configuration
      const finalConfig = { ...this.config, ...utterance.config };
      speechUtterance.rate = finalConfig.rate;
      speechUtterance.pitch = finalConfig.pitch;
      speechUtterance.volume = finalConfig.volume;
      speechUtterance.lang = finalConfig.language;

      // Set voice
      if (finalConfig.voice) {
        const voice = this.voices.find(v => v.name === finalConfig.voice);
        if (voice) {
          speechUtterance.voice = voice;
        }
      }

      // Event handlers
      speechUtterance.onstart = () => {
        this.isSpeaking = true;
        this.onStartCallbacks.forEach(callback => callback());
      };

      speechUtterance.onend = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.processQueue();
        this.onEndCallbacks.forEach(callback => callback());
        resolve();
      };

      speechUtterance.onerror = (event) => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        const error = `Speech synthesis error: ${event.error}`;
        this.onErrorCallbacks.forEach(callback => callback(error));
        this.processQueue();
        reject(new Error(error));
      };

      // Handle priority and interruption
      if (utterance.interrupt && this.isSpeaking) {
        this.stop();
      }

      this.addToQueueWithPriority(utterance);
    });
  }

  private addToQueue(utterance: SpeechSynthesisUtterance): void {
    this.utteranceQueue.push(utterance);
    this.processQueue();
  }

  private addToQueueWithPriority(utterance: SpeechSynthesisUtterance): void {
    if (utterance.priority === 'high') {
      // Add to front of queue
      this.utteranceQueue.unshift(utterance);
    } else if (utterance.priority === 'low') {
      // Add to end of queue
      this.utteranceQueue.push(utterance);
    } else {
      // Normal priority - insert after any high priority items
      const highPriorityCount = this.utteranceQueue.filter(u => u.priority === 'high').length;
      this.utteranceQueue.splice(highPriorityCount, 0, utterance);
    }

    this.processQueue();
  }

  private processQueue(): void {
    if (this.isSpeaking || this.utteranceQueue.length === 0 || !this.synth) {
      return;
    }

    const nextUtterance = this.utteranceQueue.shift();
    if (nextUtterance) {
      this.currentUtterance = nextUtterance;
      this.synth.speak(this.createSpeechUtterance(nextUtterance));
    }
  }

  private createSpeechUtterance(utterance: SpeechSynthesisUtterance): globalThis.SpeechSynthesisUtterance {
    const speechUtterance = new SpeechSynthesisUtterance(utterance.text);

    // Apply configuration
    const finalConfig = { ...this.config, ...utterance.config };
    speechUtterance.rate = finalConfig.rate;
    speechUtterance.pitch = finalConfig.pitch;
    speechUtterance.volume = finalConfig.volume;
    speechUtterance.lang = finalConfig.language;

    // Set voice
    if (finalConfig.voice) {
      const voice = this.voices.find(v => v.name === finalConfig.voice);
      if (voice) {
        speechUtterance.voice = voice;
      }
    }

    return speechUtterance;
  }

  stop(): void {
    if (this.synth) {
      this.synth.cancel();
      this.isSpeaking = false;
      this.currentUtterance = null;
    }
  }

  pause(): void {
    if (this.synth && this.isSpeaking) {
      this.synth.pause();
    }
  }

  resume(): void {
    if (this.synth) {
      this.synth.resume();
    }
  }

  // Voice management
  getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  getVoicesByLanguage(language: string): SpeechSynthesisVoice[] {
    return this.voices.filter(voice => voice.lang.startsWith(language));
  }

  setVoice(voiceName: string): boolean {
    const voice = this.voices.find(v => v.name === voiceName);
    if (voice) {
      this.config.voice = voiceName;
      return true;
    }
    return false;
  }

  // Configuration
  updateConfig(config: Partial<SpeechSynthesisConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): SpeechSynthesisConfig {
    return { ...this.config };
  }

  // Status
  isSupported(): boolean {
    return 'speechSynthesis' in window;
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  getQueueLength(): number {
    return this.utteranceQueue.length;
  }

  getCurrentUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }

  // Event listeners
  onStart(callback: () => void): void {
    this.onStartCallbacks.push(callback);
  }

  onEnd(callback: () => void): void {
    this.onEndCallbacks.push(callback);
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  // Remove listeners
  removeStartListener(callback: () => void): void {
    const index = this.onStartCallbacks.indexOf(callback);
    if (index !== -1) {
      this.onStartCallbacks.splice(index, 1);
    }
  }

  removeEndListener(callback: () => void): void {
    const index = this.onEndCallbacks.indexOf(callback);
    if (index !== -1) {
      this.onEndCallbacks.splice(index, 1);
    }
  }

  removeErrorListener(callback: (error: string) => void): void {
    const index = this.onErrorCallbacks.indexOf(callback);
    if (index !== -1) {
      this.onErrorCallbacks.splice(index, 1);
    }
  }

  // Utility methods
  speakCircuitFeedback(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): Promise<void> {
    const config: Partial<SpeechSynthesisConfig> = {};

    switch (type) {
      case 'success':
        config.pitch = 1.2;
        config.rate = 1.1;
        break;
      case 'error':
        config.pitch = 0.8;
        config.rate = 0.9;
        break;
      case 'warning':
        config.pitch = 1.0;
        config.rate = 1.0;
        break;
      case 'info':
      default:
        config.pitch = 1.0;
        config.rate = 1.0;
        break;
    }

    return this.speak(message, config);
  }

  speakAchievement(achievementName: string, points: number): Promise<void> {
    const message = `Achievement unlocked: ${achievementName}. You earned ${points} points!`;
    return this.speak(message, { pitch: 1.3, rate: 1.2 });
  }

  speakSimulationResult(result: string): Promise<void> {
    const message = `Simulation ${result}`;
    return this.speak(message, { pitch: 1.1, rate: 1.0 });
  }
}

export const speechSynthesisManager = new SpeechSynthesisManager();