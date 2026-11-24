/**
 * Linux board bring-up flow (Pi-class final leg).
 *
 * Flashing bytes is not bringing up a board: a Pi boots only when the FAT
 * boot partition holds a valid `config.txt`, `cmdline.txt`, kernel, and
 * device-tree, the ext4 root holds a first-boot handshake, and the serial
 * console answers. This module is that checklist as code — it validates a
 * flashed image's boot contract *before* the board ever powers on, and
 * defines the handshake the companion daemon watches on the UART after it.
 *
 * Pure functions over explicit inputs. Fail-loud: a missing kernel, a
 * malformed config, or a silent console is a named refusal, never a guess.
 */

export interface BootPartitionFile {
  name: string;
  contents: Uint8Array;
}

export interface BringUpCheck {
  ok: boolean;
  failures: string[];
}

/** Required boot files for a Raspberry-Pi-class boot partition (FAT). */
export const REQUIRED_BOOT_FILES = [
  'config.txt',
  'cmdline.txt',
  'kernel.img',
  'bcm2711-rpi-4-b.dtb',
  'start4.elf',
  'fixup4.dat',
] as const;

/** Parse `config.txt` key=value lines (ignoring comments and blanks). */
export function parseBootConfig(text: string): Map<string, string> {
  const config = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`boot config: malformed line "${rawLine}"`);
    config.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return config;
}

/** Validate the boot partition file set and config contract. */
export function checkBootPartition(files: BootPartitionFile[]): BringUpCheck {
  const failures: string[] = [];
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  for (const required of REQUIRED_BOOT_FILES) {
    if (!byName.has(required)) failures.push(`missing boot file ${required}`);
  }
  const configFile = byName.get('config.txt');
  if (configFile) {
    let config: Map<string, string>;
    try {
      config = parseBootConfig(new TextDecoder().decode(configFile.contents));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'unparseable config.txt');
      config = new Map();
    }
    if (config.size === 0 && failures.length === 0) failures.push('config.txt is empty');
  }
  const cmdline = byName.get('cmdline.txt');
  if (cmdline) {
    const text = new TextDecoder().decode(cmdline.contents).trim();
    if (!text.includes('root=')) failures.push('cmdline.txt has no root= parameter');
    if (text.includes('\n')) failures.push('cmdline.txt must be a single line');
  }
  const kernel = byName.get('kernel.img');
  if (kernel && kernel.contents.length < 1024) failures.push('kernel.img is suspiciously small');
  return { ok: failures.length === 0, failures };
}

/** First-boot handshake the daemon watches on the UART. */
export interface BootHandshake {
  /** Lines the console must print, in order (substrings). */
  expectLines: string[];
  /** Timeout in milliseconds for the full sequence. */
  timeoutMs: number;
}

export const PI_FIRST_BOOT_HANDSHAKE: BootHandshake = {
  expectLines: ['Raspberry Pi', 'Kernel command line', 'Mounted root', 'login:'],
  timeoutMs: 120_000,
};

/** Match console output against the handshake: returns the first missing line or null. */
export function matchHandshake(output: string, handshake: BootHandshake): string | null {
  let cursor = 0;
  for (const expected of handshake.expectLines) {
    const found = output.indexOf(expected, cursor);
    if (found < 0) return expected;
    cursor = found + expected.length;
  }
  return null;
}

/** Full bring-up verdict: boot files plus console handshake. */
export function bringUpVerdict(
  files: BootPartitionFile[],
  consoleOutput: string,
  handshake: BootHandshake = PI_FIRST_BOOT_HANDSHAKE,
): { ok: boolean; failures: string[] } {
  const boot = checkBootPartition(files);
  const missing = matchHandshake(consoleOutput, handshake);
  const failures = [...boot.failures];
  if (missing !== null) failures.push(`console never printed "${missing}"`);
  return { ok: failures.length === 0, failures };
}
