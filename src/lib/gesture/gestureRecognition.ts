export interface GesturePoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface Gesture {
  id: string;
  type: 'tap' | 'double_tap' | 'long_press' | 'swipe' | 'pinch' | 'rotate' | 'pan' | 'draw';
  points: GesturePoint[];
  startTime: number;
  endTime?: number;
  velocity?: { x: number; y: number };
  scale?: number;
  rotation?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  confidence: number;
}

export interface GestureConfig {
  tapThreshold: number; // ms
  longPressThreshold: number; // ms
  swipeThreshold: number; // pixels
  pinchThreshold: number; // scale factor
  rotateThreshold: number; // degrees
  multiTouchEnabled: boolean;
  maxPointers: number;
}

export interface GestureHandler {
  onGestureStart?: (gesture: Gesture) => void;
  onGestureUpdate?: (gesture: Gesture) => void;
  onGestureEnd?: (gesture: Gesture) => void;
  onGestureCancel?: (gesture: Gesture) => void;
}

export class GestureRecognizer {
  private canvas: HTMLCanvasElement;
  private config: GestureConfig;
  private handlers: GestureHandler[] = [];
  private activeGestures: Map<string, Gesture> = new Map();
  private touchPoints: Map<number, GesturePoint> = new Map();
  private isListening = false;

  constructor(canvas: HTMLCanvasElement, config: Partial<GestureConfig> = {}) {
    this.canvas = canvas;
    this.config = {
      tapThreshold: 200,
      longPressThreshold: 500,
      swipeThreshold: 50,
      pinchThreshold: 0.1,
      rotateThreshold: 15,
      multiTouchEnabled: true,
      maxPointers: 5,
      ...config
    };

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Touch events
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });

    // Mouse events (for desktop testing)
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
  }

  private handleTouchStart(event: TouchEvent): void {
    event.preventDefault();

    const touches = event.changedTouches;
    for (let i = 0; i < touches.length && i < this.config.maxPointers; i++) {
      const touch = touches[i];
      const point: GesturePoint = {
        x: touch.clientX - this.canvas.offsetLeft,
        y: touch.clientY - this.canvas.offsetTop,
        timestamp: Date.now()
      };

      this.touchPoints.set(touch.identifier, point);
    }

    this.processTouchStart();
  }

  private handleTouchMove(event: TouchEvent): void {
    event.preventDefault();

    const touches = event.changedTouches;
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      if (this.touchPoints.has(touch.identifier)) {
        const point: GesturePoint = {
          x: touch.clientX - this.canvas.offsetLeft,
          y: touch.clientY - this.canvas.offsetTop,
          timestamp: Date.now()
        };

        this.touchPoints.set(touch.identifier, point);
      }
    }

    this.processTouchMove();
  }

  private handleTouchEnd(event: TouchEvent): void {
    event.preventDefault();

    const touches = event.changedTouches;
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      this.touchPoints.delete(touch.identifier);
    }

    this.processTouchEnd();
  }

  private handleTouchCancel(event: TouchEvent): void {
    event.preventDefault();

    const touches = event.changedTouches;
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      this.touchPoints.delete(touch.identifier);
    }

    this.cancelActiveGestures();
  }

  private handleMouseDown(event: MouseEvent): void {
    const point: GesturePoint = {
      x: event.clientX - this.canvas.offsetLeft,
      y: event.clientY - this.canvas.offsetTop,
      timestamp: Date.now()
    };

    this.touchPoints.set(0, point);
    this.processTouchStart();
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.touchPoints.has(0)) {
      const point: GesturePoint = {
        x: event.clientX - this.canvas.offsetLeft,
        y: event.clientY - this.canvas.offsetTop,
        timestamp: Date.now()
      };

      this.touchPoints.set(0, point);
      this.processTouchMove();
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    this.touchPoints.delete(0);
    this.processTouchEnd();
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    // Handle pinch-to-zoom simulation with wheel
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const centerX = event.clientX - this.canvas.offsetLeft;
    const centerY = event.clientY - this.canvas.offsetTop;

    const gesture: Gesture = {
      id: `wheel-${Date.now()}`,
      type: 'pinch',
      points: [{
        x: centerX,
        y: centerY,
        timestamp: Date.now()
      }],
      startTime: Date.now(),
      scale: delta,
      confidence: 1.0
    };

    this.notifyGestureStart(gesture);
    this.notifyGestureEnd(gesture);
  }

  private processTouchStart(): void {
    const points = Array.from(this.touchPoints.values());

    if (points.length === 1) {
      // Single touch - potential tap, long press, or start of swipe/pan
      const gesture: Gesture = {
        id: `gesture-${Date.now()}`,
        type: 'tap', // Will be determined on end
        points: [points[0]],
        startTime: points[0].timestamp,
        confidence: 1.0
      };

      this.activeGestures.set(gesture.id, gesture);
      this.notifyGestureStart(gesture);

      // Set timeout for long press
      setTimeout(() => {
        if (this.activeGestures.has(gesture.id)) {
          const activeGesture = this.activeGestures.get(gesture.id)!;
          if (activeGesture.points.length === 1) {
            activeGesture.type = 'long_press';
            this.notifyGestureUpdate(activeGesture);
          }
        }
      }, this.config.longPressThreshold);

    } else if (points.length === 2 && this.config.multiTouchEnabled) {
      // Two touches - potential pinch or rotate
      const gesture: Gesture = {
        id: `gesture-${Date.now()}`,
        type: 'pinch',
        points: [...points],
        startTime: Math.min(...points.map(p => p.timestamp)),
        confidence: 1.0
      };

      this.activeGestures.set(gesture.id, gesture);
      this.notifyGestureStart(gesture);
    }
  }

  private processTouchMove(): void {
    const points = Array.from(this.touchPoints.values());

    for (const gesture of this.activeGestures.values()) {
      const currentPoints = points.slice(0, gesture.points.length);
      gesture.points = currentPoints;
      gesture.endTime = Date.now();

      if (gesture.type === 'tap' && currentPoints.length === 1) {
        // Check if it became a pan/swipe
        const startPoint = gesture.points[0];
        const currentPoint = currentPoints[0];
        const distance = Math.sqrt(
          Math.pow(currentPoint.x - startPoint.x, 2) +
          Math.pow(currentPoint.y - startPoint.y, 2)
        );

        if (distance > 10) { // Minimum movement threshold
          gesture.type = 'pan';
          gesture.velocity = {
            x: (currentPoint.x - startPoint.x) / (currentPoint.timestamp - startPoint.timestamp),
            y: (currentPoint.y - startPoint.y) / (currentPoint.timestamp - startPoint.timestamp)
          };
        }
      } else if (gesture.type === 'pinch' && currentPoints.length === 2) {
        // Calculate pinch scale and rotation
        const [p1, p2] = gesture.points;
        const [c1, c2] = currentPoints;

        const initialDistance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        const currentDistance = Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));

        gesture.scale = currentDistance / initialDistance;

        // Calculate rotation
        const initialAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const currentAngle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
        gesture.rotation = (currentAngle - initialAngle) * (180 / Math.PI);
      }

      this.notifyGestureUpdate(gesture);
    }
  }

  private processTouchEnd(): void {
    const remainingPoints = Array.from(this.touchPoints.values());

    for (const [gestureId, gesture] of this.activeGestures) {
      if (remainingPoints.length === 0 || gesture.points.length > remainingPoints.length) {
        // Gesture ended
        gesture.endTime = Date.now();

        // Determine final gesture type
        if (gesture.type === 'tap') {
          const duration = gesture.endTime - gesture.startTime;
          if (duration < this.config.tapThreshold) {
            // Check for double tap
            const recentTaps = Array.from(this.activeGestures.values())
              .filter(g => g.type === 'tap' && g.endTime &&
                gesture.startTime - g.endTime! < 300); // 300ms window

            if (recentTaps.length > 0) {
              gesture.type = 'double_tap';
            }
          } else if (duration >= this.config.longPressThreshold) {
            gesture.type = 'long_press';
          }
        } else if (gesture.type === 'pan') {
          // Check if it was actually a swipe
          const startPoint = gesture.points[0];
          const endPoint = gesture.points[gesture.points.length - 1];
          const distance = Math.sqrt(
            Math.pow(endPoint.x - startPoint.x, 2) +
            Math.pow(endPoint.y - startPoint.y, 2)
          );

          if (distance > this.config.swipeThreshold) {
            gesture.type = 'swipe';
            gesture.direction = this.calculateDirection(startPoint, endPoint);
          }
        }

        this.notifyGestureEnd(gesture);
        this.activeGestures.delete(gestureId);
      }
    }
  }

  private calculateDirection(start: GesturePoint, end: GesturePoint): 'up' | 'down' | 'left' | 'right' | 'none' {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    } else {
      return dy > 0 ? 'down' : 'up';
    }
  }

  private cancelActiveGestures(): void {
    for (const gesture of this.activeGestures.values()) {
      this.notifyGestureCancel(gesture);
    }
    this.activeGestures.clear();
  }

  private notifyGestureStart(gesture: Gesture): void {
    this.handlers.forEach(handler => {
      handler.onGestureStart?.(gesture);
    });
  }

  private notifyGestureUpdate(gesture: Gesture): void {
    this.handlers.forEach(handler => {
      handler.onGestureUpdate?.(gesture);
    });
  }

  private notifyGestureEnd(gesture: Gesture): void {
    this.handlers.forEach(handler => {
      handler.onGestureEnd?.(gesture);
    });
  }

  private notifyGestureCancel(gesture: Gesture): void {
    this.handlers.forEach(handler => {
      handler.onGestureCancel?.(gesture);
    });
  }

  // Public API
  addGestureHandler(handler: GestureHandler): void {
    this.handlers.push(handler);
  }

  removeGestureHandler(handler: GestureHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index !== -1) {
      this.handlers.splice(index, 1);
    }
  }

  updateConfig(config: Partial<GestureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): GestureConfig {
    return { ...this.config };
  }

  getActiveGestures(): Gesture[] {
    return Array.from(this.activeGestures.values());
  }

  clearActiveGestures(): void {
    this.cancelActiveGestures();
  }

  destroy(): void {
    this.handlers = [];
    this.activeGestures.clear();
    this.touchPoints.clear();

    // Remove event listeners
    this.canvas.removeEventListener('touchstart', this.handleTouchStart.bind(this));
    this.canvas.removeEventListener('touchmove', this.handleTouchMove.bind(this));
    this.canvas.removeEventListener('touchend', this.handleTouchEnd.bind(this));
    this.canvas.removeEventListener('touchcancel', this.handleTouchCancel.bind(this));
    this.canvas.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.removeEventListener('wheel', this.handleWheel.bind(this));
  }
}

// Circuit-specific gesture utilities
export class CircuitGestureHandler implements GestureHandler {
  private onComponentSelect?: (x: number, y: number) => void;
  private onPan?: (dx: number, dy: number) => void;
  private onZoom?: (scale: number, centerX: number, centerY: number) => void;
  private onRotate?: (angle: number) => void;
  private onDraw?: (points: GesturePoint[]) => void;

  constructor(options: {
    onComponentSelect?: (x: number, y: number) => void;
    onPan?: (dx: number, dy: number) => void;
    onZoom?: (scale: number, centerX: number, centerY: number) => void;
    onRotate?: (angle: number) => void;
    onDraw?: (points: GesturePoint[]) => void;
  } = {}) {
    this.onComponentSelect = options.onComponentSelect;
    this.onPan = options.onPan;
    this.onZoom = options.onZoom;
    this.onRotate = options.onRotate;
    this.onDraw = options.onDraw;
  }

  onGestureStart(gesture: Gesture): void {
    // Handle gesture start
  }

  onGestureUpdate(gesture: Gesture): void {
    switch (gesture.type) {
      case 'pan':
        if (this.onPan && gesture.velocity) {
          this.onPan(gesture.velocity.x, gesture.velocity.y);
        }
        break;
      case 'pinch':
        if (this.onZoom && gesture.scale && gesture.points.length > 0) {
          const center = gesture.points[0];
          this.onZoom(gesture.scale, center.x, center.y);
        }
        break;
      case 'rotate':
        if (this.onRotate && gesture.rotation) {
          this.onRotate(gesture.rotation);
        }
        break;
    }
  }

  onGestureEnd(gesture: Gesture): void {
    switch (gesture.type) {
      case 'tap':
        if (this.onComponentSelect && gesture.points.length > 0) {
          const point = gesture.points[0];
          this.onComponentSelect(point.x, point.y);
        }
        break;
      case 'double_tap':
        // Could trigger zoom to fit or similar
        break;
      case 'long_press':
        // Could show context menu
        break;
      case 'swipe':
        // Could navigate between components or views
        break;
      case 'draw':
        if (this.onDraw) {
          this.onDraw(gesture.points);
        }
        break;
    }
  }

  onGestureCancel(gesture: Gesture): void {
    // Handle gesture cancellation
  }
}

export const createCircuitGestureHandler = (options: ConstructorParameters<typeof CircuitGestureHandler>[0]) => {
  return new CircuitGestureHandler(options);
};