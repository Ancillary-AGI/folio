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
      // In a real implementation, this would call the Arduino CLI or similar
      // For now, we'll simulate the compilation process
      
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
            flash: { used: 0, total: this.selectedBoard.flash, percentage: 0 },
            ram: { used: 0, total: this.selectedBoard.ram, percentage: 0 }
          },
          compilationTime: Date.now() - startTime
        };
      }

      // Simulate compilation process
      await this.simulateCompilation();

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
            total: this.selectedBoard.flash,
            percentage: (estimatedFlashUsage / this.selectedBoard.flash) * 100
          },
          ram: {
            used: estimatedRamUsage,
            total: this.selectedBoard.ram,
            percentage: (estimatedRamUsage / this.selectedBoard.ram) * 100
          }
        },
        compilationTime: Date.now() - startTime
      };

      return result;
    } catch (error) {
      return {
        success: false,
        output: 'Compilation failed',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        warnings: [],
        binarySize: 0,
        memoryUsage: {
          flash: { used: 0, total: this.selectedBoard.flash, percentage: 0 },
          ram: { used: 0, total: this.selectedBoard.ram, percentage: 0 }
        },
        compilationTime: Date.now() - startTime
      };
    }
  }

  async uploadSketch(port: string, compiledBinary?: ArrayBuffer): Promise<UploadResult> {
    if (!this.selectedBoard) {
      throw new Error('No board selected');
    }

    const startTime = Date.now();

    try {
      // In a real implementation, this would use the appropriate upload protocol
      // For now, we'll simulate the upload process
      
      await this.simulateUpload();

      return {
        success: true,
        output: this.generateUploadOutput(port),
        uploadTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        output: 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        uploadTime: Date.now() - startTime
      };
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

  private async simulateCompilation(): Promise<void> {
    // Simulate compilation time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  }

  private async simulateUpload(): Promise<void> {
    // Simulate upload time
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
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
    try {
      // In a real implementation, this would communicate with Arduino IDE
      // For now, we'll simulate opening the IDE
      console.log('Opening Arduino IDE with code:', code.substring(0, 100) + '...');
      return true;
    } catch (error) {
      console.error('Failed to open Arduino IDE:', error);
      return false;
    }
  }

  static async getArduinoIDEVersion(): Promise<string | null> {
    try {
      // In a real implementation, this would check the installed Arduino IDE version
      return '2.0.3';
    } catch (error) {
      return null;
    }
  }

  static async isArduinoIDEInstalled(): Promise<boolean> {
    try {
      // In a real implementation, this would check if Arduino IDE is installed
      return true;
    } catch (error) {
      return false;
    }
  }
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