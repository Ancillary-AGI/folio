/**
 * AuroraField — the ambient light behind the shell.
 *
 * Three slow ribbons of theme-coloured light, drifting on a GPU. Every colour
 * comes from `src/lib/theme/aurora.ts`: the bands are the open workspace family
 * hue plus the theme's own primaries, lifted a bounded amount above the
 * background, so the field can brighten a surface slightly and can never darken
 * one or push a text token under its contrast floor. The contrast test proves
 * that over the whole alpha ramp; this file only has to not contradict it.
 *
 * What it deliberately does not do:
 *   · no field in the high-contrast theme, and none under forced colours;
 *   · no animation when motion is reduced — one static frame instead, so the
 *     surface still looks designed rather than merely unlit;
 *   · no dependency on WebGL: without a context the element paints two soft CSS
 *     tints at a fraction of the strength;
 *   · nothing interactive. It is scenery — `pointer-events: none`, aria-hidden,
 *     never focusable, never a click target.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { auroraBands, type AuroraBands } from '../../lib/theme/aurora'
import { useAppStore } from '../../stores/useAppStore'
import { useTheme } from '../../lib/theme/useTheme'

const VERTEX_SOURCE = `
attribute vec2 aCorner;
void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`

/**
 * Each ribbon is a sine ridge sampled in a warped frame, so the three fold over
 * one another instead of marching in parallel. `uIntensity` caps how much of a
 * band's colour replaces the base — the brightness dial — and the band colour
 * itself is already bounded upstream by `AMBIENT_LIFT`.
 */
const FRAGMENT_SOURCE = `
// The drift is a function of elapsed seconds, so a shader that rounds it away
// freezes after a few minutes of an open editor. Ask for highp where the GPU has
// it, and fall back where it does not.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uResolution;
uniform float uTime;
uniform float uIntensity;
uniform vec3  uBase;
uniform vec3  uBandA;
uniform vec3  uBandB;
uniform vec3  uBandC;

vec2 warp(vec2 p, float t) {
  return p + 0.09 * vec2(sin(p.y * 2.6 + t * 0.23), cos(p.x * 2.1 - t * 0.17));
}

float ribbon(vec2 p, float angle, float offset, float frequency, float thickness, float t, float phase) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  float ridge = 0.13 * sin(q.x * frequency + phase + t * 0.41)
              + 0.06 * sin(q.x * frequency * 2.7 - t * 0.29);
  float d = (q.y - offset - ridge) / thickness;
  return exp(-d * d);
}

float grain(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / max(uResolution.y, 1.0);
  vec2 q = warp(p, uTime);

  float a = ribbon(q,  0.24,  0.30, 2.1, 0.30, uTime, 0.0);
  float b = ribbon(q, -0.52, -0.10, 3.0, 0.22, uTime, 2.1);
  float c = ribbon(q,  0.95, -0.46, 1.6, 0.34, uTime, 4.2);

  float weight = a + b + c;
  vec3 hue = (a * uBandA + b * uBandB + c * uBandC) / max(weight, 1e-4);
  float amount = min(weight, 1.0) * uIntensity * (0.88 + 0.12 * grain(q * 180.0));

  gl_FragColor = vec4(mix(uBase, hue, amount), 1.0);
}
`

/** Longest edge of the backing store. Gradients do not need a retina buffer. */
const MAX_EDGE = 1100
/** The drift reads as continuous at 30fps and costs about half the GPU time. */
const FRAME_INTERVAL_MS = 1000 / 30
/** Ceiling on how far a ribbon's colour replaces the background. */
const BAND_INTENSITY = 0.62

interface AuroraSession {
  setPalette: (bands: AuroraBands) => void
  setMotion: (animate: boolean) => void
  dispose: () => void
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

/** True when the OS asks for no motion, and the app has not overridden it. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function createSession(canvas: HTMLCanvasElement): AuroraSession | null {
  // A browser at its context limit, or a test environment without a canvas
  // implementation, fails here rather than half-mounting a black rectangle.
  let gl: WebGLRenderingContext | null = null
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })
  } catch {
    gl = null
  }
  if (!gl) return null

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
  const program = vertex && fragment ? gl.createProgram() : null
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }

  // One oversized triangle covering the viewport: no index buffer, no mesh.
  const corners = new Float32Array([-1, -1, 3, -1, -1, 3])
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
  const cornerLocation = gl.getAttribLocation(program, 'aCorner')
  gl.enableVertexAttribArray(cornerLocation)
  gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0)

  const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
  const locations = {
    resolution: uniform('uResolution'),
    time: uniform('uTime'),
    intensity: uniform('uIntensity'),
    base: uniform('uBase'),
    bandA: uniform('uBandA'),
    bandB: uniform('uBandB'),
    bandC: uniform('uBandC'),
  }

  // Uploaded as Float32Arrays, built once per palette rather than per frame.
  let base: Float32Array | null = null
  let bandA = new Float32Array(3)
  let bandB = new Float32Array(3)
  let bandC = new Float32Array(3)

  let rafHandle = 0
  let elapsedMs = 0
  let lastFrameMs = 0
  let animate = false

  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const fit = Math.min(1, MAX_EDGE / Math.max(width, height))
    const deviceScale = dpr * fit
    canvas.width = Math.max(1, Math.round(width * deviceScale))
    canvas.height = Math.max(1, Math.round(height * deviceScale))
    gl.viewport(0, 0, canvas.width, canvas.height)
  }

  const draw = (): void => {
    if (!base) return
    gl.useProgram(program)
    gl.uniform2f(locations.resolution, canvas.width, canvas.height)
    gl.uniform1f(locations.time, elapsedMs / 1000)
    gl.uniform1f(locations.intensity, BAND_INTENSITY)
    gl.uniform3fv(locations.base, base)
    gl.uniform3fv(locations.bandA, bandA)
    gl.uniform3fv(locations.bandB, bandB)
    gl.uniform3fv(locations.bandC, bandC)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const paintOnce = (): void => {
    resize()
    draw()
  }

  const step = (now: number): void => {
    rafHandle = window.requestAnimationFrame(step)
    if (now - lastFrameMs < FRAME_INTERVAL_MS) return
    if (lastFrameMs > 0) elapsedMs += now - lastFrameMs
    lastFrameMs = now
    // A hidden tab gets no frames at all; the clock stops with it, so coming
    // back resumes the drift where the user left it instead of jumping.
    if (document.hidden) return
    draw()
  }

  const startLoop = (): void => {
    if (rafHandle) return
    lastFrameMs = 0
    rafHandle = window.requestAnimationFrame(step)
  }

  const stopLoop = (): void => {
    if (!rafHandle) return
    window.cancelAnimationFrame(rafHandle)
    rafHandle = 0
    lastFrameMs = 0
  }

  // While the loop runs it repaints every frame anyway; only a static field
  // needs to be told the viewport changed.
  const onResize = (): void => {
    if (!animate) paintOnce()
  }
  window.addEventListener('resize', onResize)

  return {
    setPalette(bands: AuroraBands): void {
      base = new Float32Array(bands.base)
      bandA = new Float32Array(bands.bands[0])
      bandB = new Float32Array(bands.bands[1])
      bandC = new Float32Array(bands.bands[2])
      if (!animate) paintOnce()
    },
    setMotion(next: boolean): void {
      animate = next
      if (next) startLoop()
      else {
        stopLoop()
        paintOnce()
      }
    },
    dispose(): void {
      stopLoop()
      window.removeEventListener('resize', onResize)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

export interface AuroraFieldProps {
  /** Token name of the open workspace family, e.g. `--chart-2`. */
  accentToken?: string
}

export function AuroraField({ accentToken }: AuroraFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sessionRef = useRef<AuroraSession | null>(null)
  const [hasGl, setHasGl] = useState(false)
  const { theme } = useTheme()
  const animations = useAppStore((state) => state.settings.animations)
  const ambientLight = useAppStore((state) => state.settings.ambientLight)
  // One gate for every way the field is refused: the user's switch, the theme's
  // contrast contract, and the absence of a palette. Null means no canvas, no
  // `data-aurora`, and chrome bars that paint solid again.
  const bands = useMemo(
    () => (ambientLight ? auroraBands(theme, accentToken) : null),
    [ambientLight, theme, accentToken],
  )

  // The chrome reads its alpha from `--chrome-ambient-alpha`, which is only
  // declared while the attribute is set: no field, fully solid bars.
  useEffect(() => {
    if (!bands) return
    const root = document.documentElement
    root.dataset.aurora = 'on'
    return () => {
      root.removeAttribute('data-aurora')
    }
  }, [bands])

  // Keyed on visibility, not on the palette: switching workspace families
  // changes the colours, and repainting is the palette effect's job. Building a
  // context per family switch would flash the shell for no reason.
  const fieldIsLit = bands !== null
  useEffect(() => {
    const canvas = canvasRef.current
    if (!fieldIsLit || !canvas) return
    const session = createSession(canvas)
    if (!session) return
    sessionRef.current = session
    setHasGl(true)
    return () => {
      session.dispose()
      sessionRef.current = null
      setHasGl(false)
    }
  }, [fieldIsLit])

  useEffect(() => {
    const session = sessionRef.current
    if (!session || !bands) return
    session.setPalette(bands)
    session.setMotion(animations && !prefersReducedMotion())
  }, [bands, animations, hasGl])

  if (!bands) return null

  return (
    <div className="folio-aurora" data-engine={hasGl ? 'gl' : 'css'} aria-hidden="true">
      <canvas ref={canvasRef} className="folio-aurora__canvas" />
    </div>
  )
}
