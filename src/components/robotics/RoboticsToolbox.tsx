import { useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Cylinder, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Play, Pause, RotateCcw, Settings, Zap, Cpu, X, Download, Upload } from 'lucide-react';
import { stepJointDynamics } from '../../lib/robotics/jointDynamics';
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign';

interface RoboticsToolboxProps {
  onClose: () => void;
}

type JointAxis = 'x' | 'y' | 'z';

interface RobotJoint {
  id: string;
  name: string;
  type: 'revolute' | 'prismatic';
  axis: JointAxis;
  /** Radians for revolute joints, metres for prismatic joints. */
  limits: { min: number; max: number };
  currentValue: number;
  velocity: number;
  torque: number;
}

interface RobotLink {
  id: string;
  name: string;
  /** Length along the joint frame's +Y axis, metres. */
  length: number;
  mass: number;
  inertia: [number, number, number];
}

interface Sensor {
  id: string;
  name: string;
  type: 'ultrasonic' | 'lidar' | 'camera' | 'imu' | 'encoder' | 'force';
  position: [number, number, number];
  range: number;
  accuracy: number;
  value: number | number[];
  active: boolean;
}

interface RobotConfiguration {
  name: string;
  joints: RobotJoint[];
  links: RobotLink[];
  sensors: Sensor[];
}

/** Serial 6R arm: every joint drives the link (and everything after it). */
const DEFAULT_ROBOT: RobotConfiguration = {
  name: '6-DOF Robot Arm',
  joints: [
    { id: 'j1', name: 'Base', type: 'revolute', axis: 'y', limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 },
    { id: 'j2', name: 'Shoulder', type: 'revolute', axis: 'x', limits: { min: -Math.PI / 2, max: Math.PI / 2 }, currentValue: 0, velocity: 0, torque: 0 },
    { id: 'j3', name: 'Elbow', type: 'revolute', axis: 'x', limits: { min: -Math.PI / 2, max: Math.PI / 2 }, currentValue: 0, velocity: 0, torque: 0 },
    { id: 'j4', name: 'Wrist pitch', type: 'revolute', axis: 'x', limits: { min: -Math.PI / 2, max: Math.PI / 2 }, currentValue: 0, velocity: 0, torque: 0 },
    { id: 'j5', name: 'Wrist roll', type: 'revolute', axis: 'y', limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 },
    { id: 'j6', name: 'Tool flange', type: 'revolute', axis: 'z', limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 },
  ],
  links: [
    { id: 'l1', name: 'Base column', length: 0.35, mass: 5, inertia: [0.1, 0.1, 0.1] },
    { id: 'l2', name: 'Upper arm', length: 0.9, mass: 3, inertia: [0.05, 0.05, 0.05] },
    { id: 'l3', name: 'Forearm', length: 0.8, mass: 2, inertia: [0.03, 0.03, 0.03] },
    { id: 'l4', name: 'Wrist link', length: 0.25, mass: 0.8, inertia: [0.01, 0.01, 0.01] },
    { id: 'l5', name: 'Tool adapter', length: 0.15, mass: 0.4, inertia: [0.005, 0.005, 0.005] },
    { id: 'l6', name: 'Flange', length: 0.08, mass: 0.2, inertia: [0.002, 0.002, 0.002] },
  ],
  sensors: [
    { id: 's1', name: 'End effector camera', type: 'camera', position: [0, 0.15, 0], range: 5, accuracy: 0.95, value: [640, 480], active: true },
    { id: 's2', name: 'Joint encoders', type: 'encoder', position: [0, 0, 0], range: 0, accuracy: 0.99, value: 0, active: true },
    { id: 's3', name: 'Force sensor', type: 'force', position: [0, 0, 0], range: 100, accuracy: 0.98, value: [0, 0, 0], active: true },
  ],
};

const AXES: JointAxis[] = ['x', 'y', 'z'];

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Validate a saved configuration before it reaches the scene graph.
 * A malformed file would otherwise index past `links` and crash the canvas.
 */
function parseRobotConfiguration(raw: unknown): RobotConfiguration {
  if (typeof raw !== 'object' || raw === null) throw new Error('Configuration must be an object.');
  const candidate = raw as Partial<RobotConfiguration>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
    throw new Error('Configuration needs a non-empty name.');
  }
  if (!Array.isArray(candidate.joints) || !Array.isArray(candidate.links)) {
    throw new Error('Configuration needs joints and links arrays.');
  }
  if (candidate.joints.length === 0 || candidate.joints.length !== candidate.links.length) {
    throw new Error('Every joint must have exactly one link.');
  }
  const joints = candidate.joints.map((joint, index) => {
    if (typeof joint !== 'object' || joint === null) throw new Error(`Joint ${index + 1} is not an object.`);
    const j = joint as Partial<RobotJoint>;
    if (typeof j.id !== 'string' || typeof j.name !== 'string') throw new Error(`Joint ${index + 1} needs id and name.`);
    if (j.type !== 'revolute' && j.type !== 'prismatic') throw new Error(`Joint ${j.id} has unsupported type "${String(j.type)}".`);
    if (!AXES.includes(j.axis as JointAxis)) throw new Error(`Joint ${j.id} needs axis x, y or z.`);
    const limits = j.limits;
    if (!limits || !Number.isFinite(limits.min) || !Number.isFinite(limits.max) || limits.min >= limits.max) {
      throw new Error(`Joint ${j.id} needs finite limits with min < max.`);
    }
    const currentValue = Number.isFinite(j.currentValue) ? (j.currentValue as number) : 0;
    return {
      id: j.id,
      name: j.name,
      type: j.type,
      axis: j.axis as JointAxis,
      limits: { min: limits.min, max: limits.max },
      currentValue: THREE.MathUtils.clamp(currentValue, limits.min, limits.max),
      velocity: Number.isFinite(j.velocity) ? (j.velocity as number) : 0,
      torque: Number.isFinite(j.torque) ? (j.torque as number) : 0,
    } satisfies RobotJoint;
  });
  const links = candidate.links.map((link, index) => {
    if (typeof link !== 'object' || link === null) throw new Error(`Link ${index + 1} is not an object.`);
    const l = link as Partial<RobotLink>;
    if (typeof l.id !== 'string' || typeof l.name !== 'string') throw new Error(`Link ${index + 1} needs id and name.`);
    if (!Number.isFinite(l.length) || (l.length as number) <= 0) throw new Error(`Link ${l.id} needs a positive length.`);
    if (!Number.isFinite(l.mass) || (l.mass as number) <= 0) throw new Error(`Link ${l.id} needs a positive mass.`);
    if (!isFiniteTuple(l.inertia, 3)) throw new Error(`Link ${l.id} needs a three-component inertia.`);
    return {
      id: l.id,
      name: l.name,
      length: l.length as number,
      mass: l.mass as number,
      inertia: l.inertia as [number, number, number],
    } satisfies RobotLink;
  });
  const sensors: Sensor[] = Array.isArray(candidate.sensors)
    ? candidate.sensors.filter((sensor): sensor is Sensor => {
        if (typeof sensor !== 'object' || sensor === null) return false;
        const s = sensor as Partial<Sensor>;
        return typeof s.id === 'string' && typeof s.name === 'string' && isFiniteTuple(s.position, 3);
      })
    : [];
  return { name: candidate.name.trim(), joints, links, sensors };
}

/**
 * Serial-chain renderer. Each joint is a pivot whose local +Y carries its link
 * and the next joint, so rotating a parent moves the whole distal chain.
 * While running, joints sweep their limits from a shared phase; `valuesRef`
 * exposes the live angles so pausing can commit them back to state.
 */
function RobotArm({
  config,
  isSimulating,
  simulationSpeed,
  dynamics,
  valuesRef,
  velocitiesRef,
}: {
  config: RobotConfiguration;
  isSimulating: boolean;
  simulationSpeed: number;
  dynamics: boolean;
  valuesRef: MutableRefObject<number[]>;
  velocitiesRef: MutableRefObject<number[]>;
}) {
  const pivots = useRef<Array<THREE.Group | null>>([]);
  const phase = useRef(0);

  useFrame((_, delta) => {
    const frameDelta = Math.min(delta, 0.1) * simulationSpeed;
    if (isSimulating) phase.current += frameDelta;
    config.joints.forEach((joint, index) => {
      const pivot = pivots.current[index];
      if (!pivot) return;
      let value: number;
      if (isSimulating && dynamics) {
        const link = config.links[index];
        if (joint.type === 'prismatic') {
          // The pendulum model is angular; a slide keeps its state instead of
          // being fed radians through a metre-scale equation.
          value = valuesRef.current[index] ?? joint.currentValue;
          velocitiesRef.current[index] = 0;
        } else {
          const options = {
            axis: joint.axis,
            linkLength: Math.max(link.length, 1e-3),
            mass: Math.max(link.mass, 1e-3),
            limits: joint.limits,
            damping: 0.8,
          };
          let state = {
            angle: valuesRef.current[index] ?? joint.currentValue,
            velocity: velocitiesRef.current[index] ?? 0,
          };
          // Speed boosts stretch the frame; fixed substeps keep the explicit
          // integrator stable when a frame covers many milliseconds.
          let remaining = Math.max(frameDelta, 1e-4);
          while (remaining > 1e-9) {
            const h = Math.min(remaining, 1 / 240);
            state = stepJointDynamics(state, h, options);
            remaining -= h;
          }
          valuesRef.current[index] = state.angle;
          velocitiesRef.current[index] = state.velocity;
          value = state.angle;
        }
      } else if (isSimulating) {
        const mid = (joint.limits.min + joint.limits.max) / 2;
        const amplitude = (joint.limits.max - joint.limits.min) / 2;
        value = THREE.MathUtils.clamp(
          mid + amplitude * 0.8 * Math.sin(phase.current + index * 0.65),
          joint.limits.min,
          joint.limits.max,
        );
        valuesRef.current[index] = value;
        velocitiesRef.current[index] = 0;
      } else {
        value = joint.currentValue;
        valuesRef.current[index] = value;
        velocitiesRef.current[index] = 0;
      }
      pivot.rotation.set(0, 0, 0);
      pivot.position.set(0, 0, 0);
      if (joint.type === 'revolute') pivot.rotation[joint.axis] = value;
      else pivot.position[joint.axis] = value;
    });
  });

  const renderChain = (index: number): ReactNode => {
    const joint = config.joints[index];
    const link = config.links[index];
    const isTip = index === config.joints.length - 1;
    return (
      <group
        key={joint.id}
        ref={(node) => {
          pivots.current[index] = node;
        }}
      >
        <Sphere args={[0.06]} position={[0, 0, 0]}>
          <meshStandardMaterial color="#E94B3C" />
        </Sphere>
        <Cylinder args={[0.055, 0.045, link.length, 12]} position={[0, link.length / 2, 0]}>
          <meshStandardMaterial color="#4A90E2" />
        </Cylinder>
        {isTip ? (
          <Box args={[0.14, 0.14, 0.14]} position={[0, link.length + 0.07, 0]}>
            <meshStandardMaterial color="#50C878" />
          </Box>
        ) : (
          <group position={[0, link.length, 0]}>{renderChain(index + 1)}</group>
        )}
      </group>
    );
  };

  return <group>{config.joints.length > 0 ? renderChain(0) : null}</group>;
}

function SensorVisualization({ sensors, anchor }: { sensors: Sensor[]; anchor?: [number, number, number] }) {
  return (
    <group position={anchor ?? [0, 0, 0]}>
      {sensors.map((sensor) => (
        <group key={sensor.id} position={sensor.position}>
          <Box args={[0.08, 0.08, 0.08]}>
            <meshStandardMaterial color={sensor.active ? '#FFD700' : '#808080'} transparent opacity={0.8} />
          </Box>
          {sensor.type === 'ultrasonic' && sensor.active && (
            <Cylinder
              args={[0, sensor.range * Math.tan(Math.PI / 12), sensor.range, 8]}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0, sensor.range / 2]}
            >
              <meshStandardMaterial color="#00FF00" transparent opacity={0.2} wireframe />
            </Cylinder>
          )}
          {sensor.type === 'lidar' && sensor.active && (
            <Sphere args={[sensor.range]}>
              <meshStandardMaterial color="#FF00FF" transparent opacity={0.1} wireframe />
            </Sphere>
          )}
        </group>
      ))}
    </group>
  );
}

const OBSTACLES: Array<{ position: [number, number, number]; size: [number, number, number] }> = [
  { position: [2, 0, 0], size: [0.5, 2, 0.5] },
  { position: [-1.5, 0, 1], size: [1, 1, 1] },
  { position: [0, 0, -2], size: [2, 0.1, 2] },
];

function Environment() {
  return (
    <group>
      <Box args={[20, 0.1, 20]} position={[0, -0.05, 0]}>
        <meshStandardMaterial color="#CCCCCC" />
      </Box>
      {OBSTACLES.map((obstacle, index) => (
        <Box key={index} args={obstacle.size} position={obstacle.position}>
          <meshStandardMaterial color="#8B4513" />
        </Box>
      ))}
    </group>
  );
}

export default function RoboticsToolbox({ onClose }: RoboticsToolboxProps) {
  const saved = loadDomainDesign<{ robotConfig?: unknown }>('robotics-toolbox');
  const initialRobot = (() => {
    if (!saved?.robotConfig) return DEFAULT_ROBOT;
    try {
      return parseRobotConfiguration(saved.robotConfig);
    } catch {
      return DEFAULT_ROBOT;
    }
  })();
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [dynamicsMode, setDynamicsMode] = useState(false);
  const [showSensors, setShowSensors] = useState(true);
  const [robotConfig, setRobotConfig] = useState<RobotConfiguration>(initialRobot);
  const [loadError, setLoadError] = useState('');
  const liveValues = useRef<number[]>(initialRobot.joints.map((joint) => joint.currentValue));
  const liveVelocities = useRef<number[]>(initialRobot.joints.map(() => 0));

  usePublishDomainDesign('robotics-toolbox', { robotConfig }, (next) => {
    try {
      const config = parseRobotConfiguration(next.robotConfig);
      setRobotConfig(config);
      setIsSimulating(false);
      liveValues.current = config.joints.map((joint) => joint.currentValue);
      liveVelocities.current = config.joints.map(() => 0);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  });

  const handleJointChange = (jointId: string, value: number) => {
    setRobotConfig((prev) => ({
      ...prev,
      joints: prev.joints.map((joint) =>
        joint.id === jointId ? { ...joint, currentValue: value } : joint,
      ),
    }));
  };

  const handleStartSimulation = () => {
    // Seed from the current pose so starting never jumps the arm.
    liveValues.current = robotConfig.joints.map((joint) => joint.currentValue);
    liveVelocities.current = robotConfig.joints.map(() => 0);
    setIsSimulating(true);
  };

  const handleStopSimulation = () => {
    setIsSimulating(false);
    const paused = liveValues.current;
    setRobotConfig((prev) => ({
      ...prev,
      joints: prev.joints.map((joint, index) => ({
        ...joint,
        currentValue: paused[index] ?? joint.currentValue,
      })),
    }));
    liveVelocities.current = robotConfig.joints.map(() => 0);
  };

  const handleResetRobot = () => {
    setIsSimulating(false);
    liveValues.current = robotConfig.joints.map(() => 0);
    liveVelocities.current = robotConfig.joints.map(() => 0);
    setRobotConfig((prev) => ({
      ...prev,
      joints: prev.joints.map((joint) => ({ ...joint, currentValue: 0, velocity: 0, torque: 0 })),
    }));
  };

  const handleLoadRobotConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const config = parseRobotConfiguration(JSON.parse(String(reader.result)));
          setRobotConfig(config);
          liveValues.current = config.joints.map((joint) => joint.currentValue);
          liveVelocities.current = config.joints.map(() => 0);
          setLoadError('');
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : 'Could not read the configuration.');
        }
      };
      reader.onerror = () => setLoadError('Could not read the file.');
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSaveRobotConfig = () => {
    const dataStr = JSON.stringify(robotConfig, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${robotConfig.name.replace(/\s+/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-overlay/70 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col lg:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          <Canvas
            shadows
            camera={{ position: [3.2, 2.6, 3.2], fov: 50 }}
            style={{ background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' }}
          >
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
            <pointLight position={[-10, -10, -10]} intensity={0.3} />

            <Environment />
            <RobotArm
              config={robotConfig}
              isSimulating={isSimulating}
              simulationSpeed={simulationSpeed}
              dynamics={dynamicsMode}
              valuesRef={liveValues}
              velocitiesRef={liveVelocities}
            />
            {showSensors && <SensorVisualization sensors={robotConfig.sensors} />}

            <OrbitControls enablePan enableZoom enableRotate />
          </Canvas>

          <div className="absolute top-4 left-4 flex gap-2">
            <Button
              onClick={isSimulating ? handleStopSimulation : handleStartSimulation}
              variant={isSimulating ? 'destructive' : 'default'}
              className="flex items-center gap-2"
            >
              {isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isSimulating ? 'Pause' : 'Start'}
            </Button>
            <Button onClick={handleResetRobot} variant="outline" className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>

          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Robot: {robotConfig.name}</div>
              <div>Joints: {robotConfig.joints.length} revolute</div>
              <div>Status: {isSimulating ? 'Running' : 'Stopped'}</div>
              <div>Mode: {dynamicsMode ? 'Gravity dynamics' : 'Kinematic sweep'}</div>
              <div>Speed: {simulationSpeed.toFixed(1)}×</div>
            </div>
          </div>
        </div>

        <div className="flex max-h-[45%] w-full flex-shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-96 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Robotics Toolbox</h3>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close robotics toolbox">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Robot Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {robotConfig.name} · {robotConfig.links.reduce((sum, link) => sum + link.length, 0).toFixed(2)} m reach
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleLoadRobotConfig} className="flex-1 flex items-center gap-2">
                    <Upload className="w-3 h-3" />
                    Load
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveRobotConfig} className="flex-1 flex items-center gap-2">
                    <Download className="w-3 h-3" />
                    Save
                  </Button>
                </div>
                {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Joint Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {robotConfig.joints.map((joint) => (
                  <div key={joint.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{joint.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(joint.currentValue * 180 / Math.PI).toFixed(1)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={joint.limits.min}
                      max={joint.limits.max}
                      step={0.01}
                      value={joint.currentValue}
                      disabled={isSimulating}
                      aria-label={`${joint.name} angle`}
                      onChange={(e) => handleJointChange(joint.id, parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                ))}
                {isSimulating && (
                  <p className="text-xs text-muted-foreground">Joint sliders resume when the simulation is paused.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Sensors
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show sensors</span>
                  <input
                    type="checkbox"
                    checked={showSensors}
                    onChange={(e) => setShowSensors(e.target.checked)}
                    className="rounded"
                    aria-label="Show sensors"
                  />
                </div>
                {robotConfig.sensors.map((sensor) => (
                  <div key={sensor.id} className="p-2 border border-border rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{sensor.name}</span>
                      <input
                        type="checkbox"
                        checked={sensor.active}
                        aria-label={`Enable ${sensor.name}`}
                        onChange={(e) => {
                          setRobotConfig((prev) => ({
                            ...prev,
                            sensors: prev.sensors.map((s) =>
                              s.id === sensor.id ? { ...s, active: e.target.checked } : s,
                            ),
                          }));
                        }}
                        className="rounded"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>Type: {sensor.type}</div>
                      <div>Range: {sensor.range} m</div>
                      <div>Accuracy: {(sensor.accuracy * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  Simulation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-medium">Speed</label>
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={simulationSpeed}
                    aria-label="Simulation speed"
                    onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="text-xs text-muted-foreground">{simulationSpeed.toFixed(1)}×</div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Gravity dynamics</span>
                  <input
                    type="checkbox"
                    checked={dynamicsMode}
                    onChange={(e) => setDynamicsMode(e.target.checked)}
                    aria-label="Gravity dynamics"
                    className="rounded"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {dynamicsMode
                    ? 'Each joint is advanced as a damped pendulum by symplectic Euler; joints spinning about the vertical axis carry no gravitational torque. This is a per-joint model, not a coupled multibody solve.'
                    : 'Each joint tracks a sinusoidal sweep inside its limits; motion propagates through the serial chain.'}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
