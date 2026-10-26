/**
 * Sample Pi-class image and boot files for the imaging demo.
 *
 * These are ordinary byte inputs fed to the same `parseMbr`, `flashPlan` and
 * `bringUpVerdict` functions a real image goes through. They prove the
 * browser-side workflow without claiming a device was written: flashing still
 * requires the folio-bridge companion.
 */
import { REQUIRED_BOOT_FILES, type BootPartitionFile } from '../programming/linuxBringUp'

const SECTOR = 512
const IMAGE_SECTORS = 8192 // 4 MiB

/** 4 MiB image: bootable FAT32 boot partition + Linux root partition. */
export function buildDemoImagingImage(): Uint8Array {
  const image = new Uint8Array(IMAGE_SECTORS * SECTOR)
  const view = new DataView(image.buffer)
  // Partition 0: bootable, type 0x0C (FAT32 LBA), starts at LBA 2048.
  image[446] = 0x80
  image[446 + 4] = 0x0c
  view.setUint32(446 + 8, 2048, true)
  view.setUint32(446 + 12, 2048, true)
  // Partition 1: type 0x83 (Linux), starts at LBA 4096.
  image[462 + 4] = 0x83
  view.setUint32(462 + 8, 4096, true)
  view.setUint32(462 + 12, 4096, true)
  // Payload markers so the chunk hashes are not all zeroes.
  image[2048 * SECTOR] = 0x42
  image[4096 * SECTOR] = 0x52
  image[510] = 0x55
  image[511] = 0xaa
  return image
}

/** A complete, parseable boot-partition file set for the bring-up check. */
export function buildDemoBootFiles(): BootPartitionFile[] {
  const encoder = new TextEncoder()
  const kernel = new Uint8Array(64 * 1024).fill(0xa5)
  const contents: Record<string, Uint8Array> = {
    'config.txt': encoder.encode('arm_64bit=1\nenable_uart=1\ngpu_mem=64\n'),
    'cmdline.txt': encoder.encode('console=serial0,115200 root=/dev/mmcblk0p2 rootwait'),
    'kernel.img': kernel,
    'bcm2711-rpi-4-b.dtb': encoder.encode('demo device tree blob'),
    'start4.elf': encoder.encode('demo start4 firmware'),
    'fixup4.dat': encoder.encode('demo fixup data'),
  }
  return REQUIRED_BOOT_FILES.map((name) => ({ name, contents: contents[name] }))
}

/** UART capture that satisfies the documented first-boot handshake. */
export const DEMO_SERIAL_LOG = [
  '[    0.000000] Raspberry Pi 4 Model B Rev 1.4',
  '[    0.000000] Kernel command line: console=serial0,115200 root=/dev/mmcblk0p2 rootwait',
  '[    1.284510] Mounted root (ext4) filesystem',
  '[    1.902441] systemd[1]: Reached target multi-user.target',
  '[    3.115082] raspberrypi login:',
].join('\n')
