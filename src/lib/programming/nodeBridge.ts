/**
 * Node-only toolchain bridge (browser-bundle hygiene).
 *
 * `boardProgrammer.ts` used bare `await import('child_process' | 'fs' |
 * 'path' | 'os')`, so every production build prints ~18 "externalized for
 * browser compatibility" warnings and the browser bundle carries stubs
 * whose property access throws. The runtime guards made that safe, but the
 * noise hides real issues and one missed guard would ship a crash.
 *
 * This module owns every Node builtin import behind `vite-ignore`
 * dynamic imports. The browser bundle never resolves these specifiers —
 * the bridge is only *called* after `isNodeRuntime()`, and a missed call
 * fails with a typed null/false instead of a stub throw. Fail-closed.
 */

export interface ExecResult {
  error: Error | null
  stdout: string
  stderr: string
}

type ExecFileFn = (file: string, args: string[], options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) => void

async function nodeModule<T>(name: 'child_process' | 'fs' | 'path' | 'os'): Promise<T | null> {
  try {
    return (await import(/* @vite-ignore */ name)) as T
  } catch {
    return null
  }
}

export async function nodeExec(command: string): Promise<string | null> {
  const child = await nodeModule<{ exec: (cmd: string, cb: (error: Error | null, out: string) => void) => void }>('child_process')
  if (!child) return null
  return new Promise((resolve) => {
    child.exec(command, (error: Error | null, out: string) => {
      resolve(error ? null : out)
    })
  })
}

export async function nodeExecFile(file: string, args: string[], cwd?: string): Promise<ExecResult | null> {
  const child = await nodeModule<{ execFile: ExecFileFn }>('child_process')
  if (!child) return null
  return new Promise((resolve) => {
    child.execFile(file, args, cwd ? { cwd, windowsHide: true } : { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

export async function nodeSpawnDetached(command: string, args: readonly string[]): Promise<boolean> {
  const child = await nodeModule<{ spawn: (cmd: string, args: readonly string[], opts: object) => { on: (event: string, cb: () => void) => void; unref: () => void } }>('child_process')
  if (!child) return false
  return new Promise((resolve) => {
    let settled = false
    const finish = (launched: boolean) => {
      if (settled) return
      settled = true
      resolve(launched)
    }
    try {
      const proc = child.spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
      // 'spawn' fires only once the OS actually started the process; resolving
      // earlier would report ENOENT launches as success.
      proc.on('spawn', () => {
        proc.unref()
        finish(true)
      })
      proc.on('error', () => finish(false))
    } catch {
      finish(false)
    }
  })
}

export async function nodeFs(): Promise<{
  writeFileSync: (path: string, data: string | Uint8Array) => void
  mkdirSync: (path: string, options?: object) => void
  rmSync: (path: string, options?: object) => void
} | null> {
  return nodeModule('fs')
}

export async function nodePath(): Promise<{
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
} | null> {
  return nodeModule('path')
}

export async function nodeOs(): Promise<{ tmpdir: () => string; platform: () => string } | null> {
  return nodeModule('os')
}

/** True when Node facilities may be touched — single shared definition. */
export const isNodeRuntime = (): boolean => typeof window === 'undefined'
