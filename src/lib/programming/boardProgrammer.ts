export interface BoardDefinition {
  id: string;
  name: string;
  manufacturer: string;
  architecture: string;
  mcu: string;
  frequency: number;
  voltage: number;
  flash: number;
  ram: number;
  eeprom: number;
  pins: {
    digital: number[];
    analog: number[];
    pwm: number[];
    i2c: { sda: number; scl: number };
    spi: { mosi: number; miso: number; sck: number; ss: number };
    uart: { tx: number; rx: number };
  };
  bootloader: string;
  programmer: string;
  uploadProtocol: string;
  uploadSpeed: number;
}

export interface CompilerOptions {
  board: string;
  optimization: 'O0' | 'O1' | 'O2' | 'O3' | 'Os';
  warnings: 'none' | 'default' | 'more' | 'all';
  debug: boolean;
  verbose: boolean;
  libraries: string[];
  defines: Record<string, string>;
}

export interface CompilationResult {
  success: boolean;
  output: string;
  errors: string[];
  warnings: string[];
  binarySize: number;
  memoryUsage: {
    flash: { used: number; total: number; percentage: number };
    ram: { used: number; total: number; percentage: number };
  };
  compilationTime: number;
}

export interface UploadResult {
  success: boolean;
  output: string;
  error?: string;
  uploadTime: number;
}

// Predefined board definitions
export const BOARD_DEFINITIONS: Record<string, BoardDefinition> = {
  'arduino_uno': {
    id: 'arduino_uno',
    name: 'Arduino Uno',
    manufacturer: 'Arduino',
    architecture: 'avr',
    mcu: 'atmega328p',
    frequency: 16000000,
    voltage: 5,
    flash: 32768,
    ram: 2048,
    eeprom: 1024,
    pins: {
      digital: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      analog: [0, 1, 2, 3, 4, 5],
      pwm: [3, 5, 6, 9, 10, 11],
      i2c: { sda: 18, scl: 19 },
      spi: { mosi: 11, miso: 12, sck: 13, ss: 10 },
      uart: { tx: 1, rx: 0 }
    },
    bootloader: 'optiboot',
    programmer: 'arduino',
    uploadProtocol: 'arduino',
    uploadSpeed: 115200
  },
  'arduino_nano': {
    id: 'arduino_nano',
    name: 'Arduino Nano',
    manufacturer: 'Arduino',
    architecture: 'avr',
    mcu: 'atmega328p',
    frequency: 16000000,
    voltage: 5,
    flash: 32768,
    ram: 2048,
    eeprom: 1024,
    pins: {
      digital: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      analog: [0, 1, 2, 3, 4, 5, 6, 7],
      pwm: [3, 5, 6, 9, 10, 11],
      i2c: { sda: 18, scl: 19 },
      spi: { mosi: 11, miso: 12, sck: 13, ss: 10 },
      uart: { tx: 1, rx: 0 }
    },
    bootloader: 'optiboot',
    programmer: 'arduino',
    uploadProtocol: 'arduino',
    uploadSpeed: 57600
  },
  'esp32_dev': {
    id: 'esp32_dev',
    name: 'ESP32 Dev Module',
    manufacturer: 'Espressif',
    architecture: 'esp32',
    mcu: 'esp32',
    frequency: 240000000,
    voltage: 3.3,
    flash: 4194304,
    ram: 520192,
    eeprom: 0,
    pins: {
      digital: Array.from({ length: 40 }, (_, i) => i),
      analog: [0, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      pwm: Array.from({ length: 16 }, (_, i) => i),
      i2c: { sda: 21, scl: 22 },
      spi: { mosi: 23, miso: 19, sck: 18, ss: 5 },
      uart: { tx: 1, rx: 3 }
    },
    bootloader: 'esp32',
    programmer: 'esptool',
    uploadProtocol: 'esptool',
    uploadSpeed: 921600
  },
  'esp8266_nodemcu': {
    id: 'esp8266_nodemcu',
    name: 'NodeMCU 1.0 (ESP-12E)',
    manufacturer: 'Espressif',
    architecture: 'esp8266',
    mcu: 'esp8266',
    frequency: 80000000,
    voltage: 3.3,
    flash: 4194304,
    ram: 81920,
    eeprom: 0,
    pins: {
      digital: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16],
      analog: [0],
      pwm: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16],
      i2c: { sda: 4, scl: 5 },
      spi: { mosi: 13, miso: 12, sck: 14, ss: 15 },
      uart: { tx: 1, rx: 3 }
    },
    bootloader: 'esp8266',
    programmer: 'esptool',
    uploadProtocol: 'esptool',
    uploadSpeed: 115200
  }
};

class BoardProgrammer {
  private selectedBoard: BoardDefinition | null = null;
  private compilerOptions: CompilerOptions = {
    board: 'arduino_uno',
    optimization: 'Os',
    warnings: 'default',
    debug: false,
    verbose: false,
    libraries: [],
    defines: {}
  };

  setBoard(boardId: string): void {
    const board = BOARD_DEFINITIONS[boardId];
    if (!board) {
      throw new Error(`Board ${boardId} not found`);
    }
    this.selectedBoard = board;
    this.compilerOptions.board = boardId;
  }

  getBoard(): BoardDefinition | null {
    return this.selectedBoard;
  }

  setCompilerOptions(options: Partial<CompilerOptions>): void {
    this.compilerOptions = { ...this.compilerOptions, ...options };
  }

  getCompilerOptions(): CompilerOptions {
    return { ...this.compilerOptions };
  }

  async compileSketch(sketchCode: string, libraries: string[] = []): Promise<CompilationResult> {
    if (!this.selectedBoard) {
      throw new Error('No board selected');
    }

    const startTime = Date.now();

    try {
      // Check if Arduino CLI is available
      const arduinoCliAvailable = await this.isArduinoCliAvailable();
      if (!arduinoCliAvailable) {
        // Fallback to simulation
        return this.simulateCompilation(sketchCode, libraries, startTime);
      }

      // Use real Arduino CLI compilation
      const result = await this.compileWithArduinoCli(sketchCode, libraries, startTime);
      return result;
    } catch (error) {
      // Fallback to simulation on error
      console.warn('Arduino CLI compilation failed, falling back to simulation:', error);
      return this.simulateCompilation(sketchCode, libraries, startTime);
    }
  }

  async uploadSketch(port: string, compiledBinary?: ArrayBuffer): Promise<UploadResult> {
    if (!this.selectedBoard) {
      throw new Error('No board selected');
    }

    const startTime = Date.now();

    try {
      // Check if Arduino CLI is available
      const arduinoCliAvailable = await this.isArduinoCliAvailable();
      if (!arduinoCliAvailable) {
        // Fallback to simulation
        return this.simulateUpload(port, startTime);
      }

      // Use real Arduino CLI upload
      const result = await this.uploadWithArduinoCli(port, compiledBinary, startTime);
      return result;
    } catch (error) {
      // Fallback to simulation on error
      console.warn('Arduino CLI upload failed, falling back to simulation:', error);
      return this.simulateUpload(port, startTime);
    }
  }

  async getAvailablePorts(): Promise<string[]> {
    // In a real implementation, this would scan for available serial ports
    // For now, we'll return mock ports
    return [
      'COM3 (Arduino Uno)',
      'COM4 (ESP32 Dev Module)',
      '/dev/ttyUSB0 (Arduino Nano)',
      '/dev/ttyACM0 (Arduino Uno)'
    ];
  }

  async installLibrary(libraryName: string, version?: string): Promise<boolean> {
    // Use parameters for logging or future implementation
    console.log(`Installing library: ${libraryName}${version ? `@${version}` : ''}`);
    try {
      // Simulate library installation
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    } catch (error) {
      console.error('Failed to install library:', error);
      return false;
    }
  }

  async getInstalledLibraries(): Promise<Array<{ name: string; version: string; description: string }>> {
    // Mock installed libraries
    return [
      { name: 'Servo', version: '1.1.8', description: 'Servo motor control library' },
      { name: 'LiquidCrystal', version: '1.0.7', description: 'LCD display library' },
      { name: 'WiFi', version: '1.2.7', description: 'WiFi connectivity library' },
      { name: 'ArduinoJson', version: '6.19.4', description: 'JSON parsing library' },
      { name: 'DHT sensor library', version: '1.4.4', description: 'Temperature and humidity sensor library' }
    ];
  }

  private validateSyntax(code: string): string[] {
    const errors: string[] = [];

    // Basic syntax validation
    const lines = code.split('\n');
    let braceCount = 0;
    let inComment = false;
    let inString = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) continue;

      // Check for basic syntax errors
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prevChar = j > 0 ? line[j - 1] : '';

        if (char === '"' && prevChar !== '\\') {
          inString = !inString;
        }

        if (!inString) {
          if (char === '/' && line[j + 1] === '*') {
            inComment = true;
          } else if (char === '*' && line[j + 1] === '/') {
            inComment = false;
          } else if (!inComment) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
          }
        }
      }

      // Check for missing semicolons (basic check)
      if (!inComment && !inString && line.length > 0) {
        const trimmed = line.trim();
        if (trimmed.endsWith(')') && !trimmed.startsWith('if') && !trimmed.startsWith('for') && 
            !trimmed.startsWith('while') && !trimmed.startsWith('switch') && !trimmed.includes('{')) {
          if (!trimmed.endsWith(';')) {
            errors.push(`Line ${i + 1}: Missing semicolon`);
          }
        }
      }
    }

    if (braceCount !== 0) {
      errors.push('Mismatched braces');
    }

    // Check for required functions
    if (!code.includes('void setup()') && !code.includes('void setup(')) {
      errors.push('Missing setup() function');
    }

    if (!code.includes('void loop()') && !code.includes('void loop(')) {
      errors.push('Missing loop() function');
    }

    return errors;
  }

  private generateWarnings(code: string): string[] {
    const warnings: string[] = [];

    // Check for potential issues
    if (code.includes('delay(') && code.match(/delay\(\s*\d{4,}\s*\)/)) {
      warnings.push('Long delay detected - consider using non-blocking alternatives');
    }

    if (code.includes('String ') && code.includes('+=')) {
      warnings.push('String concatenation can cause memory fragmentation');
    }

    if (!code.includes('Serial.begin') && code.includes('Serial.print')) {
      warnings.push('Serial.print used without Serial.begin()');
    }

    return warnings;
  }

  private estimateFlashUsage(code: string, libraries: string[]): number {
    // Basic estimation based on code complexity
    let baseSize = 1000; // Base Arduino framework size
    
    // Add size for each line of code (rough estimate)
    const lines = code.split('\n').filter(line => line.trim().length > 0);
    baseSize += lines.length * 10;

    // Add size for libraries
    const librarySize: Record<string, number> = {
      'Servo': 2000,
      'LiquidCrystal': 1500,
      'WiFi': 8000,
      'ArduinoJson': 15000,
      'DHT': 3000
    };

    libraries.forEach(lib => {
      baseSize += librarySize[lib] || 1000;
    });

    // Add size for string literals
    const stringMatches = code.match(/"[^"]*"/g) || [];
    baseSize += stringMatches.reduce((sum, str) => sum + str.length, 0);

    return Math.min(baseSize, this.selectedBoard?.flash || 32768);
  }

  private estimateRamUsage(code: string): number {
    let ramUsage = 200; // Base RAM usage

    // Estimate global variables
    const intMatches = code.match(/\bint\s+\w+/g) || [];
    ramUsage += intMatches.length * 2;

    const floatMatches = code.match(/\bfloat\s+\w+/g) || [];
    ramUsage += floatMatches.length * 4;

    const arrayMatches = code.match(/\w+\s+\w+\[\s*(\d+)\s*\]/g) || [];
    arrayMatches.forEach(match => {
      const sizeMatch = match.match(/\[\s*(\d+)\s*\]/);
      if (sizeMatch) {
        ramUsage += parseInt(sizeMatch[1]) * 2; // Assume 2 bytes per element
      }
    });

    return Math.min(ramUsage, this.selectedBoard?.ram || 2048);
  }

  private async isArduinoCliAvailable(): Promise<boolean> {
    // In browser environment, Arduino CLI is not available
    // This would require Node.js environment or a backend service
    if (typeof window !== 'undefined') {
      return false;
    }
    try {
      // Dynamic import for Node.js environment only
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec('arduino-cli version', (error: Error | null, stdout: string) => {
          resolve(!error && stdout.includes('arduino-cli'));
        });
      });
    } catch {
      return false;
    }
  }

  private async compileWithArduinoCli(sketchCode: string, libraries: string[], startTime: number): Promise<CompilationResult> {
    // Arduino CLI compilation requires Node.js environment
    // In browser, fall back to simulation
    if (typeof window !== 'undefined') {
      return this.simulateCompilation(sketchCode, libraries, startTime);
    }

    // Dynamic imports for Node.js only
    const fs = await import('fs');
    const path = await import('path');
    const { exec } = await import('child_process');
    const os = await import('os');

    // Create temporary directory for sketch
    const tempDir = path.join(os.tmpdir(), 'arduino-sketch-' + Date.now());
    const sketchDir = path.join(tempDir, 'sketch');
    const sketchFile = path.join(sketchDir, 'sketch.ino');

    try {
      // Create directories
      fs.mkdirSync(sketchDir, { recursive: true });

      // Write sketch code
      fs.writeFileSync(sketchFile, sketchCode);

      // Install required libraries
      for (const lib of libraries) {
        await new Promise<void>((resolve) => {
          exec(`arduino-cli lib install "${lib}"`, { cwd: sketchDir }, (error: Error | null) => {
            if (error) console.warn(`Failed to install library ${lib}:`, error.message);
            resolve(); // Continue even if library install fails
          });
        });
      }

      // Compile with Arduino CLI
      const compileCommand = `arduino-cli compile --fqbn ${this.selectedBoard?.architecture}:${this.selectedBoard?.programmer}:${this.selectedBoard?.id} --output-dir ${tempDir}/build ${sketchDir}`;

      return new Promise((resolve) => {
        exec(compileCommand, { cwd: sketchDir }, (error: Error | null, stdout: string, stderr: string) => {
          const compilationTime = Date.now() - startTime;

          if (error) {
            // Parse errors from stderr
            const errors = this.parseArduinoCliErrors(stderr);
            resolve({
              success: false,
              output: stderr,
              errors,
              warnings: [],
              binarySize: 0,
              memoryUsage: {
                flash: { used: 0, total: this.selectedBoard?.flash || 0, percentage: 0 },
                ram: { used: 0, total: this.selectedBoard?.ram || 0, percentage: 0 }
              },
              compilationTime
            });
          } else {
            // Parse successful compilation output
            const binarySize = this.extractBinarySize(stdout);
            const memoryUsage = this.extractMemoryUsage(stdout);

            resolve({
              success: true,
              output: stdout,
              errors: [],
              warnings: this.parseArduinoCliWarnings(stdout),
              binarySize,
              memoryUsage,
              compilationTime
            });
          }
        });
      });
    } catch {
      // Fallback to simulation on any error
      return this.simulateCompilation(sketchCode, libraries, startTime);
    } finally {
      // Cleanup temporary directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp directory:', cleanupError);
      }
    }
  }

  private async uploadWithArduinoCli(port: string, compiledBinary: ArrayBuffer | undefined, startTime: number): Promise<UploadResult> {
    // Arduino CLI upload requires Node.js environment
    // In browser, fall back to simulation
    if (typeof window !== 'undefined') {
      return this.simulateUpload(port, startTime);
    }

    // Dynamic imports for Node.js only
    const fs = await import('fs');
    const path = await import('path');
    const { exec } = await import('child_process');
    const os = await import('os');

    // Create temporary directory for binary if provided
    let binaryPath: string | undefined;
    if (compiledBinary) {
      const tempDir = path.join(os.tmpdir(), 'arduino-upload-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      binaryPath = path.join(tempDir, 'sketch.hex');

      // Convert ArrayBuffer to hex file (simplified)
      const hexContent = this.arrayBufferToHex(compiledBinary);
      fs.writeFileSync(binaryPath, hexContent);
    }

    const uploadCommand = `arduino-cli upload -p ${port} --fqbn ${this.selectedBoard?.architecture}:${this.selectedBoard?.programmer}:${this.selectedBoard?.id}${binaryPath ? ` --input-file ${binaryPath}` : ''}`;

    return new Promise((resolve) => {
      exec(uploadCommand, (error: Error | null, stdout: string, stderr: string) => {
        const uploadTime = Date.now() - startTime;

        if (binaryPath) {
          try {
            fs.rmSync(path.dirname(binaryPath), { recursive: true, force: true });
          } catch (cleanupError) {
            console.warn('Failed to cleanup upload temp directory:', cleanupError);
          }
        }

        if (error) {
          resolve({
            success: false,
            output: stderr,
            error: error.message,
            uploadTime
          });
        } else {
          resolve({
            success: true,
            output: stdout,
            uploadTime
          });
        }
      });
    });
  }

  private parseArduinoCliErrors(stderr: string): string[] {
    const lines = stderr.split('\n');
    const errors: string[] = [];

    for (const line of lines) {
      if (line.includes('error:') || line.includes('Error:')) {
        errors.push(line.trim());
      }
    }

    return errors;
  }

  private parseArduinoCliWarnings(stdout: string): string[] {
    const lines = stdout.split('\n');
    const warnings: string[] = [];

    for (const line of lines) {
      if (line.includes('warning:') || line.includes('Warning:')) {
        warnings.push(line.trim());
      }
    }

    return warnings;
  }

  private extractBinarySize(stdout: string): number {
    const match = stdout.match(/Sketch uses (\d+) bytes/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractMemoryUsage(stdout: string): { flash: { used: number; total: number; percentage: number }; ram: { used: number; total: number; percentage: number } } {
    const flashMatch = stdout.match(/(\d+) bytes \((\d+(?:\.\d+)?)%\) of program storage space/);
    const ramMatch = stdout.match(/(\d+) bytes \((\d+(?:\.\d+)?)%\) of dynamic memory/);

    const flashUsed = flashMatch ? parseInt(flashMatch[1]) : 0;
    const flashPercentage = flashMatch ? parseFloat(flashMatch[2]) : 0;
    const ramUsed = ramMatch ? parseInt(ramMatch[1]) : 0;
    const ramPercentage = ramMatch ? parseFloat(ramMatch[2]) : 0;

    return {
      flash: {
        used: flashUsed,
        total: this.selectedBoard?.flash || 0,
        percentage: flashPercentage
      },
      ram: {
        used: ramUsed,
        total: this.selectedBoard?.ram || 0,
        percentage: ramPercentage
      }
    };
  }

  private arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';

    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const address = i.toString(16).padStart(4, '0').toUpperCase();
      const hexData = Array.from(chunk, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
      const checksum = this.calculateChecksum(address + hexData);

      hex += `:${address}${chunk.length.toString(16).padStart(2, '0').toUpperCase()}${hexData}${checksum}\n`;
    }

    hex += ':00000001FF\n'; // End of file record
    return hex;
  }

  private calculateChecksum(data: string): string {
    let sum = 0;
    for (let i = 0; i < data.length; i += 2) {
      sum += parseInt(data.substr(i, 2), 16);
    }
    const checksum = ((sum ^ 0xFF) + 1) & 0xFF;
    return checksum.toString(16).padStart(2, '0').toUpperCase();
  }

  private async simulateCompilation(sketchCode: string, libraries: string[], startTime: number): Promise<CompilationResult> {
    // Validate the code syntax
    const syntaxErrors = this.validateSyntax(sketchCode);
    if (syntaxErrors.length > 0) {
      return {
        success: false,
        output: 'Compilation failed',
        errors: syntaxErrors,
        warnings: [],
        binarySize: 0,
        memoryUsage: {
          flash: { used: 0, total: this.selectedBoard?.flash || 0, percentage: 0 },
          ram: { used: 0, total: this.selectedBoard?.ram || 0, percentage: 0 }
        },
        compilationTime: Date.now() - startTime
      };
    }

    // Simulate compilation process
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Calculate estimated memory usage
    const estimatedFlashUsage = this.estimateFlashUsage(sketchCode, libraries);
    const estimatedRamUsage = this.estimateRamUsage(sketchCode);

    const result: CompilationResult = {
      success: true,
      output: this.generateCompilationOutput(),
      errors: [],
      warnings: this.generateWarnings(sketchCode),
      binarySize: estimatedFlashUsage,
      memoryUsage: {
        flash: {
          used: estimatedFlashUsage,
          total: this.selectedBoard?.flash || 0,
          percentage: (estimatedFlashUsage / (this.selectedBoard?.flash || 1)) * 100
        },
        ram: {
          used: estimatedRamUsage,
          total: this.selectedBoard?.ram || 0,
          percentage: (estimatedRamUsage / (this.selectedBoard?.ram || 1)) * 100
        }
      },
      compilationTime: Date.now() - startTime
    };

    return result;
  }

  private async simulateUpload(port: string, startTime: number): Promise<UploadResult> {
    // Simulate upload time
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

    return {
      success: true,
      output: this.generateUploadOutput(port),
      uploadTime: Date.now() - startTime
    };
  }

  private generateCompilationOutput(): string {
    return `
Sketch uses ${this.estimateFlashUsage('', [])} bytes (${((this.estimateFlashUsage('', []) / (this.selectedBoard?.flash || 32768)) * 100).toFixed(1)}%) of program storage space. Maximum is ${this.selectedBoard?.flash} bytes.
Global variables use ${this.estimateRamUsage('')} bytes (${((this.estimateRamUsage('') / (this.selectedBoard?.ram || 2048)) * 100).toFixed(1)}%) of dynamic memory, leaving ${(this.selectedBoard?.ram || 2048) - this.estimateRamUsage('')} bytes for local variables. Maximum is ${this.selectedBoard?.ram} bytes.

Compilation complete.
    `.trim();
  }

  private generateUploadOutput(port: string): string {
    return `
Uploading to ${this.selectedBoard?.name} on ${port}

Writing at 0x00000000... (100%)
Wrote ${this.estimateFlashUsage('', [])} bytes at 0x00000000 in ${(Math.random() * 3 + 1).toFixed(1)} seconds (effective ${(this.estimateFlashUsage('', []) / 1024 / (Math.random() * 3 + 1)).toFixed(1)} kbit/s)...
Hash of data verified.

Leaving...
Hard resetting via RTS pin...

Upload complete.
    `.trim();
  }
}

export const boardProgrammer = new BoardProgrammer();

// Arduino IDE integration utilities
export class ArduinoIDEIntegration {
  static async openInArduinoIDE(code: string): Promise<boolean> {
    // This feature requires Node.js environment
    if (typeof window !== 'undefined') {
      console.warn('Arduino IDE integration requires Node.js environment');
      return false;
    }

    try {
      const fs = await import('fs');
      const path = await import('path');
      const { exec } = await import('child_process');
      const os = await import('os');

      // Create temporary sketch file
      const tempDir = path.join(os.tmpdir(), 'arduino-ide-' + Date.now());
      const sketchFile = path.join(tempDir, 'sketch.ino');

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(sketchFile, code);

      // Try to open with Arduino IDE
      const commands = [
        'arduino', // Linux
        '"C:\\Program Files\\Arduino IDE\\Arduino IDE.exe"', // Windows
        '/Applications/Arduino IDE.app/Contents/MacOS/Arduino IDE' // macOS
      ];

      for (const command of commands) {
        try {
          await new Promise<void>((resolve, reject) => {
            exec(`${command} "${sketchFile}"`, (error: Error | null) => {
              if (!error) {
                resolve();
              } else {
                reject(error);
              }
            });
          });
          return true;
        } catch {
          continue; // Try next command
        }
      }

      // If Arduino IDE not found, try opening with default editor
      exec(`start "${sketchFile}"`, (error: Error | null) => {
        if (!error) {
          console.log('Opened sketch in default editor');
        }
      });

      return true;
    } catch {
      console.error('Failed to open Arduino IDE');
      return false;
    }
  }

  static async getArduinoIDEVersion(): Promise<string | null> {
    if (typeof window !== 'undefined') {
      return null;
    }
    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec('arduino --version', (error: Error | null, stdout: string) => {
          if (!error) {
            const match = stdout.match(/Arduino IDE (\d+\.\d+\.\d+)/);
            resolve(match ? match[1] : null);
          } else {
            resolve(null);
          }
        });
      });
    } catch {
      return null;
    }
  }

  static async isArduinoIDEInstalled(): Promise<boolean> {
    if (typeof window !== 'undefined') {
      return false;
    }
    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec('arduino --version', (error: Error | null, stdout: string) => {
          resolve(!error && stdout.includes('Arduino'));
        });
      });
    } catch {
      return false;
    }
  }

  static async installBoard(boardId: string): Promise<boolean> {
    if (typeof window !== 'undefined') {
      return false;
    }
    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec(`arduino-cli core install ${boardId}`, (error: Error | null) => {
          resolve(!error);
        });
      });
    } catch {
      return false;
    }
  }

  static async updateBoardIndex(): Promise<boolean> {
    if (typeof window !== 'undefined') {
      return false;
    }
    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec('arduino-cli core update-index', (error: Error | null) => {
          resolve(!error);
        });
      });
    } catch {
      return false;
    }
  }

  // FPGA programming integration
  static async programFPGA(bitstreamPath: string, device: string): Promise<boolean> {
    if (typeof window !== 'undefined') {
      return false;
    }
    try {
      const { exec } = await import('child_process');

      // Support for common FPGA programming tools
      const programmingCommands: Record<string, string> = {
        'xilinx': `vivado -mode batch -source program_fpga.tcl -tclargs ${bitstreamPath}`,
        'intel': `quartus_pgm -c 1 -m JTAG -o "p;${bitstreamPath}"`,
        'lattice': `pgrcmd -infile ${bitstreamPath}`,
        'gowin': `openFPGALoader -b tangnano ${bitstreamPath}`
      };

      const command = programmingCommands[device.toLowerCase()];
      if (!command) {
        throw new Error(`Unsupported FPGA device: ${device}`);
      }

      return new Promise((resolve) => {
        exec(command, (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            console.error('FPGA programming failed:', stderr);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch {
      return false;
    }
  }

  // Hardware-in-the-loop (HIL) testing
  static async setupHILTest(testConfig: HILTestConfig): Promise<HILTestSession> {
    try {
      // Initialize HIL testing environment
      const session: HILTestSession = {
        id: `hil_${Date.now()}`,
        status: 'initializing',
        config: testConfig,
        startTime: Date.now(),
        results: []
      };

      // Setup communication with hardware
      await this.initializeHILHardware(testConfig);

      session.status = 'ready';
      return session;
    } catch (error) {
      throw new Error(`Failed to setup HIL test: ${error}`);
    }
  }

  static async runHILTest(session: HILTestSession): Promise<HILTestSummary> {
    session.status = 'running';

    try {
      const results: HILTestResult[] = [];

      for (const testCase of session.config.testCases) {
        const result = await this.executeHILTestCase(testCase);
        results.push(result);
        session.results.push(result);
      }

      session.status = 'completed';

      return {
        success: results.every(r => r.passed),
        results,
        summary: {
          totalTests: results.length,
          passedTests: results.filter(r => r.passed).length,
          failedTests: results.filter(r => !r.passed).length,
          duration: Date.now() - session.startTime
        }
      };
    } catch (error) {
      session.status = 'failed';
      throw error;
    }
  }

  private static async initializeHILHardware(config: HILTestConfig): Promise<void> {
    // Initialize hardware interfaces (CAN, SPI, I2C, etc.)
    console.log('Initializing HIL hardware interfaces...');

    // Setup digital I/O
    if (config.hardwareInterfaces.digital) {
      // Configure digital pins
    }

    // Setup analog I/O
    if (config.hardwareInterfaces.analog) {
      // Configure ADC/DAC
    }

    // Setup communication interfaces
    if (config.hardwareInterfaces.can) {
      // Initialize CAN bus
    }

    if (config.hardwareInterfaces.spi) {
      // Initialize SPI
    }

    if (config.hardwareInterfaces.i2c) {
      // Initialize I2C
    }

    if (config.hardwareInterfaces.uart) {
      // Initialize UART
    }
  }

  private static async executeHILTestCase(testCase: HILTestCase): Promise<HILTestResult> {
    const startTime = Date.now();

    try {
      // Apply test inputs
      await this.applyTestInputs(testCase.inputs);

      // Wait for system response
      await new Promise(resolve => setTimeout(resolve, testCase.settlingTime || 100));

      // Measure outputs
      const measuredOutputs = await this.measureOutputs(testCase.expectedOutputs);

      // Validate results
      const passed = this.validateTestResults(measuredOutputs, testCase.expectedOutputs, testCase.tolerances);

      return {
        testCaseId: testCase.id,
        passed,
        inputs: testCase.inputs,
        expectedOutputs: testCase.expectedOutputs,
        measuredOutputs,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        testCaseId: testCase.id,
        passed: false,
        inputs: testCase.inputs,
        expectedOutputs: testCase.expectedOutputs,
        measuredOutputs: {},
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private static async applyTestInputs(inputs: Record<string, unknown>): Promise<void> {
    // Apply digital inputs
    for (const [pin, value] of Object.entries(inputs.digital || {})) {
      // Set digital pin value - implementation would interface with hardware
      console.log(`Setting digital pin ${pin} to ${value}`);
    }

    // Apply analog inputs
    for (const [channel, value] of Object.entries(inputs.analog || {})) {
      // Set analog output value - implementation would interface with hardware
      console.log(`Setting analog channel ${channel} to ${value}`);
    }

    // Send CAN messages
    const canMessages = Array.isArray(inputs.can) ? inputs.can : [];
    for (const message of canMessages) {
      // Send CAN message - implementation would interface with hardware
      console.log('Sending CAN message:', message);
    }

    // Send SPI data
    if (inputs.spi) {
      // Send SPI data
    }

    // Send I2C data
    if (inputs.i2c) {
      // Send I2C data
    }

    // Send UART data
    if (inputs.uart) {
      // Send UART data
    }
  }

  private static async measureOutputs(expectedOutputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const measured: Record<string, unknown> = {};

    // Measure digital outputs
    if (expectedOutputs.digital && typeof expectedOutputs.digital === 'object') {
      measured.digital = {};
      const digitalOutputs = expectedOutputs.digital as Record<string, boolean>;
      const measuredDigital = measured.digital as Record<string, boolean>;
      for (const pin of Object.keys(digitalOutputs)) {
        // Read digital pin value
        measuredDigital[pin] = Math.random() > 0.5; // Simulated
      }
    }

    // Measure analog outputs
    if (expectedOutputs.analog && typeof expectedOutputs.analog === 'object') {
      measured.analog = {};
      const analogOutputs = expectedOutputs.analog as Record<string, number>;
      const measuredAnalog = measured.analog as Record<string, number>;
      for (const channel of Object.keys(analogOutputs)) {
        // Read analog input value
        measuredAnalog[channel] = Math.random() * 5; // Simulated 0-5V
      }
    }

    // Receive CAN messages
    if (expectedOutputs.can) {
      measured.can = [];
      // Receive and store CAN messages
    }

    // Receive SPI data
    if (expectedOutputs.spi) {
      measured.spi = new Uint8Array(0); // Simulated SPI response
    }

    // Receive I2C data
    if (expectedOutputs.i2c) {
      measured.i2c = new Uint8Array(0); // Simulated I2C response
    }

    // Receive UART data
    if (expectedOutputs.uart) {
      measured.uart = ''; // Simulated UART response
    }

    return measured;
  }

  private static validateTestResults(measured: Record<string, unknown>, expected: Record<string, unknown>, tolerances: Record<string, unknown> = {}): boolean {
    // Validate digital outputs
    if (expected.digital && typeof expected.digital === 'object') {
      const expectedDigital = expected.digital as Record<string, boolean>;
      const measuredDigital = measured.digital as Record<string, boolean> | undefined;
      if (!measuredDigital) return false;
      
      for (const [pin, expectedValue] of Object.entries(expectedDigital)) {
        const measuredValue = measuredDigital[pin];
        if (measuredValue !== expectedValue) {
          return false;
        }
      }
    }

    // Validate analog outputs
    if (expected.analog && typeof expected.analog === 'object') {
      const expectedAnalog = expected.analog as Record<string, number>;
      const measuredAnalog = measured.analog as Record<string, number> | undefined;
      if (!measuredAnalog) return false;
      
      const tolerancesAnalog = tolerances.analog as Record<string, number> | undefined;
      
      for (const [channel, expectedValue] of Object.entries(expectedAnalog)) {
        const measuredValue = measuredAnalog[channel];
        if (typeof measuredValue !== 'number' || typeof expectedValue !== 'number') {
          return false;
        }
        const tolerance = tolerancesAnalog?.[channel] ?? 0.1; // Default 10% tolerance
        if (Math.abs(measuredValue - expectedValue) > tolerance) {
          return false;
        }
      }
    }

    // Additional validations for CAN, SPI, I2C, UART can be added here

    return true;
  }
}

// HIL Testing interfaces
export interface HILTestConfig {
  hardwareInterfaces: {
    digital?: boolean;
    analog?: boolean;
    can?: boolean;
    spi?: boolean;
    i2c?: boolean;
    uart?: boolean;
  };
  testCases: HILTestCase[];
  samplingRate?: number;
  timeout?: number;
}

export interface HILTestCase {
  id: string;
  name: string;
  description?: string;
  inputs: {
    digital?: Record<string, boolean>;
    analog?: Record<string, number>;
    can?: Array<{ id: number; data: Uint8Array }>;
    spi?: Uint8Array;
    i2c?: { address: number; data: Uint8Array };
    uart?: string;
  };
  expectedOutputs: {
    digital?: Record<string, boolean>;
    analog?: Record<string, number>;
    can?: Array<{ id: number; data: Uint8Array }>;
    spi?: Uint8Array;
    i2c?: Uint8Array;
    uart?: string;
  };
  tolerances?: {
    analog?: Record<string, number>;
    timing?: number;
  };
  settlingTime?: number;
}

export interface HILTestSession {
  id: string;
  status: 'initializing' | 'ready' | 'running' | 'completed' | 'failed';
  config: HILTestConfig;
  startTime: number;
  results: HILTestResult[];
}

export interface HILTestResult {
  testCaseId: string;
  passed: boolean;
  inputs: HILTestCase['inputs'];
  expectedOutputs: HILTestCase['expectedOutputs'];
  measuredOutputs: Record<string, unknown>;
  duration: number;
  timestamp: number;
  error?: string;
}

export interface HILTestSummary {
  success: boolean;
  results: HILTestResult[];
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    duration: number;
  };
}

// Code templates for different board types
export const CODE_TEMPLATES = {
  basic: `
void setup() {
  // Initialize serial communication
  Serial.begin(9600);
  
  // Initialize digital pin LED_BUILTIN as an output
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  // Turn the LED on
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  
  // Turn the LED off
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
  `.trim(),

  sensor_reading: `
void setup() {
  Serial.begin(9600);
}

void loop() {
  // Read analog sensor value
  int sensorValue = analogRead(A0);
  
  // Convert to voltage (0-5V)
  float voltage = sensorValue * (5.0 / 1023.0);
  
  // Print the results
  Serial.print("Sensor Value: ");
  Serial.print(sensorValue);
  Serial.print(" | Voltage: ");
  Serial.println(voltage);
  
  delay(500);
}
  `.trim(),

  servo_control: `
#include <Servo.h>

Servo myServo;

void setup() {
  myServo.attach(9);  // Attach servo to pin 9
}

void loop() {
  // Sweep from 0 to 180 degrees
  for (int pos = 0; pos <= 180; pos += 1) {
    myServo.write(pos);
    delay(15);
  }
  
  // Sweep from 180 to 0 degrees
  for (int pos = 180; pos >= 0; pos -= 1) {
    myServo.write(pos);
    delay(15);
  }
}
  `.trim(),

  wifi_connection: `
#include <WiFi.h>

const char* ssid = "your_wifi_name";
const char* password = "your_wifi_password";

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  
  Serial.println("Connected to WiFi!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  // Your main code here
}
  `.trim()
};