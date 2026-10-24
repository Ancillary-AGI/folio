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

/**
 * True when Node facilities (`child_process`, `fs`, `os`, `process.*`) may be
 * touched — imported from the Node bridge so the browser bundle never
 * resolves a builtin. *Every* Node-only entry point checks it itself
 * instead of trusting that its caller already did.
 */
import { isNodeRuntime, nodeExec, nodeExecFile, nodeFs, nodeOs, nodePath, nodeSpawnDetached } from './nodeBridge'

class BoardProgrammer {
  private selectedBoard: BoardDefinition | null = null;
  /**
   * Browser upload transport, registered by the UI after the user grants a
   * WebSerial port. When set, `uploadSketch` runs the real STK500v1 session
   * in the browser instead of refusing — this is what makes Giant 3 real.
   */
  private browserTransport: {
    write: (data: Uint8Array) => Promise<void>
    onData: (callback: (data: Uint8Array) => void) => void
  } | null = null;

  /** Register the browser-side serial transport (WebSerial bridge). */
  setBrowserTransport(transport: {
    write: (data: Uint8Array) => Promise<void>
    onData: (callback: (data: Uint8Array) => void) => void
  } | null): void {
    this.browserTransport = transport;
  }
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

    // Browser builds have no vendor toolchain: run the deterministic static
    // analysis and report the honest caveat instead of fake success output.
    if (!isNodeRuntime()) {
      return this.analyseSketch(sketchCode, libraries, startTime);
    }

    try {
      // Check if Arduino CLI is available
      const arduinoCliAvailable = await this.isArduinoCliAvailable();
      if (!arduinoCliAvailable) {
        return this.analyseSketch(sketchCode, libraries, startTime);
      }

      // Use real Arduino CLI compilation
      const result = await this.compileWithArduinoCli(sketchCode, libraries, startTime);
      return result;
    } catch (error) {
      // Fall back to the honest local analysis on error — never fake success.
      console.warn('Arduino CLI compilation failed, falling back to analysis:', error);
      return this.analyseSketch(sketchCode, libraries, startTime);
    }
  }

  async uploadSketch(port: string, compiledBinary?: ArrayBuffer): Promise<UploadResult> {
    if (!this.selectedBoard) {
      throw new Error('No board selected');
    }

    const startTime = Date.now();

    // Browser builds: with a registered WebSerial transport, run the real
    // STK500v1 session (Giant 3) — without one, keep refusing honestly.
    if (!isNodeRuntime()) {
      if (this.browserTransport && this.selectedBoard) {
        const { uploadHexImage } = await import('./uploadSession');
        const { bytesToIntelHex, textToBytes } = await import('../compilation/intelHex');
        const image = compiledBinary
          ? bytesToIntelHex(new Uint8Array(compiledBinary), { baseAddress: 0 })
          : bytesToIntelHex(textToBytes('// empty sketch'), { baseAddress: 0 });
        const session = await uploadHexImage(this.browserTransport, image, {
          flashSize: this.selectedBoard.flash,
        });
        return {
          success: session.success,
          output: session.message,
          error: session.success ? undefined : session.message,
          uploadTime: Date.now() - startTime,
        };
      }
      return {
        success: false,
        output: `Upload of ${this.selectedBoard.name} on ${port} is unavailable in the browser. Use arduino-cli or the Arduino IDE with a connected board.`,
        error: 'No upload transport in the browser',
        uploadTime: Date.now() - startTime
      };
    }

    try {
      // Check if Arduino CLI is available
      const arduinoCliAvailable = await this.isArduinoCliAvailable();
      if (!arduinoCliAvailable) {
        return {
          success: false,
          output: 'arduino-cli is not installed, so the sketch cannot be uploaded.',
          error: 'arduino-cli not found',
          uploadTime: Date.now() - startTime
        };
      }

      // Use real Arduino CLI upload
      const result = await this.uploadWithArduinoCli(port, compiledBinary, startTime);
      return result;
    } catch (error) {
      console.warn('Arduino CLI upload failed:', error);
      return {
        success: false,
        output: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error.message : 'Unknown error',
        uploadTime: Date.now() - startTime
      };
    }
  }

  async getAvailablePorts(): Promise<string[]> {
    // Browser builds cannot enumerate serial ports; surfacing fake COM ports
    // caused users to attempt uploads that could never succeed.
    if (!isNodeRuntime()) {
      return [];
    }
    try {
      const stdout = await nodeExec('arduino-cli board list')
      if (stdout === null) return []
      const ports = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('Port'));
      return ports;
    } catch {
      return [];
    }
  }

  async installLibrary(libraryName: string, version?: string): Promise<boolean> {
    void libraryName;
    void version;
    // No package registry client is bundled: report honestly instead of
    // sleeping two seconds and claiming success.
    return false;
  }

  async getInstalledLibraries(): Promise<Array<{ name: string; version: string; description: string }>> {
    // No library index is bundled; the toolchain panel renders the empty
    // state instead of a fabricated catalog.
    return [];
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
    if (!isNodeRuntime()) {
      return false;
    }
    try {
      const stdout = await nodeExec('arduino-cli version')
      return stdout !== null && stdout.includes('arduino-cli')
    } catch {
      return false;
    }
  }

  private async compileWithArduinoCli(sketchCode: string, libraries: string[], startTime: number): Promise<CompilationResult> {
    // Arduino CLI compilation requires Node.js environment
    // In browser, fall back to simulation
    if (!isNodeRuntime()) {
      return this.simulateCompilation(sketchCode, libraries, startTime);
    }

    // Node bridge modules (null-guarded: a missed runtime check fails typed).
    const fs = await nodeFs();
    const path = await nodePath();
    const os = await nodeOs();
    if (!fs || !path || !os) throw new Error('Node runtime unavailable for compilation.');

    // Create temporary directory for sketch
    const tempDir = path.join(os.tmpdir(), 'arduino-sketch-' + Date.now());
    const sketchDir = path.join(tempDir, 'sketch');
    const sketchFile = path.join(sketchDir, 'sketch.ino');

    // Held in one place because the compile and the upload both need the
    // identical `vendor:architecture:board` string.
    const fqbn = `${this.selectedBoard?.architecture}:${this.selectedBoard?.programmer}:${this.selectedBoard?.id}`;

    try {
      // Create directories
      fs.mkdirSync(sketchDir, { recursive: true });

      // Write sketch code
      fs.writeFileSync(sketchFile, sketchCode);

      // Install required libraries. A library name is user input, so it is
      // passed as an argument instead of interpolated into a command line.
      for (const lib of libraries) {
        const installed = await nodeExecFile('arduino-cli', ['lib', 'install', lib], sketchDir)
        if (installed?.error) console.warn(`Failed to install library ${lib}:`, installed.error.message);
      }

      // Compile with Arduino CLI. The build directory is joined rather than
      // concatenated with a forward slash, so it is right on Windows too, and
      // the sketch path never reaches a shell.
      const outputDir = path.join(tempDir, 'build');

      const compiled = await nodeExecFile('arduino-cli', ['compile', '--fqbn', fqbn, '--output-dir', outputDir, sketchDir], sketchDir)
      const compilationTime = Date.now() - startTime
      if (!compiled) {
        return {
          success: false,
          output: 'arduino-cli could not be launched.',
          errors: ['arduino-cli could not be launched.'],
          warnings: [],
          binarySize: 0,
          memoryUsage: {
            flash: { used: 0, total: this.selectedBoard?.flash || 0, percentage: 0 },
            ram: { used: 0, total: this.selectedBoard?.ram || 0, percentage: 0 }
          },
          compilationTime
        };
      }
      {
        const { error, stdout, stderr } = compiled
        if (error) {
            // Parse errors from stderr
            const errors = this.parseArduinoCliErrors(stderr);
            return {
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
            };
          } else {
            // Parse successful compilation output
            const binarySize = this.extractBinarySize(stdout);
            const memoryUsage = this.extractMemoryUsage(stdout);

            return {
              success: true,
              output: stdout,
              errors: [],
              warnings: this.parseArduinoCliWarnings(stdout),
              binarySize,
              memoryUsage,
              compilationTime
            };
          }
        }
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
    if (!isNodeRuntime()) {
      return this.simulateUpload(port, startTime);
    }

    // Node bridge modules (null-guarded: a missed runtime check fails typed).
    const fs = await nodeFs();
    const path = await nodePath();
    const os = await nodeOs();
    if (!fs || !path || !os) {
      return {
        success: false,
        output: 'Node runtime unavailable for upload.',
        error: 'Node runtime unavailable for upload.',
        uploadTime: Date.now() - startTime
      };
    }

    // Create temporary directory for binary if provided
    let binaryPath: string | undefined;
    if (compiledBinary) {
      const tempDir = path.join(os.tmpdir(), 'arduino-upload-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      binaryPath = path.join(tempDir, 'sketch.hex');

      // Intel HEX with extended-address records; a bare 16-bit address
      // silently wraps for images larger than 64 KiB.
      const { bytesToIntelHex } = await import('../compilation/intelHex');
      const hexContent = bytesToIntelHex(new Uint8Array(compiledBinary), { baseAddress: 0 });
      fs.writeFileSync(binaryPath, hexContent);
    }

    // Argument array: the serial port, the board and the temp file path all
    // come from outside, and a shell would reinterpret the last two.
    const fqbn = `${this.selectedBoard?.architecture}:${this.selectedBoard?.programmer}:${this.selectedBoard?.id}`;
    const uploadArgs = ['upload', '-p', port, '--fqbn', fqbn];
    if (binaryPath) uploadArgs.push('--input-file', binaryPath);

    const uploaded = await nodeExecFile('arduino-cli', uploadArgs)
    const uploadTime = Date.now() - startTime;

    if (binaryPath) {
      try {
        fs.rmSync(path.dirname(binaryPath), { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup upload temp directory:', cleanupError);
      }
    }

    if (!uploaded || uploaded.error) {
      return {
        success: false,
        output: uploaded?.stderr ?? 'arduino-cli could not be launched.',
        error: uploaded?.error?.message ?? 'arduino-cli could not be launched.',
        uploadTime
      };
    }
    return {
      success: true,
      output: uploaded.stdout,
      uploadTime
    };
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


  /**
   * Deterministic local analysis shared by every "no toolchain" path.
   *
   * Runs the real syntax/brace/entry-point checks, estimates flash/RAM from
   * the source length with a documented model, and labels the result as an
   * *analysis* — never as a successful vendor compilation.
   */
  private analyseSketch(sketchCode: string, libraries: string[], startTime: number): CompilationResult {
    const syntaxErrors = this.validateSyntax(sketchCode);
    const flash = this.estimateFlashUsage(sketchCode, libraries);
    const ram = this.estimateRamUsage(sketchCode);
    const total = this.selectedBoard?.flash || 0;
    const ramTotal = this.selectedBoard?.ram || 0;

    if (syntaxErrors.length > 0) {
      return {
        success: false,
        output: 'Static analysis failed. Install arduino-cli for a real compilation.',
        errors: syntaxErrors,
        warnings: [],
        binarySize: 0,
        memoryUsage: {
          flash: { used: 0, total, percentage: 0 },
          ram: { used: 0, total: ramTotal, percentage: 0 },
        },
        compilationTime: Date.now() - startTime
      };
    }

    return {
      success: true,
      output:
        `Static analysis passed (arduino-cli not available, so this is not a real build). ` +
        `Estimated ${flash} bytes flash / ${ram} bytes RAM on ${this.selectedBoard?.name}.`,
      errors: [],
      warnings: [
        ...this.generateWarnings(sketchCode),
        'No vendor toolchain ran: install arduino-cli for machine code and exact sizes.'
      ],
      binarySize: flash,
      memoryUsage: {
        flash: {
          used: flash,
          total,
          percentage: total === 0 ? 0 : (flash / total) * 100
        },
        ram: {
          used: ram,
          total: ramTotal,
          percentage: ramTotal === 0 ? 0 : (ram / ramTotal) * 100
        }
      },
      compilationTime: Date.now() - startTime
    };
  }

  private async simulateCompilation(sketchCode: string, libraries: string[], startTime: number): Promise<CompilationResult> {
    return this.analyseSketch(sketchCode, libraries, startTime);
  }

  private async simulateUpload(port: string, startTime: number): Promise<UploadResult> {
    void port;
    // Legacy shim: every caller now goes through uploadSketch(), which fails
    // honestly when no transport exists. Kept so older call sites compile.
    return {
      success: false,
      output: 'Upload is unavailable without arduino-cli and a connected board.',
      error: 'No upload transport',
      uploadTime: Date.now() - startTime
    };
  }
}

export const boardProgrammer = new BoardProgrammer();

/* ────────────────────────────────────────────────────────────────────────────
 * Launching external tools
 *
 * Processes are started from an argument array, never from an interpolated
 * command line. A sketch path, a library name or a board id can contain a
 * space, a quote or a shell metacharacter, and `exec` would mangle the first
 * and execute the last.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Start `command` with `args` and resolve as soon as it is *running*.
 *
 * `spawn` rather than `exec` because a launched IDE outlives the call and may
 * stay open for hours; `detached` + `unref` keeps that child from holding the
 * workbench open, and the promise settles on `spawn`/`error` instead of on
 * exit. `windowsHide` stops a console window flashing up behind a GUI launch.
 */
export async function launchDetached(command: string, args: readonly string[]): Promise<boolean> {
  // Fail closed *before* the bridge: a missed runtime check returns false,
  // never a stub throw.
  if (!isNodeRuntime()) return false
  return nodeSpawnDetached(command, args)
}

/**
 * Hand `filePath` to the operating system's default handler.
 *
 * Windows' `start` is a `cmd` builtin rather than an executable, and it takes
 * its first *quoted* argument as the window title — so
 * `start "C:\...\sketch.ino"` opens an empty console window and drops the
 * file. The empty title argument is what makes it open the document.
 */
export async function openWithDefaultApplication(filePath: string): Promise<boolean> {
  // `process` does not exist in the browser: guard before reading it.
  if (!isNodeRuntime()) return false
  if (process.platform === 'win32') return launchDetached('cmd', ['/c', 'start', '', filePath])
  if (process.platform === 'darwin') return launchDetached('open', [filePath])
  return launchDetached('xdg-open', [filePath])
}

/** Overrides every derived Arduino IDE location below. */
const ARDUINO_IDE_EXE_ENV = 'FOLIO_ARDUINO_IDE_EXE'

/**
 * Where an Arduino IDE install is likely to live, most specific first.
 *
 * A fixed `C:\Program Files\...` literal is correct only on the machine that
 * typed it, and it is wrong even on Windows for the per-user install that
 * Arduino IDE 2.x defaults to (`%LOCALAPPDATA%\Programs`). The install roots
 * are read from the environment instead, so the list is right on whichever
 * machine runs it, and `FOLIO_ARDUINO_IDE_EXE` covers a copy that lives
 * somewhere else entirely. macOS bundles sit at fixed *system* paths rather
 * than under a user profile, so those are written out.
 */
export function arduinoIdeCandidates(): string[] {
  // No environment, no install roots and no PATH probing in the browser —
  // there is nothing here a launch loop could usefully try.
  if (!isNodeRuntime()) return []
  const candidates: string[] = []
  const configured = process.env[ARDUINO_IDE_EXE_ENV]
  if (configured) candidates.push(configured)

  if (process.platform === 'win32') {
    const localPrograms = process.env.LOCALAPPDATA
    if (localPrograms) candidates.push(`${localPrograms}\\Programs\\Arduino IDE\\Arduino IDE.exe`)
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)'] as const) {
      const root = process.env[key]
      if (root) candidates.push(`${root}\\Arduino IDE\\Arduino IDE.exe`)
    }
  } else if (process.platform === 'darwin') {
    const bundle = 'Arduino IDE.app/Contents/MacOS/Arduino IDE'
    candidates.push(`/Applications/${bundle}`)
    const home = process.env.HOME
    if (home) candidates.push(`${home}/Applications/${bundle}`)
  }

  // Whatever the launcher on PATH resolves to; `spawn` searches PATH itself.
  candidates.push('arduino', 'arduino-ide')
  return candidates
}

// Arduino IDE integration utilities
export class ArduinoIDEIntegration {
  static async openInArduinoIDE(code: string): Promise<boolean> {
    // This feature requires Node.js environment
    if (!isNodeRuntime()) {
      console.warn('Arduino IDE integration requires Node.js environment');
      return false;
    }

    try {
      const fs = await nodeFs();
      const path = await nodePath();
      const os = await nodeOs();
      if (!fs || !path || !os) return false;

      // Create temporary sketch file
      const tempDir = path.join(os.tmpdir(), 'arduino-ide-' + Date.now());
      const sketchFile = path.join(tempDir, 'sketch.ino');

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(sketchFile, code);

      // Try each known install location; the first one that starts wins.
      for (const command of arduinoIdeCandidates()) {
        if (await launchDetached(command, [sketchFile])) {
          return true;
        }
      }

      // No Arduino IDE found: open the sketch with the OS default handler
      // rather than reporting success for a file nobody can see.
      return await openWithDefaultApplication(sketchFile);
    } catch {
      console.error('Failed to open Arduino IDE');
      return false;
    }
  }

  /**
   * Ask one candidate for its version.
   *
   * Resolves to the version string, or `null` when that command is not
   * installed or does not answer.
   */
  private static async probeArduinoIdeVersion(command: string): Promise<string | null> {
    // Reached only after the public guard, but a future caller must not be
    // able to reach a builtin from a browser context by accident.
    if (!isNodeRuntime()) return null;
    const probed = await nodeExecFile(command, ['--version'])
    if (!probed || probed.error) return null
    const match = /(\d+\.\d+\.\d+)/.exec(probed.stdout);
    return match ? match[1] : null;
  }

  /**
   * Version of the first installed Arduino IDE, or `null` if none is found.
   *
   * Probes the same locations `openInArduinoIDE` launches from: asking only
   * about `arduino` on `PATH` reported "not installed" for the default
   * Windows install, which the open path could happily start.
   */
  static async getArduinoIDEVersion(): Promise<string | null> {
    if (!isNodeRuntime()) {
      return null;
    }
    try {
      for (const command of arduinoIdeCandidates()) {
        const version = await ArduinoIDEIntegration.probeArduinoIdeVersion(command);
        if (version !== null) {
          return version;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  static async isArduinoIDEInstalled(): Promise<boolean> {
    if (!isNodeRuntime()) {
      return false;
    }
    return (await ArduinoIDEIntegration.getArduinoIDEVersion()) !== null;
  }

  static async installBoard(boardId: string): Promise<boolean> {
    if (!isNodeRuntime()) {
      return false;
    }
    try {
      // Argument array, not an interpolated command line: `boardId` is public
      // API, and a shell would run whatever it contained.
      const installed = await nodeExecFile('arduino-cli', ['core', 'install', boardId])
      return installed !== null && !installed.error;
    } catch {
      return false;
    }
  }

  static async updateBoardIndex(): Promise<boolean> {
    if (!isNodeRuntime()) {
      return false;
    }
    try {
      const updated = await nodeExecFile('arduino-cli', ['core', 'update-index'])
      return updated !== null && !updated.error;
    } catch {
      return false;
    }
  }

  /**
   * Program an FPGA through the matching vendor toolchain.
   *
   * Each entry is `[executable, ...arguments]` instead of one command string,
   * because `bitstreamPath` is a filesystem path: through a shell it would be
   * split on its own spaces, and the `p;<file>` payload `quartus_pgm` expects
   * has to reach the tool verbatim.
   */
  static async programFPGA(bitstreamPath: string, device: string): Promise<boolean> {
    if (!isNodeRuntime()) {
      return false;
    }
    try {
      // Support for common FPGA programming tools. Each entry is an argument
      // array, not a command string: a bitstream path handed to a shell is a
      // path that gets split on its own spaces, and the Intel entry's payload
      // has to survive verbatim.
      const programmingCommands: Record<string, [string, ...string[]]> = {
        'xilinx': ['vivado', '-mode', 'batch', '-source', 'program_fpga.tcl', '-tclargs', bitstreamPath],
        'intel': ['quartus_pgm', '-c', '1', '-m', 'JTAG', '-o', `p;${bitstreamPath}`],
        'lattice': ['pgrcmd', '-infile', bitstreamPath],
        'gowin': ['openFPGALoader', '-b', 'tangnano', bitstreamPath]
      };

      const programmingCommand = programmingCommands[device.toLowerCase()];
      if (!programmingCommand) {
        throw new Error(`Unsupported FPGA device: ${device}`);
      }

      const [programmer, ...programmerArgs] = programmingCommand;

      const programmed = await nodeExecFile(programmer, programmerArgs)
      if (!programmed || programmed.error) {
        console.error('FPGA programming failed:', programmed?.stderr ?? 'tool could not be launched');
        return false;
      }
      return true;
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

  /**
   * Validate the HIL configuration before any stimulus is attempted. Real
   * drive/measure hardware is checked in `applyTestInputs` /
   * `measureOutputs`, which fail closed when nothing is attached — this step
   * guarantees the suite itself is coherent (interfaces enabled, test cases
   * well-formed) so later failures are about hardware, not typos.
   */
  private static async initializeHILHardware(config: HILTestConfig): Promise<void> {
    const kinds = ['digital', 'analog', 'can', 'spi', 'i2c', 'uart'] as const;

    const enabled = kinds.filter(kind => config.hardwareInterfaces[kind]);
    if (enabled.length === 0) {
      throw new Error('HIL setup requires at least one enabled hardware interface.');
    }
    if (config.testCases.length === 0) {
      throw new Error('HIL setup requires at least one test case.');
    }
    if (config.samplingRate !== undefined && config.samplingRate <= 0) {
      throw new Error('HIL samplingRate must be greater than zero.');
    }
    if (config.timeout !== undefined && config.timeout <= 0) {
      throw new Error('HIL timeout must be greater than zero.');
    }

    const seenIds = new Set<string>();
    for (const testCase of config.testCases) {
      if (seenIds.has(testCase.id)) {
        throw new Error(`Duplicate HIL test case id "${testCase.id}".`);
      }
      seenIds.add(testCase.id);

      const used = kinds.filter(
        kind => testCase.inputs[kind] !== undefined || testCase.expectedOutputs[kind] !== undefined
      );
      if (used.length === 0) {
        throw new Error(`HIL test case "${testCase.id}" declares no inputs or expected outputs.`);
      }
      for (const kind of used) {
        if (!config.hardwareInterfaces[kind]) {
          throw new Error(
            `HIL test case "${testCase.id}" uses ${kind.toUpperCase()} I/O but that interface is not enabled.`
          );
        }
      }

      const analogTolerances = testCase.tolerances?.analog;
      if (analogTolerances) {
        for (const [channel, tolerance] of Object.entries(analogTolerances)) {
          if (!Number.isFinite(tolerance) || tolerance < 0) {
            throw new Error(
              `HIL test case "${testCase.id}": tolerance for ${channel} must be a non-negative number.`
            );
          }
        }
      }
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
    // No drive hardware is attached: fail closed instead of logging
    // "Setting pin…" lines that imply actuation happened.
    void inputs;
    throw new Error('HIL stimulus requires connected hardware. No drive interface is attached.');
  }

  private static async measureOutputs(expectedOutputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    // No measurement hardware is attached in the browser: report the absence
    // explicitly so HIL verdicts are "cannot measure", never a coin flip.
    void expectedOutputs;
    throw new Error('HIL measurement requires connected hardware. No measurement interface is attached.');
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
