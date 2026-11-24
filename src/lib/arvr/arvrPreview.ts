export type PreviewMode = 'orbit' | 'ar' | 'vr';

export interface ARVRSession {
  id: string;
  mode: PreviewMode;
  supported: boolean;
  message: string;
  camera: { fov: number; near: number; far: number };
  tracking: 'none' | 'orientation' | 'six-dof';
}

export class ARVRPreviewService {
  isWebXRAvailable(): boolean {
    return typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { xr?: unknown }).xr);
  }

  createSession(mode: PreviewMode): ARVRSession {
    const xr = this.isWebXRAvailable();
    const supported = mode === 'orbit' || xr;
    return {
      id: `xr_${Date.now()}`,
      mode,
      supported,
      message: supported
        ? `${mode.toUpperCase()} preview ready`
        : 'WebXR is unavailable; falling back to orbit camera',
      camera: { fov: mode === 'vr' ? 90 : 50, near: 0.01, far: 100 },
      tracking: mode === 'orbit' ? 'none' : xr ? 'six-dof' : 'orientation',
    };
  }
}

export const arvrPreviewService = new ARVRPreviewService();
