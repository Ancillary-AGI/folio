import React, { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Slider } from '../ui/slider';
import { Badge } from '../ui/badge';
import { advancedRobotics, Mechanism, Joint, Link, Trajectory } from '../../lib/robotics/advancedRobotics';

interface AdvancedRoboticsPanelProps {
  onClose?: () => void;
}

export const AdvancedRoboticsPanel: React.FC<AdvancedRoboticsPanelProps> = ({ onClose }) => {
  const [mechanisms, setMechanisms] = useState<Mechanism[]>([]);
  const [selectedMechanism, setSelectedMechanism] = useState<Mechanism | null>(null);
  const [jointAngles, setJointAngles] = useState<number[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [_simulationResults] = useState<unknown[]>([]); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [targetPosition, setTargetPosition] = useState({ x: 0.5, y: 0.3, z: 0.2 });
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadMechanisms();
  }, []);

  const loadMechanisms = () => {
    const allMechanisms = advancedRobotics.getAllMechanisms();
    setMechanisms(allMechanisms);
    if (allMechanisms.length > 0 && !selectedMechanism) {
      setSelectedMechanism(allMechanisms[0]);
      initializeJointAngles(allMechanisms[0]);
    }
  };

  const initializeJointAngles = (mechanism: Mechanism) => {
    const angles = Array.from(mechanism.joints.values()).map(joint => joint.angle);
    setJointAngles(angles);
  };

  const createSampleMechanism = () => {
    // Create a 6-DOF robotic arm
    const joints: Omit<Joint, 'id'>[] = [
      {
        name: 'Base Rotation',
        type: 'revolute',
        position: new THREE.Vector3(0, 0, 0),
        axis: new THREE.Vector3(0, 0, 1),
        limits: { min: -Math.PI, max: Math.PI },
        velocity: 0,
        acceleration: 0,
        torque: 0,
        angle: 0
      },
      {
        name: 'Shoulder',
        type: 'revolute',
        position: new THREE.Vector3(0, 0, 0.1),
        axis: new THREE.Vector3(0, 1, 0),
        limits: { min: -Math.PI/2, max: Math.PI/2 },
        velocity: 0,
        acceleration: 0,
        torque: 0,
        angle: 0
      },
      {
        name: 'Elbow',
        type: 'revolute',
        position: new THREE.Vector3(0, 0.3, 0),
        axis: new THREE.Vector3(0, 1, 0),
        limits: { min: -Math.PI, max: 0 },
        velocity: 0,
        acceleration: 0,
        torque: 0,
        angle: 0
      },
      {
        name: 'Wrist Pitch',
        type: 'revolute',
        position: new THREE.Vector3(0, 0.3, 0),
        axis: new THREE.Vector3(0, 1, 0),
        limits: { min: -Math.PI/2, max: Math.PI/2 },
        velocity: 0,
        acceleration: 0,
        torque: 0,
        angle: 0
      },
      {
        name: 'Wrist Roll',
        type: 'revolute',
        position: new THREE.Vector3(0, 0, 0),
        axis: new THREE.Vector3(1, 0, 0),
        limits: { min: -Math.PI, max: Math.PI },
        velocity: 0,
        acceleration: 0,
        torque: 0,
        angle: 0
      },
      {
        name: 'Gripper',
        type: 'prismatic',
        position: new THREE.Vector3(0, 0, 0),
        axis: new THREE.Vector3(0, 0, 1),
        limits: { min: 0, max: 0.1 },
        velocity: 0,
        acceleration: 0,
        torque: 0,
        angle: 0
      }
    ];

    const links: Omit<Link, 'id'>[] = [
      {
        name: 'Base Link',
        geometry: new THREE.BoxGeometry(0.1, 0.1, 0.1),
        material: new THREE.MeshPhongMaterial({ color: 0x666666 }),
        mass: 2.0,
        centerOfMass: new THREE.Vector3(0, 0, 0),
        inertiaTensor: new THREE.Matrix3(),
        childJoints: []
      },
      {
        name: 'Upper Arm',
        geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.3),
        material: new THREE.MeshPhongMaterial({ color: 0x888888 }),
        mass: 1.5,
        centerOfMass: new THREE.Vector3(0, 0.15, 0),
        inertiaTensor: new THREE.Matrix3(),
        childJoints: []
      },
      {
        name: 'Forearm',
        geometry: new THREE.CylinderGeometry(0.025, 0.025, 0.25),
        material: new THREE.MeshPhongMaterial({ color: 0xaaaaaa }),
        mass: 1.0,
        centerOfMass: new THREE.Vector3(0, 0.125, 0),
        inertiaTensor: new THREE.Matrix3(),
        childJoints: []
      },
      {
        name: 'Wrist',
        geometry: new THREE.SphereGeometry(0.02),
        material: new THREE.MeshPhongMaterial({ color: 0xcccccc }),
        mass: 0.5,
        centerOfMass: new THREE.Vector3(0, 0, 0),
        inertiaTensor: new THREE.Matrix3(),
        childJoints: []
      },
      {
        name: 'Gripper Base',
        geometry: new THREE.BoxGeometry(0.04, 0.04, 0.04),
        material: new THREE.MeshPhongMaterial({ color: 0xdddddd }),
        mass: 0.3,
        centerOfMass: new THREE.Vector3(0, 0, 0),
        inertiaTensor: new THREE.Matrix3(),
        childJoints: []
      },
      {
        name: 'Gripper Fingers',
        geometry: new THREE.BoxGeometry(0.02, 0.08, 0.02),
        material: new THREE.MeshPhongMaterial({ color: 0x444444 }),
        mass: 0.2,
        centerOfMass: new THREE.Vector3(0, 0, 0),
        inertiaTensor: new THREE.Matrix3(),
        childJoints: []
      }
    ];

    const mechanism = advancedRobotics.createMechanism({
      name: '6-DOF Robotic Arm',
      type: 'serial',
      joints,
      links,
      basePosition: new THREE.Vector3(0, 0, 0),
      endEffectorOffset: new THREE.Vector3(0, 0, 0.05)
    });

    loadMechanisms();
    setSelectedMechanism(mechanism);
    initializeJointAngles(mechanism);
  };

  const runForwardKinematics = () => {
    if (!selectedMechanism) return;

    const joints = Array.from(selectedMechanism.joints.values());
    const result = advancedRobotics.forwardKinematics(joints, jointAngles);

    if (result.success) {
      console.log('Forward Kinematics Result:', result);
      // Update 3D visualization
    } else {
      console.error('Forward Kinematics Failed:', result.error);
    }
  };

  const runInverseKinematics = () => {
    if (!selectedMechanism) return;

    const target = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
    const result = advancedRobotics.inverseKinematics(selectedMechanism, target);

    if (result.success) {
      console.log('Inverse Kinematics Result:', result);
      setJointAngles(result.jointAngles);
    } else {
      console.error('Inverse Kinematics Failed:', result.error);
    }
  };

  const runDynamicsSimulation = () => {
    if (!selectedMechanism) return;

    const velocities = jointAngles.map(() => Math.random() * 0.5); // Mock velocities
    const result = advancedRobotics.computeDynamics(selectedMechanism, jointAngles, velocities);

    console.log('Dynamics Result:', result);
  };

  const planTrajectory = () => {
    if (!selectedMechanism) return;

    const startConfig = jointAngles;
    const endConfig = jointAngles.map(angle => angle + Math.PI / 4); // Move to new position

    const trajectory = advancedRobotics.planTrajectory(
      selectedMechanism,
      startConfig,
      endConfig,
      5.0, // 5 seconds
      'quintic'
    );

    setTrajectory(trajectory);
    console.log('Planned Trajectory:', trajectory);
  };

  const runSimulation = async () => {
    if (!selectedMechanism) return;

    setIsSimulating(true);
    const results = advancedRobotics.simulateMechanism(selectedMechanism.id, 10, 0.1);
    setSimulationResults(results);

    // Animate the simulation
    for (const result of results) {
      setJointAngles(result.jointAngles);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setIsSimulating(false);
  };

  const exportSTL = () => {
    if (!selectedMechanism) return;

    const stlContent = advancedRobotics.exportMechanismSTL(selectedMechanism, jointAngles);

    const blob = new Blob([stlContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedMechanism.name}.stl`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateJointAngle = (jointIndex: number, angle: number) => {
    const newAngles = [...jointAngles];
    newAngles[jointIndex] = angle;
    setJointAngles(newAngles);
  };

  return (
    <div className="w-full h-full flex">
      {/* Left Panel - Controls */}
      <div className="w-80 bg-card border-r border-border p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Advanced Robotics</h2>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              ✕
            </Button>
          )}
        </div>

        {/* Mechanism Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Mechanism</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select
              value={selectedMechanism?.id || ''}
              onValueChange={(value) => {
                const mechanism = mechanisms.find(m => m.id === value);
                if (mechanism) {
                  setSelectedMechanism(mechanism);
                  initializeJointAngles(mechanism);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select mechanism" />
              </SelectTrigger>
              <SelectContent>
                {mechanisms.map(mechanism => (
                  <SelectItem key={mechanism.id} value={mechanism.id}>
                    {mechanism.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={createSampleMechanism} className="w-full">
              Create 6-DOF Arm
            </Button>
          </CardContent>
        </Card>

        {/* Joint Controls */}
        {selectedMechanism && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Joint Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from(selectedMechanism.joints.values()).map((joint, index) => (
                <div key={joint.id} className="space-y-2">
                  <Label className="text-xs">{joint.name}</Label>
                  <Slider
                    value={[jointAngles[index] * 180 / Math.PI]}
                    onValueChange={([value]) => updateJointAngle(index, value * Math.PI / 180)}
                    min={joint.limits.min * 180 / Math.PI}
                    max={joint.limits.max * 180 / Math.PI}
                    step={1}
                    className="w-full"
                  />
                  <div className="text-xs text-muted-foreground">
                    {(jointAngles[index] * 180 / Math.PI).toFixed(1)}°
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Kinematics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Kinematics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button onClick={runForwardKinematics} className="w-full">
              Forward Kinematics
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Target X</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={targetPosition.x}
                  onChange={(e) => setTargetPosition(prev => ({ ...prev, x: parseFloat(e.target.value) }))}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Target Y</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={targetPosition.y}
                  onChange={(e) => setTargetPosition(prev => ({ ...prev, y: parseFloat(e.target.value) }))}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Target Z</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={targetPosition.z}
                  onChange={(e) => setTargetPosition(prev => ({ ...prev, z: parseFloat(e.target.value) }))}
                  className="h-8"
                />
              </div>
            </div>
            <Button onClick={runInverseKinematics} variant="outline" className="w-full">
              Inverse Kinematics
            </Button>
          </CardContent>
        </Card>

        {/* Dynamics & Simulation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Dynamics & Simulation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button onClick={runDynamicsSimulation} variant="outline" className="w-full">
              Compute Dynamics
            </Button>
            <Button onClick={planTrajectory} variant="outline" className="w-full">
              Plan Trajectory
            </Button>
            <Button
              onClick={runSimulation}
              disabled={isSimulating}
              className="w-full"
            >
              {isSimulating ? 'Simulating...' : 'Run Simulation'}
            </Button>
          </CardContent>
        </Card>

        {/* Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Export</CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={exportSTL} variant="outline" className="w-full">
              Export STL
            </Button>
          </CardContent>
        </Card>

        {/* Status */}
        {selectedMechanism && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Mechanism Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Type:</span>
                <Badge variant="secondary">{selectedMechanism.type}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span>DOF:</span>
                <span>{selectedMechanism.dof}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Joints:</span>
                <span>{selectedMechanism.joints.size}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Links:</span>
                <span>{selectedMechanism.links.size}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right Panel - 3D Visualization */}
      <div className="flex-1 relative">
        <Canvas
          ref={canvasRef}
          camera={{ position: [2, 2, 2], fov: 50 }}
          style={{ background: '#f0f0f0' }}
        >
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 5]} intensity={1} />

          {/* Grid */}
          <Grid args={[10, 10]} />

          {/* Mechanism Visualization */}
          {selectedMechanism && <MechanismVisualization mechanism={selectedMechanism} jointAngles={jointAngles} />}

          {/* Target Position */}
          <mesh position={[targetPosition.x, targetPosition.y, targetPosition.z]}>
            <sphereGeometry args={[0.02]} />
            <meshBasicMaterial color="red" />
          </mesh>

          {/* Workspace Visualization */}
          {showWorkspace && selectedMechanism && (
            <WorkspaceVisualization workspace={selectedMechanism.workspace} />
          )}

          {/* Trajectory Visualization */}
          {trajectory && <TrajectoryVisualization trajectory={trajectory} />}

          <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport axisColors={['red', 'green', 'blue']} labelColor="black" />
          </GizmoHelper>
        </Canvas>

        {/* Overlay Controls */}
        <div className="absolute top-4 left-4 space-y-2">
          <Button
            variant={showWorkspace ? "default" : "outline"}
            size="sm"
            onClick={() => setShowWorkspace(!showWorkspace)}
          >
            Workspace
          </Button>
        </div>
      </div>
    </div>
  );
};

// 3D Visualization Components
const MechanismVisualization: React.FC<{ mechanism: Mechanism; jointAngles: number[] }> = ({ mechanism, jointAngles }) => {
  const joints = Array.from(mechanism.joints.values());
  const links = Array.from(mechanism.links.values());

  // Forward kinematics to get positions
  const fkResult = advancedRobotics.forwardKinematics(joints, jointAngles);

  if (!fkResult.success) return null;

  return (
    <group>
      {/* Base */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.2, 0.2, 0.1]} />
        <meshPhongMaterial color="#666666" />
      </mesh>

      {/* Links */}
      {links.map((link, index) => {
        const position = fkResult.positions[index] || new THREE.Vector3();
        return (
          <mesh key={link.id} position={[position.x, position.y, position.z]}>
            <primitive object={link.geometry} />
            <primitive object={link.material} />
          </mesh>
        );
      })}

      {/* Joints */}
      {joints.map((joint, index) => {
        const position = fkResult.positions[index] || joint.position;
        return (
          <mesh key={joint.id} position={[position.x, position.y, position.z]}>
            <sphereGeometry args={[0.02]} />
            <meshPhongMaterial color="#ff6600" />
          </mesh>
        );
      })}
    </group>
  );
};

const WorkspaceVisualization: React.FC<{ workspace: Mechanism['workspace'] }> = ({ workspace }) => {
  return (
    <group>
      {/* Reachable workspace */}
      <mesh>
        <boxGeometry args={[
          workspace.reachable.max.x - workspace.reachable.min.x,
          workspace.reachable.max.y - workspace.reachable.min.y,
          workspace.reachable.max.z - workspace.reachable.min.z
        ]} />
        <meshBasicMaterial color="blue" transparent opacity={0.1} wireframe />
      </mesh>

      {/* Dexterous workspace */}
      <mesh>
        <boxGeometry args={[
          workspace.dexterous.max.x - workspace.dexterous.min.x,
          workspace.dexterous.max.y - workspace.dexterous.min.y,
          workspace.dexterous.max.z - workspace.dexterous.min.z
        ]} />
        <meshBasicMaterial color="green" transparent opacity={0.2} wireframe />
      </mesh>
    </group>
  );
};

const TrajectoryVisualization: React.FC<{ trajectory: Trajectory }> = ({ trajectory }) => {
  const points = trajectory.waypoints.map(wp => new THREE.Vector3(wp.position.x, wp.position.y, wp.position.z));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="purple" linewidth={2} />
    </line>
  );
};