import { describe, expect, it } from 'vitest';
import { bringUpVerdict, checkBootPartition, matchHandshake, parseBootConfig, PI_FIRST_BOOT_HANDSHAKE } from './linuxBringUp';
import type { BootPartitionFile } from './linuxBringUp';

const enc = new TextEncoder();
const file = (name: string, text: string): BootPartitionFile => ({ name, contents: enc.encode(text) });
const kernel = (): BootPartitionFile => ({ name: 'kernel.img', contents: new Uint8Array(4096) });

const GOOD_FILES: BootPartitionFile[] = [
  file('config.txt', 'arm_64bit=1\ndtoverlay=disable-bt\n'),
  file('cmdline.txt', 'console=serial0,115200 root=/dev/mmcblk0p2 rootwait'),
  kernel(),
  file('bcm2711-rpi-4-b.dtb', 'dtb'),
  file('start4.elf', 'elf'),
  file('fixup4.dat', 'fixup'),
];

const GOOD_CONSOLE = 'Raspberry Pi 4 boot\nKernel command line: root=/dev/mmcblk0p2\nMounted root filesystem\nraspberrypi login: ';

describe('Linux board bring-up', () => {
  it('passes a complete boot partition and console handshake', () => {
    expect(checkBootPartition(GOOD_FILES).ok).toBe(true);
    expect(matchHandshake(GOOD_CONSOLE, PI_FIRST_BOOT_HANDSHAKE)).toBeNull();
    expect(bringUpVerdict(GOOD_FILES, GOOD_CONSOLE).ok).toBe(true);
  });
  it('parses boot config and rejects malformed lines', () => {
    expect(parseBootConfig('a=1\n# comment\nb = 2\n').get('b')).toBe('2');
    expect(() => parseBootConfig('no-equals-here')).toThrow(/malformed line/);
  });
  it('names every missing boot file and bad cmdline', () => {
    const missing = checkBootPartition([file('config.txt', 'x=1')]);
    expect(missing.ok).toBe(false);
    expect(missing.failures).toContain('missing boot file kernel.img');
    const badCmdline = checkBootPartition([...GOOD_FILES.filter((f) => f.name !== 'cmdline.txt'), file('cmdline.txt', 'console=serial0\nsecond line')]);
    expect(badCmdline.failures).toContain('cmdline.txt has no root= parameter');
    expect(badCmdline.failures).toContain('cmdline.txt must be a single line');
  });
  it('names the first missing console line', () => {
    expect(matchHandshake('Raspberry Pi 4 boot\n', PI_FIRST_BOOT_HANDSHAKE)).toBe('Kernel command line');
    const verdict = bringUpVerdict(GOOD_FILES, 'nothing boots here');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((f) => f.includes('console never printed'))).toBe(true);
  });
});
