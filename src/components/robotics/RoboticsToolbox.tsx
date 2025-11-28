import { useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Cylinder, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Play,
  Pause,
  RotateCcw,
  Settings,
  Zap,
  Cpu,
  Gauge,
  X,
  Download,
  Upload
} from 'lucide-react';

interface RoboticsToolboxProps {
  onClose: () => void;
}

interface RobotJoint {
  id: string;
  name: string;
  type: 'revolute' | 'prismatic' | 'fixed';
  position: [number, number, number];
  rotation: [number, number, number];
  limits: { min: number; max: number };
  currentValue: number;
  velocity: number;
  torque: number;
}

interface RobotLink {
  id: string;
  name: string;
  length: number;
  mass: number;
  inertia: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
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
  endEffector: {
    position: [number, number, number];
    orientation: [number, number, number];
  };
}

// Robot arm component
function RobotArm({ config }: {
  config: RobotConfiguration;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      // Update joint positions based on configuration
      config.joints.forEach((joint, index) => {
        const child = groupRef.current?.children[index];
        if (child && joint.type === 'revolute') {
          child.rotation.z = joint.currentValue;
        }
      });
    }
  });

  return (
    <group ref={groupRef}>
      {config.links.map((link, index) => (
        <group key={link.id} position={link.position} rotation={link.rotation}>
          {/* Link representation */}
          <Cylinder
            args={[0.1, 0.1, link.length, 8]}
            position={[0, link.length / 2, 0]}
          >
            <meshStandardMaterial color="#4A90E2" />
          </Cylinder>
          
          {/* Joint representation */}
          {index < config.joints.length && (
            <Sphere args={[0.15]} position={[0, link.length, 0]}>
              <meshStandardMaterial color="#E94B3C" />
            </Sphere>
          )}
        </group>
      ))}
      
      {/* End effector */}
      <Box
        args={[0.2, 0.2, 0.2]}
        position={config.endEffector.position}
        rotation={config.endEffector.orientation}
      >
        <meshStandardMaterial color="#50C878" />
      </Box>
    </group>
  );
}

// Sensor visualization
function SensorVisualization({ sensors }: { sensors: Sensor[] }) {
  return (
    <group>
      {sensors.map(sensor => (
        <group key={sensor.id} position={sensor.position}>
          {/* Sensor body */}
          <Box args={[0.1, 0.1, 0.1]}>
            <meshStandardMaterial 
              color={sensor.active ? "#FFD700" : "#808080"} 
              transparent
              opacity={0.8}
            />
          </Box>
          
          {/* Sensor range visualization */}
          {sensor.type === 'ultrasonic' && sensor.active && (
            <Cylinder
              args={[0, sensor.range * Math.tan(Math.PI / 12), sensor.range, 8]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <meshStandardMaterial 
                color="#00FF00" 
                transparent 
                opacity={0.2} 
                wireframe
              />
            </Cylinder>
          )}
          
          {sensor.type === 'lidar' && sensor.active && (
            <Sphere args={[sensor.range]} position={[0, 0, 0]}>
              <meshStandardMaterial 
                color="#FF00FF" 
                transparent 
                opacity={0.1} 
                wireframe
              />
            </Sphere>
          )}
        </group>
      ))}
    </group>
  );
}

// Environment obstacles
function Environment() {
  const obstacles = [
    { position: [2, 0, 0], size: [0.5, 2, 0.5] },
    { position: [-1.5, 0, 1], size: [1, 1, 1] },
    { position: [0, 0, -2], size: [2, 0.1, 2] }
  ];

  return (
    <group>
      {/* Ground plane */}
      <Box args={[10, 0.1, 10]} position={[0, -0.05, 0]}>
        <meshStandardMaterial color="#CCCCCC" />
      </Box>
      
      {/* Obstacles */}
      {obstacles.map((obstacle, index) => (
        <Box
          key={index}
          args={obstacle.size}
          position={obstacle.position}
        >
          <meshStandardMaterial color="#8B4513" />
        </Box>
      ))}
    </group>
  );
}

export default function RoboticsToolbox({ onClose }: RoboticsToolboxProps) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedRobot, setSelectedRobot] = useState('6dof_arm');
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [showSensors, setShowSensors] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(false);
  
  // Default 6-DOF robot arm configuration
  const [robotConfig, setRobotConfig] = useState<RobotConfiguration>({
    name: '6-DOF Robot Arm',
    joints: [
      { id: 'j1', name: 'Base', type: 'revolute', position: [0, 0, 0], rotation: [0, 0, 0], limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 },
      { id: 'j2', name: 'Shoulder', type: 'revolute', position: [0, 1, 0], rotation: [0, 0, 0], limits: { min: -Math.PI/2, max: Math.PI/2 }, currentValue: 0, velocity: 0, torque: 0 },
      { id: 'j3', name: 'Elbow', type: 'revolute', position: [0, 2, 0], rotation: [0, 0, 0], limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 },
      { id: 'j4', name: 'Wrist1', type: 'revolute', position: [0, 3, 0], rotation: [0, 0, 0], limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 },
      { id: 'j5', name: 'Wrist2', type: 'revolute', position: [0, 3.5, 0], rotation: [0, 0, 0], limits: { min: -Math.PI/2, max: Math.PI/2 }, currentValue: 0, velocity: 0, torque: 0 },
      { id: 'j6', name: 'Wrist3', type: 'revolute', position: [0, 4, 0], rotation: [0, 0, 0], limits: { min: -Math.PI, max: Math.PI }, currentValue: 0, velocity: 0, torque: 0 }
    ],
    links: [
      { id: 'l1', name: 'Base Link', length: 1, mass: 5, inertia: [0.1, 0.1, 0.1], position: [0, 0, 0], rotation: [0, 0, 0] },
      { id: 'l2', name: 'Upper Arm', length: 1, mass: 3, inertia: [0.05, 0.05, 0.05], position: [0, 1, 0], rotation: [0, 0, 0] },
      { id: 'l3', name: 'Forearm', length: 1, mass: 2, inertia: [0.03, 0.03, 0.03], position: [0, 2, 0], rotation: [0, 0, 0] },
      { id: 'l4', name: 'Wrist Link', length: 0.5, mass: 1, inertia: [0.01, 0.01, 0.01], position: [0, 3, 0], rotation: [0, 0, 0] }
    ],
    sensors: [
      { id: 's1', name: 'End Effector Camera', type: 'camera', position: [0, 4, 0], range: 5, accuracy: 0.95, value: [640, 480], active: true },
      { id: 's2', name: 'Joint Encoders', type: 'encoder', position: [0, 0, 0], range: 0, accuracy: 0.99, value: 0, active: true },
      { id: 's3', name: 'Force Sensor', type: 'force', position: [0, 4, 0], range: 100, accuracy: 0.98, value: [0, 0, 0], active: true }
    ],
    endEffector: {
      position: [0, 4, 0],
      orientation: [0, 0, 0]
    }
  });

  const handleJointChange = (jointId: string, value: number) => {
    setRobotConfig(prev => ({
      ...prev,
      joints: prev.joints.map(joint =>
        joint.id === jointId ? { ...joint, currentValue: value } : joint
      )
    }));
  };

  const handleStartSimulation = () => {
    setIsSimulating(true);
    // Start physics simulation loop
  };

  const handleStopSimulation = () => {
    setIsSimulating(false);
  };

  const handleResetRobot = () => {
    setRobotConfig(prev => ({
      ...prev,
      joints: prev.joints.map(joint => ({ ...joint, currentValue: 0, velocity: 0, torque: 0 }))
    }));
  };

  const handleLoadRobotConfig = () => {
    // Load robot configuration from file
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const config = JSON.parse(e.target?.result as string);
            setRobotConfig(config);
          } catch (error) {
            console.error('Failed to load robot configuration:', error);
          }
        };
        reader.readAsText(file);
      }
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* 3D Simulation Viewport */}
        <div className="flex-1 relative">
          <Canvas
            shadows
            camera={{ position: [5, 5, 5], fov: 50 }}
            style={{ background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' }}
          >
            <ambientLight intensity={0.4} />
            <directionalLight 
              position={[10, 10, 5]} 
              intensity={1} 
              castShadow
            />
            <pointLight position={[-10, -10, -10]} intensity={0.3} />
            
            <Environment />
            <RobotArm config={robotConfig} />
            {showSensors && <SensorVisualization sensors={robotConfig.sensors} />}
            
            <OrbitControls 
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
            />
          </Canvas>

          {/* Simulation Controls Overlay */}
          <div className="absolute top-4 left-4 flex gap-2">
            <Button
              onClick={isSimulating ? handleStopSimulation : handleStartSimulation}
              variant={isSimulating ? 'destructive' : 'default'}
              className="flex items-center gap-2"
            >
              {isSimulating ? (
                <>
                  <Pause className="w-4 h-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start
                </>
              )}
            </Button>
            
            <Button
              onClick={handleResetRobot}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>

          {/* Status Overlay */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Robot: {robotConfig.name}</div>
              <div>Joints: {robotConfig.joints.length}</div>
              <div>Status: {isSimulating ? 'Running' : 'Stopped'}</div>
              <div>Speed: {simulationSpeed}x</div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-96 bg-card border-l border-border flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Robotics Toolbox</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Robot Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Robot Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  value={selectedRobot}
                  onChange={(e) => setSelectedRobot(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                >
                  <option value="6dof_arm">6-DOF Robot Arm</option>
                  <option value="scara">SCARA Robot</option>
                  <option value="delta">Delta Robot</option>
                  <option value="mobile">Mobile Robot</option>
                </select>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadRobotConfig}
                    className="flex-1 flex items-center gap-2"
                  >
                    <Upload className="w-3 h-3" />
                    Load
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveRobotConfig}
                    className="flex-1 flex items-center gap-2"
                  >
                    <Download className="w-3 h-3" />
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Joint Control */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Joint Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {robotConfig.joints.map(joint => (
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
                      onChange={(e) => handleJointChange(joint.id, parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Velocity: </span>
                        <span>{joint.velocity.toFixed(2)} rad/s</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Torque: </span>
                        <span>{joint.torque.toFixed(2)} Nm</span>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Sensors */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Sensors
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Sensors</span>
                  <input
                    type="checkbox"
                    checked={showSensors}
                    onChange={(e) => setShowSensors(e.target.checked)}
                    className="rounded"
                  />
                </div>
                
                {robotConfig.sensors.map(sensor => (
                  <div key={sensor.id} className="p-2 border border-border rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{sensor.name}</span>
                      <input
                        type="checkbox"
                        checked={sensor.active}
                        onChange={(e) => {
                          setRobotConfig(prev => ({
                            ...prev,
                            sensors: prev.sensors.map(s =>
                              s.id === sensor.id ? { ...s, active: e.target.checked } : s
                            )
                          }));
                        }}
                        className="rounded"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>Type: {sensor.type}</div>
                      <div>Range: {sensor.range}m</div>
                      <div>Accuracy: {(sensor.accuracy * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Simulation Settings */}
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
                    onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="text-xs text-muted-foreground">{simulationSpeed}x</div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-xs">Show Trajectory</span>
                  <input
                    type="checkbox"
                    checked={showTrajectory}
                    onChange={(e) => setShowTrajectory(e.target.checked)}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-xs">Physics Engine</span>
                  <select className="px-2 py-1 text-xs border border-input rounded">
                    <option>Bullet</option>
                    <option>ODE</option>
                    <option>Custom</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Gauge className="w-4 h-4" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>FPS:</span>
                  <span>60</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Physics Step:</span>
                  <span>1ms</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Collision Checks:</span>
                  <span>1,234</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Memory Usage:</span>
                  <span>45MB</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}