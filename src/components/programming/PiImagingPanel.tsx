/**
 * Pi-class imaging and bring-up workspace.
 *
 * A browser cannot touch an SD/eMMC block device, so this panel is the
 * browser half of the companion-daemon architecture:
 *  • image inspection and chunk plan (MBR + per-chunk SHA-256) in the browser;
 *  • block writes delegated to the folio-bridge daemon, which hash-checks
 *    every chunk and reads it back before reporting success;
 *  • the Linux boot contract (boot files, config.txt, cmdline.txt, kernel,
 *    serial handshake) checked before and after power-on.
 * Nothing here claims a flash succeeded on its own: success comes only from
 * the daemon's per-chunk confirmations.
 */
import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import { AlertCircle, CheckCircle, FolderOpen, Plug, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { describeError } from '../../lib/utils'
import { companionBridge, type FlashProgress } from '../../lib/programming/companionBridge'
import { flashPlan, parseMbr, type FlashChunk, type MbrPartition } from '../../lib/programming/imageFlasher'
import {
  PI_FIRST_BOOT_HANDSHAKE,
  REQUIRED_BOOT_FILES,
  bringUpVerdict,
  type BootPartitionFile,
} from '../../lib/programming/linuxBringUp'
import type { FlashDevice } from '../../lib/programming/flashProtocol'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { buildDemoBootFiles, buildDemoImagingImage, DEMO_SERIAL_LOG } from '../../lib/demo/demoImaging'

interface PiImagingPanelProps {
  onClose: () => void
}

interface LoadedImage {
  name: string
  bytes: Uint8Array
}

type DaemonState = 'offline' | 'connecting' | 'online'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

function partitionType(type: number): string {
  return `0x${type.toString(16).padStart(2, '0')}`
}

/** FileReader keeps this working in browsers without Blob.arrayBuffer. */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result))
      else reject(new Error(`Could not read ${file.name} as bytes.`))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`))
    reader.readAsArrayBuffer(file)
  })
}

export default function PiImagingPanel({ onClose }: PiImagingPanelProps) {
  const [daemonState, setDaemonState] = useState<DaemonState>(companionBridge.isConnected ? 'online' : 'offline')
  const [daemonError, setDaemonError] = useState<string | null>(null)
  const [devices, setDevices] = useState<FlashDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const transports = useMemo(() => companionBridge.detectAvailableTransports(), [])

  const [image, setImage] = useState<LoadedImage | null>(null)
  const [imageNotice, setImageNotice] = useState<string | null>(null)
  const [partitions, setPartitions] = useState<MbrPartition[]>([])
  const [plan, setPlan] = useState<FlashChunk[] | null>(null)
  const [planning, setPlanning] = useState(false)

  const [progress, setProgress] = useState<FlashProgress | null>(null)
  const [flashing, setFlashing] = useState(false)
  const [flashError, setFlashError] = useState<string | null>(null)
  const [flashSuccess, setFlashSuccess] = useState<{ hash: string; totalBytes: number } | null>(null)

  const [bootFiles, setBootFiles] = useState<BootPartitionFile[]>([])
  const [bootError, setBootError] = useState<string | null>(null)
  const [consoleOutput, setConsoleOutput] = useState('')
  const [bringUp, setBringUp] = useState<{ ok: boolean; failures: string[] } | null>(null)
  const [demoStaged, setDemoStaged] = useState(false)

  const loadDevices = useCallback(async () => {
    try {
      const reply = await companionBridge.sendRequest({ kind: 'list-devices' })
      if (reply.kind === 'ready') {
        setDevices(reply.devices)
        setSelectedDevice((current) => (current || reply.devices[0]?.id || ''))
      } else if (reply.kind === 'error') {
        setDaemonError(reply.message)
      }
    } catch (error) {
      setDaemonError(describeError(error))
    }
  }, [])

  const connectDaemon = useCallback(async () => {
    setDaemonState('connecting')
    setDaemonError(null)
    try {
      const connected = await companionBridge.connect()
      if (!connected) {
        setDaemonState('offline')
        setDaemonError('Companion daemon unreachable at ws://127.0.0.1:48123 — launch folio-bridge on the host.')
        return
      }
      setDaemonState('online')
      await loadDevices()
    } catch (error) {
      setDaemonState('offline')
      setDaemonError(describeError(error))
    }
  }, [loadDevices])

  const disconnectDaemon = useCallback(() => {
    companionBridge.disconnect()
    setDaemonState('offline')
    setDevices([])
    setSelectedDevice('')
  }, [])

  const handleImageFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPlanning(true)
    setImageNotice(null)
    setPlan(null)
    setPartitions([])
    setProgress(null)
    setFlashError(null)
    setFlashSuccess(null)
    try {
      const bytes = await readFileBytes(file)
      if (bytes.length === 0) throw new Error('Image is empty.')
      const mbr = parseMbr(bytes)
      if (mbr.error) {
        setImageNotice(`No MBR partition table: ${mbr.error}. The image can still be written byte-for-byte.`)
      }
      setPartitions(mbr.partitions)
      setImage({ name: file.name, bytes })
      setPlan(await flashPlan(bytes))
    } catch (error) {
      setImage(null)
      setImageNotice(describeError(error))
    } finally {
      setPlanning(false)
    }
  }, [])

  const handleFlash = useCallback(async () => {
    if (!image || !selectedDevice) return
    setFlashing(true)
    setFlashError(null)
    setFlashSuccess(null)
    setProgress(null)
    try {
      const result = await companionBridge.flashImage(selectedDevice, image.bytes, setProgress)
      setFlashSuccess(result)
    } catch (error) {
      setFlashError(describeError(error))
    } finally {
      setFlashing(false)
    }
  }, [image, selectedDevice])

  const handleBootFiles = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    try {
      const loaded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          contents: await readFileBytes(file),
        })),
      )
      setBootFiles(loaded)
      setBootError(null)
      setBringUp(null)
    } catch (error) {
      setBootError(describeError(error))
    }
  }, [])

  const checkBringUp = useCallback(() => {
    try {
      setBringUp(bringUpVerdict(bootFiles, consoleOutput))
      setBootError(null)
    } catch (error) {
      setBootError(describeError(error))
    }
  }, [bootFiles, consoleOutput])

  /*
   * Gallery demo: stage a real MBR image and a complete boot file set through
   * the same parsers the file picker uses, then run the bring-up verdict. It
   * deliberately does not touch the daemon or claim a flash — the banner says
   * the image is staged in memory.
   */
  const stageDemo = useCallback(async () => {
    setPlanning(true)
    try {
      const bytes = buildDemoImagingImage()
      const mbr = parseMbr(bytes)
      const files = buildDemoBootFiles()
      setImage({ name: 'folio-pi-demo.img', bytes })
      setPartitions(mbr.partitions)
      setImageNotice(mbr.error ? `No MBR partition table: ${mbr.error}.` : null)
      setPlan(await flashPlan(bytes))
      setBootFiles(files)
      setConsoleOutput(DEMO_SERIAL_LOG)
      setBringUp(bringUpVerdict(files, DEMO_SERIAL_LOG))
      setBootError(null)
      setProgress(null)
      setFlashError(null)
      setFlashSuccess(null)
      setDemoStaged(true)
    } catch (error) {
      setImageNotice(describeError(error))
    } finally {
      setPlanning(false)
    }
  }, [])

  useDemoRequest('imaging-pipeline', () => { void stageDemo() })

  const statusBadge =
    daemonState === 'online' ? (
      <Badge className="bg-success text-success-foreground">Daemon online</Badge>
    ) : daemonState === 'connecting' ? (
      <Badge variant="secondary">Connecting…</Badge>
    ) : (
      <Badge variant="destructive">Daemon offline</Badge>
    )

  const loadedBootNames = new Set(bootFiles.map((file) => file.name.toLowerCase()))
  const canFlash = daemonState === 'online' && Boolean(image) && Boolean(selectedDevice) && !flashing

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Pi Imaging &amp; Bring-Up
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close imaging panel">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <div className="space-y-4">
            {demoStaged && (
              <div
                role="status"
                aria-label="Imaging demo status"
                className="rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs leading-relaxed text-foreground"
              >
                <strong className="text-chart-4">Demo:</strong> a 4 MiB sample image with a real MBR and a
                complete boot file set are staged in browser memory; the chunk plan and bring-up verdict ran
                for real. No device was written — live flashing needs folio-bridge on the host.
              </div>
            )}
            <Card>
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Plug className="h-4 w-4" />
                    Companion daemon
                  </span>
                  {statusBadge}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-3 pb-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Transports detected</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {transports.map((transport) => (
                      <Badge key={transport} variant="secondary">
                        {transport}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="text-muted-foreground">
                  Endpoint: <span className="font-mono">ws://127.0.0.1:48123</span>. Raw block devices and
                  OpenOCD/JTAG need the folio-bridge host companion; WebSerial/WebUSB remain browser-native
                  alternatives for serial bootloaders.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {daemonState === 'online' ? (
                    <Button variant="outline" size="sm" onClick={disconnectDaemon}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void connectDaemon()} disabled={daemonState === 'connecting'}>
                      Connect daemon
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadDevices()}
                    disabled={daemonState !== 'online'}
                    aria-label="Refresh flash devices"
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Devices
                  </Button>
                </div>
                {daemonError && (
                  <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                    {daemonError}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Upload className="h-4 w-4" />
                  Disk image
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-3 pb-3 text-xs">
                <label className="block">
                  <span className="text-muted-foreground">Select an OS image</span>
                  <Input
                    type="file"
                    accept=".img,.bin,.iso,.raw"
                    aria-label="Select disk image"
                    onChange={(event) => void handleImageFile(event)}
                    className="mt-1 h-8 text-xs"
                  />
                </label>

                {image && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{image.name}</span>
                      <span className="text-muted-foreground">{formatBytes(image.bytes.length)}</span>
                    </div>
                    {partitions.length > 0 && (
                      <div className="space-y-1 rounded-md border border-border p-2">
                        <div className="text-muted-foreground">MBR partitions</div>
                        {partitions.map((entry) => (
                          <div key={entry.index} className="flex justify-between gap-2">
                            <span>
                              #{entry.index} type {partitionType(entry.type)}
                              {entry.bootable ? ' · bootable' : ''}
                            </span>
                            <span className="font-mono">{formatBytes(entry.sizeBytes)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {planning ? (
                      <div className="text-muted-foreground">Hashing image and building chunk plan…</div>
                    ) : plan ? (
                      <div className="text-muted-foreground">
                        {plan.length} chunk{plan.length === 1 ? '' : 's'} planned ({formatBytes(plan[0]?.length ?? 0)} each), SHA-256 per chunk.
                      </div>
                    ) : null}
                  </div>
                )}

                {imageNotice && (
                  <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-warning">
                    {imageNotice}
                  </div>
                )}

                <label className="block">
                  <span className="text-muted-foreground">Target device</span>
                  <select
                    value={selectedDevice}
                    onChange={(event) => setSelectedDevice(event.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    disabled={devices.length === 0}
                  >
                    <option value="">Select device</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.id} — {formatBytes(device.sizeBytes)}
                        {device.dryRun ? ' (dry run)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <Button size="sm" onClick={() => void handleFlash()} disabled={!canFlash}>
                  {flashing ? 'Flashing…' : 'Flash via companion'}
                </Button>

                {progress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>{progress.stage}</span>
                      <span>{progress.percent}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress.percent}
                      className="h-2 overflow-hidden rounded bg-muted"
                    >
                      <div className="h-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
                    </div>
                    <div className="text-muted-foreground">
                      {formatBytes(progress.bytesWritten)} / {formatBytes(progress.totalBytes)}
                      {progress.speedMbPerSec !== undefined ? ` · ${progress.speedMbPerSec.toFixed(1)} MB/s` : ''}
                    </div>
                  </div>
                )}

                {flashError && (
                  <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                    {flashError}
                  </div>
                )}
                {flashSuccess && (
                  <div role="status" className="rounded-md border border-success/40 bg-success/10 px-2 py-1 text-success">
                    <div className="flex items-center gap-1 font-medium">
                      <CheckCircle className="h-3 w-3" />
                      Daemon confirmed {formatBytes(flashSuccess.totalBytes)}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px]">SHA-256 {flashSuccess.hash}</div>
                  </div>
                )}

                <div className="text-muted-foreground">
                  The image is held in browser memory; very large images may exhaust the tab. Every chunk is
                  hash-checked and read back by the daemon before this panel reports success.
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FolderOpen className="h-4 w-4" />
                Linux boot contract
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-3 pb-3 text-xs">
              <div>
                <div className="text-muted-foreground">Required boot-partition files</div>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {REQUIRED_BOOT_FILES.map((name) => (
                    <div key={name} className="flex items-center gap-1">
                      {loadedBootNames.has(name) ? (
                        <CheckCircle className="h-3 w-3 text-success" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="font-mono">{name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-muted-foreground">Select the files from the flashed boot partition</span>
                <Input
                  type="file"
                  multiple
                  aria-label="Select boot partition files"
                  onChange={(event) => void handleBootFiles(event)}
                  className="mt-1 h-8 text-xs"
                />
              </label>

              <label className="block">
                <span className="text-muted-foreground">Serial console output</span>
                <textarea
                  value={consoleOutput}
                  onChange={(event) => setConsoleOutput(event.target.value)}
                  aria-label="Serial console output"
                  className="mt-1 h-28 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                  placeholder="Paste the UART log captured after power-on"
                  spellCheck={false}
                />
              </label>

              <div>
                <div className="text-muted-foreground">Handshake expected within {PI_FIRST_BOOT_HANDSHAKE.timeoutMs / 1000} s</div>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 font-mono">
                  {PI_FIRST_BOOT_HANDSHAKE.expectLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>

              <Button size="sm" onClick={checkBringUp} disabled={bootFiles.length === 0}>
                Check bring-up
              </Button>

              {bootError && (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                  {bootError}
                </div>
              )}

              {bringUp && (
                <div
                  role="status"
                  className={`space-y-1 rounded-md border px-2 py-1 ${
                    bringUp.ok
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-destructive/40 bg-destructive/10 text-destructive'
                  }`}
                >
                  <div className="font-medium">
                    {bringUp.ok ? 'Boot contract satisfied' : `${bringUp.failures.length} bring-up failure(s)`}
                  </div>
                  {bringUp.failures.map((failure) => (
                    <div key={failure}>• {failure}</div>
                  ))}
                </div>
              )}

              <div className="text-muted-foreground">
                The contract checks the boot files before power-on and the UART sequence after it. A silent
                console is reported as a failure, never assumed to have booted.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
