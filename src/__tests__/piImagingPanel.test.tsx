/**
 * Pi imaging panel render coverage.
 *
 * Proves the browser half never claims a flash succeeded without the daemon:
 * offline connections are named, the chunk plan is built in-browser, the
 * flash result comes from the daemon reply, and the boot contract rejects a
 * silent console.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PiImagingPanel from '../components/programming/PiImagingPanel'
import { companionBridge } from '../lib/programming/companionBridge'

/** 4-sector MBR image: boot (0x0C) + Linux root (0x83). */
function syntheticImage(): Uint8Array {
  const image = new Uint8Array(4 * 512)
  const view = new DataView(image.buffer)
  image[446] = 0x80
  image[446 + 4] = 0x0c
  view.setUint32(446 + 8, 1, true)
  view.setUint32(446 + 12, 1, true)
  image[462 + 4] = 0x83
  view.setUint32(462 + 8, 2, true)
  view.setUint32(462 + 12, 2, true)
  image[510] = 0x55
  image[511] = 0xaa
  return image
}

/** Copy into a plain ArrayBuffer so it satisfies BlobPart under TS 5.5. */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

const bootFiles = () => [
  new File(['arm_64bit=1\nenable_uart=1\n'], 'config.txt'),
  new File(['console=serial0,115200 root=/dev/mmcblk0p2 rootwait'], 'cmdline.txt'),
  new File([arrayBufferOf(new Uint8Array(2048))], 'kernel.img'),
  new File(['dtb'], 'bcm2711-rpi-4-b.dtb'),
  new File(['elf'], 'start4.elf'),
  new File(['dat'], 'fixup4.dat'),
]

describe('PiImagingPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the offline daemon instead of pretending to flash', async () => {
    vi.spyOn(companionBridge, 'connect').mockResolvedValue(false)
    render(<PiImagingPanel onClose={vi.fn()} />)

    expect(screen.getByText('Daemon offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flash via companion' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Connect daemon' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Companion daemon unreachable')
  })

  it('plans the image, flashes through the daemon and reports the confirmed hash', async () => {
    vi.spyOn(companionBridge, 'connect').mockResolvedValue(true)
    vi.spyOn(companionBridge, 'sendRequest').mockResolvedValue({
      kind: 'ready',
      devices: [{ id: 'dryrun.img', sizeBytes: 2048, sectorBytes: 512, dryRun: true }],
    })
    const flashImage = vi
      .spyOn(companionBridge, 'flashImage')
      .mockImplementation(async (_device, bytes, onProgress) => {
        onProgress?.({
          bytesWritten: bytes.length,
          totalBytes: bytes.length,
          percent: 100,
          stage: 'completed',
        })
        return { success: true, totalBytes: bytes.length, hash: 'ab'.repeat(32) }
      })

    render(<PiImagingPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect daemon' }))
    expect(await screen.findByText('Daemon online')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /dryrun\.img/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Select disk image'), {
      target: { files: [new File([arrayBufferOf(syntheticImage())], 'rpi.img')] },
    })

    expect(await screen.findByText(/1 chunk planned/)).toBeInTheDocument()
    expect(screen.getByText(/#0 type 0x0c/)).toBeInTheDocument()
    expect(screen.getByText(/#1 type 0x83/)).toBeInTheDocument()

    const flashButton = screen.getByRole('button', { name: 'Flash via companion' })
    expect(flashButton).toBeEnabled()
    fireEvent.click(flashButton)

    expect(await screen.findByText(/Daemon confirmed/)).toBeInTheDocument()
    expect(flashImage).toHaveBeenCalledWith('dryrun.img', expect.any(Uint8Array), expect.any(Function))
    expect(screen.getByText(/abababab/)).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('accepts a complete boot contract and reports a missing console handshake', async () => {
    render(<PiImagingPanel onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Select boot partition files'), {
      target: { files: bootFiles() },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check bring-up' })).toBeEnabled())

    const consoleField = screen.getByLabelText('Serial console output')
    fireEvent.change(consoleField, {
      target: {
        value: [
          'Raspberry Pi 4 Model B Rev 1.4',
          'Kernel command line: console=serial0,115200 root=/dev/mmcblk0p2 rootwait',
          'Mounted root (ext4) filesystem',
          'raspberrypi login:',
        ].join('\n'),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check bring-up' }))
    expect(await screen.findByText('Boot contract satisfied')).toBeInTheDocument()

    fireEvent.change(consoleField, { target: { value: 'Raspberry Pi 4 Model B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check bring-up' }))
    expect(screen.getByText(/console never printed "Kernel command line"/)).toBeInTheDocument()
  })
})
