/**
 * Demo firmware: the blinker board's Arduino sketch, end to end, no hardware.
 *
 * The embedded domain is honest about hardware: compile needs arduino-cli,
 * upload needs a granted serial port. What IS provable without either:
 * the 1 Hz blinker sketch for the demo board passes static analysis, packs
 * to a checksummed Intel HEX image, and uploads through the real STK500v1
 * session against a scripted loopback transport with read-back verify.
 * That is the entire browser-side path, proven byte-for-byte. Proven by
 * `demoFirmware.test.ts`.
 */
import { boardProgrammer } from '../programming/boardProgrammer';
import { bytesToIntelHex, parseIntelHex, textToBytes } from '../compilation/intelHex';
import { STK_INSYNC, STK_OK, uploadHexImage } from '../programming/uploadSession';

export const DEMO_SKETCH = `// Folio demo blinker — drives the 2N2222 low-side LED on D13.
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

export interface DemoFirmware {
  staticOk: boolean;
  hexRecords: number;
  hexBytes: number;
  uploadOk: boolean;
  verifiedBytes: number;
  verdict: string;
}

/** Scripted STK500v1 loopback with a flash image: writes stick, reads echo them. */
const loopback = () => {
  const listeners: Array<(data: Uint8Array) => void> = [];
  const flash = new Map<number, number>();
  let address = 0;
  const emit = (bytes: number[]): void => {
    const copy = new Uint8Array(bytes);
    for (const listener of listeners) listener(copy);
  };
  return {
    onData: (callback: (data: Uint8Array) => void): void => {
      listeners.push(callback);
    },
    write: async (data: Uint8Array): Promise<void> => {
      const command = data[0];
      await Promise.resolve();
      if (command === 0x55) {
        // LOAD_ADDRESS: word address follows (low, high).
        address = (data[1] | (data[2] << 8)) * 2;
        emit([STK_INSYNC, STK_OK]);
      } else if (command === 0x64) {
        // PROG_PAGE: len-hi, len-lo, 'F', payload.
        const length = (data[1] << 8) | data[2];
        for (let i = 0; i < length; i += 1) flash.set(address + i, data[4 + i]);
        address += length;
        emit([STK_INSYNC, STK_OK]);
      } else if (command === 0x74) {
        // READ_PAGE: echo back what was programmed (0xFF for untouched).
        const length = (data[1] << 8) | data[2];
        const out: number[] = [STK_INSYNC];
        for (let i = 0; i < length; i += 1) out.push(flash.get(address + i) ?? 0xff);
        out.push(STK_OK);
        address += length;
        emit(out);
      } else {
        emit([STK_INSYNC, STK_OK]);
      }
    },
  };
};

export async function buildDemoFirmware(): Promise<DemoFirmware> {
  boardProgrammer.setBoard('arduino_uno');
  boardProgrammer.setBrowserTransport(null);
  const compiled = await boardProgrammer.compileSketch(DEMO_SKETCH);
  if (!compiled.success) throw new Error(`Demo sketch failed analysis: ${compiled.errors.join('; ')}`);
  const image = bytesToIntelHex(textToBytes(DEMO_SKETCH), { baseAddress: 0 });
  const parsed = parseIntelHex(image);
  if ('error' in parsed) throw new Error(`Demo HEX failed to parse: ${parsed.error} (line ${parsed.line})`);
  const session = await uploadHexImage(loopback(), image, { flashSize: 32768 });
  if (!session.success) throw new Error(`Demo upload failed: ${session.message}`);
  const records = image.split('\n').filter((line) => line.startsWith(':')).length;
  const parsedBytes = 'bytes' in parsed ? parsed.bytes.length : 0;
  return {
    staticOk: compiled.success,
    hexRecords: records,
    hexBytes: parsedBytes,
    uploadOk: session.success,
    verifiedBytes: session.bytesVerified,
    verdict: `PASS: blinker sketch analyses clean, packs to ${records} HEX records, uploads + verifies ${session.bytesVerified} B over STK500v1.`,
  };
}
