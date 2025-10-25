import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { arManager, ARDesignPreview, ARSession } from '../../lib/augmentedReality/augmentedReality';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface ARDesignPreviewProps {
  circuitId: string;
  onClose?: () => void;
}

export const ARDesignPreview: React.FC<ARDesignPreviewProps> = ({ circuitId, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isARSupported, setIsARSupported] = useState<boolean>(false);
  const [arSession, setARSession] = useState<ARSession | null>(null);
  const [preview, setPreview] = useState<ARPreview | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);

  useEffect(() => {
    const checkARSupport = async () => {
      const supported = await arManager.isARSupported();
      setIsARSupported(supported);
    };

    checkARSupport();
  }, []);

  const startARPreview = async () => {
    if (!canvasRef.current) return;

    try {
      const sessionId = `ar-session-${Date.now()}`;
      const session = await arManager.startARSession(sessionId, canvasRef.current);

      if (session) {
        setARSession(session);

        // Create design preview
        const arPreview = arManager.createDesignPreview({
          name: `Circuit ${circuitId} AR Preview`,
          circuitId,
          markers: [],
          lighting: {
            intensity: 1,
            color: '#ffffff',
            shadows: true
          },
          interactions: {
            pinchToZoom: true,
            dragToMove: true,
            tapToSelect: true
          },
          overlays: {
            measurements: true,
            grid: false,
            annotations: true
          }
        });

        setPreview(arPreview);
        setIsActive(true);

        // Start render loop
        const animate = () => {
          if (isActive) {
            arManager.renderARFrame(sessionId);
            requestAnimationFrame(animate);
          }
        };
        animate();
      }
    } catch (error) {
      console.error('Failed to start AR preview:', error);
    }
  };

  const stopARPreview = () => {
    if (arSession) {
      arManager.endARSession(arSession.id);
      setARSession(null);
      setPreview(null);
      setIsActive(false);
    }
  };

  const placeCircuit = () => {
    if (arSession && preview) {
      // Place circuit at origin for now
      arManager.placeCircuitInAR(arSession.id, preview.id, new THREE.Vector3(0, 0, -1));
    }
  };

  const addMeasurementMarker = () => {
    if (preview) {
      arManager.addMarkerToPreview(preview.id, {
        position: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Euler(0, 0, 0),
        scale: new THREE.Vector3(0.1, 0.1, 0.1),
        type: 'measurement',
        data: { value: '0.5V', unit: 'volts' },
        visible: true
      });
    }
  };

  const addAnnotationMarker = () => {
    if (preview) {
      arManager.addMarkerToPreview(preview.id, {
        position: new THREE.Vector3(0.2, 0, 0),
        rotation: new THREE.Euler(0, 0, 0),
        scale: new THREE.Vector3(0.1, 0.1, 0.1),
        type: 'annotation',
        data: { text: 'Power Supply', color: '#ff0000' },
        visible: true
      });
    }
  };

  if (!isARSupported) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>AR Not Supported</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Augmented Reality is not supported on this device or browser.
            Please use a compatible device with WebXR support.
          </p>
          {onClose && (
            <Button onClick={onClose} className="mt-4">
              Close
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>AR Design Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {!isActive ? (
            <Button onClick={startARPreview}>
              Start AR Preview
            </Button>
          ) : (
            <>
              <Button onClick={placeCircuit}>
                Place Circuit
              </Button>
              <Button onClick={addMeasurementMarker}>
                Add Measurement
              </Button>
              <Button onClick={addAnnotationMarker}>
                Add Annotation
              </Button>
              <Button variant="outline" onClick={stopARPreview}>
                Stop Preview
              </Button>
            </>
          )}
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>

        <div className="relative">
          <canvas
            ref={canvasRef}
            className="w-full h-96 border rounded-lg bg-black"
            style={{ display: isActive ? 'block' : 'none' }}
          />
          {!isActive && (
            <div className="w-full h-96 border rounded-lg bg-gray-100 flex items-center justify-center">
              <p className="text-muted-foreground">AR Preview not active</p>
            </div>
          )}
        </div>

        {preview && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold mb-2">Lighting</h4>
              <p>Intensity: {preview.lighting.intensity}</p>
              <p>Shadows: {preview.lighting.shadows ? 'Enabled' : 'Disabled'}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Interactions</h4>
              <p>Pinch to Zoom: {preview.interactions.pinchToZoom ? 'Yes' : 'No'}</p>
              <p>Drag to Move: {preview.interactions.dragToMove ? 'Yes' : 'No'}</p>
              <p>Tap to Select: {preview.interactions.tapToSelect ? 'Yes' : 'No'}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};