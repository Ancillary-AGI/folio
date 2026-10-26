import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Slider } from '../ui/slider';
import { Badge } from '../ui/badge';
import { advancedRobotics, Mechanism, Joint, Trajectory, KinematicsResult, DynamicsResult } from '../../lib/robotics/advancedRobotics';
import {
  describeMechanism,
  exportMechanismStep,
  type LinkMeasurement,
} from '../../lib/robotics/mechanismExport';
import { buildDemoArm, buildSixDofDemoMechanism, buildTwoLinkDemoMechanism } from '../../lib/demo/demoArm';
import { useDemoRequest } from '../workspace/useDemoRequest';
import type { Finding } from '../../lib/robotics/manufacturability';
import { checkTaskPath } from '../../lib/robotics/taskCheck';
import RoboticsToolbox from './RoboticsToolbox';
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign';

interface AdvancedRoboticsPanelProps {
  onClose?: () => void;
}

interface RoboticsDesign {
  selectedMechanismId?: string | null;
  jointAngles?: number[];
  targetPosition?: { x: number; y: number; z: number };
  clearanceEnabled?: boolean;
  obstacle?: { x: number; y: number; z: number; size: number };
}

const roboticsNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function roboticsPoint(
  value: unknown,
  fallback: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;
  return {
    x: roboticsNumber(raw.x, fallback.x),
    y: roboticsNumber(raw.y, fallback.y),
    z: roboticsNumber(raw.z, fallback.z),
  };
}

/** Saves text to the user's disk, cleaning the object URL immediately. */
function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Joint values are radians/metres in the solver. The UI shows degrees for
 * revolute joints and millimetres for prismatic joints, and converts back on
 * input — showing a 0.1 m gripper travel as "5.7°" would mislead the operator.
 */
function jointToDisplay(joint: Joint, value: number): number {
  return joint.type === 'prismatic' ? value * 1000 : (value * 180) / Math.PI;
}

function jointFromDisplay(joint: Joint, value: number): number {
  return joint.type === 'prismatic' ? value / 1000 : (value * Math.PI) / 180;
}

function formatJointValue(joint: Joint | undefined, value: number): string {
  if (joint?.type === 'prismatic') return `${(value * 1000).toFixed(1)} mm`;
  return `${((value * 180) / Math.PI).toFixed(1)}°`;
}

const VIEW_DIRECTION = new THREE.Vector3(1, 0.55, 1).normalize();

/** Frames the arm from its reachable workspace so a 0.7 m arm fills the view. */
function cameraFit(mechanism: Mechanism): { center: THREE.Vector3; distance: number } {
  const box = mechanism.workspace.reachable;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 0.5);
  return { center, distance: extent * 1.5 };
}

/**
 * Fits the view when a mechanism is selected. Joint sliders deliberately do
 * not re-frame: a camera that chases the tool would make the arm impossible
 * to inspect while dragging a slider.
 */
const CameraFit: React.FC<{ mechanism: Mechanism | null }> = ({ mechanism }) => {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!mechanism) return;
    const { center, distance } = cameraFit(mechanism);
    camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [mechanism, camera, controls]);

  return null;
};

export const AdvancedRoboticsPanel: React.FC<AdvancedRoboticsPanelProps> = ({ onClose }) => {
  const saved = loadDomainDesign<RoboticsDesign>('robotics');
  const [mechanisms, setMechanisms] = useState<Mechanism[]>([]);
  const [selectedMechanism, setSelectedMechanism] = useState<Mechanism | null>(null);
  const [jointAngles, setJointAngles] = useState<number[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [, setSimulationResults] = useState<ReturnType<typeof advancedRobotics.simulateMechanism>>([]);
  const [targetPosition, setTargetPosition] = useState(() =>
    roboticsPoint(saved?.targetPosition, { x: 0.5, y: 0.3, z: 0.2 }),
  );
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [plannedMove, setPlannedMove] = useState<{ start: number[]; target: number[] } | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [kinematicsResult, setKinematicsResult] = useState<KinematicsResult | null>(null);
  const [dynamicsResult, setDynamicsResult] = useState<DynamicsResult | null>(null);
  const [runMessage, setRunMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  /** Findings from the last refused STEP export; empty when the last export succeeded. */
  const [exportBlocked, setExportBlocked] = useState<Finding[]>([]);
  const [showToolbox, setShowToolbox] = useState(false);
  const [clearanceEnabled, setClearanceEnabled] = useState(saved?.clearanceEnabled === true);
  const [obstacle, setObstacle] = useState(() => {
    const point = roboticsPoint(saved?.obstacle, { x: 0.35, y: 0.2, z: 0.25 });
    return { ...point, size: roboticsNumber((saved?.obstacle as { size?: unknown } | undefined)?.size, 0.16) };
  });
  const [pathResult, setPathResult] = useState<Awaited<ReturnType<typeof checkTaskPath>> | null>(null);
  const [pathBusy, setPathBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  usePublishDomainDesign('robotics', {
    selectedMechanismId: selectedMechanism?.id ?? null,
    jointAngles,
    targetPosition,
    clearanceEnabled,
    obstacle,
  }, (next) => {
    if (typeof next.selectedMechanismId === 'string') {
      const found = mechanisms.find((mechanism) => mechanism.id === next.selectedMechanismId)
        ?? advancedRobotics.getMechanism(next.selectedMechanismId);
      if (found) {
        setSelectedMechanism(found);
        if (!Array.isArray(next.jointAngles)) {
          setJointAngles(Array.from(found.joints.values()).map((joint) => joint.angle));
        }
      }
    }
    if (Array.isArray(next.jointAngles) && next.jointAngles.every((angle) => Number.isFinite(angle))) {
      setJointAngles([...next.jointAngles]);
    }
    setTargetPosition(roboticsPoint(next.targetPosition, { x: 0.5, y: 0.3, z: 0.2 }));
    if (typeof next.clearanceEnabled === 'boolean') setClearanceEnabled(next.clearanceEnabled);
    const point = roboticsPoint(next.obstacle, { x: 0.35, y: 0.2, z: 0.25 });
    setObstacle({
      ...point,
      size: roboticsNumber((next.obstacle as { size?: unknown } | undefined)?.size, 0.16),
    });
    setTrajectory(null);
    setPathResult(null);
    setRunMessage(null);
  });

  const initializeJointAngles = (mechanism: Mechanism) => {
    const angles = Array.from(mechanism.joints.values()).map(joint => joint.angle);
    setJointAngles(angles);
  };

  const loadMechanisms = useCallback(() => {
    const allMechanisms = advancedRobotics.getAllMechanisms();
    setMechanisms(allMechanisms);
    // Select the first mechanism only when nothing is selected yet, so a
    // reload cannot silently discard the user's choice.
    setSelectedMechanism((current) => {
      if (current || allMechanisms.length === 0) return current;
      const first = allMechanisms[0];
      setJointAngles(Array.from(first.joints.values()).map((joint) => joint.angle));
      return first;
    });
  }, []);

  useEffect(() => {
    loadMechanisms();
  }, [loadMechanisms]);

  const createSampleMechanism = () => {
    const mechanism = buildSixDofDemoMechanism();
    loadMechanisms();
    setSelectedMechanism(mechanism);
    initializeJointAngles(mechanism);
  };

  /** Load the planar arm the demo and its card actually describe. */
  const loadTwoLinkDemo = () => {
    const mechanism = buildTwoLinkDemoMechanism();
    loadMechanisms();
    setSelectedMechanism(mechanism);
    initializeJointAngles(mechanism);
    const demo = buildDemoArm();
    setRunMessage({ kind: demo.export.ok ? 'ok' : 'error', text: demo.verdict });
  };

  useDemoRequest('robotics-demo', loadTwoLinkDemo);

  const runForwardKinematics = () => {
    if (!selectedMechanism) return;

    const joints = Array.from(selectedMechanism.joints.values());
    const result = advancedRobotics.forwardKinematics(joints, jointAngles);
    setKinematicsResult(result);

    // Report the tool point (base + end-effector offset), not the last joint frame.
    const pose = advancedRobotics.endEffectorPose(selectedMechanism, jointAngles);
    if (pose) {
      setRunMessage({
        kind: 'ok',
        text: `Tool point at (${pose.position.x.toFixed(3)}, ${pose.position.y.toFixed(3)}, ${pose.position.z.toFixed(3)})`,
      });
    } else if (result.success) {
      setRunMessage({ kind: 'error', text: 'Forward kinematics returned no joint positions.' });
    } else {
      setRunMessage({ kind: 'error', text: result.error ?? 'Forward kinematics failed.' });
    }
  };

  const runInverseKinematics = () => {
    if (!selectedMechanism) return;

    const target = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
    const result = advancedRobotics.inverseKinematics(
      selectedMechanism, target, undefined, 100, 0.001, jointAngles,
    );

    if (result.success) {
      setJointAngles(result.jointAngles);
      // A new pose invalidates any move planned from the previous one.
      setPlannedMove(null);
      setTrajectory(null);
      const joints = Array.from(selectedMechanism.joints.values());
      setRunMessage({
        kind: 'ok',
        text: `IK solved: ${result.jointAngles.map((angle, index) => formatJointValue(joints[index], angle)).join(', ')}`,
      });
    } else {
      setRunMessage({ kind: 'error', text: result.error ?? 'Inverse kinematics failed.' });
    }
  };

  const runDynamicsSimulation = () => {
    if (!selectedMechanism) return;

    const velocities = jointAngles.map(() => 0); // Start from rest
    const accelerations = jointAngles.map(() => 0); // Hold pose (q̈ = 0)
    try {
      const result = advancedRobotics.computeDynamics(
        selectedMechanism, jointAngles, velocities, accelerations,
      );

      setDynamicsResult(result);
      const peakTorque = result.jointTorques.length > 0
        ? Math.max(...result.jointTorques.map(Math.abs))
        : 0;
      setRunMessage({
        kind: 'ok',
        text: `Dynamics at rest (q̈ = 0): energy ${result.totalEnergy.toFixed(3)} J · peak hold torque ${peakTorque.toFixed(3)} N·m`,
      });
    } catch (error) {
      setDynamicsResult(null);
      setRunMessage({ kind: 'error', text: `Dynamics failed: ${(error as Error).message}` });
    }
  };

  const planTrajectory = () => {
    if (!selectedMechanism) return;

    const joints = Array.from(selectedMechanism.joints.values());
    const startConfig = jointAngles;
    // Move each joint 15% of its own travel, pulled inside its limits. The old
    // blanket +π/4 pushed the gripper (0…0.1 m) and every joint already at a
    // stop outside its range, so planning failed instead of demonstrating a move.
    const endConfig = jointAngles.map((angle, index) => {
      const { min, max } = joints[index].limits;
      const span = max - min;
      if (!(span > 0)) return angle;
      const margin = span * 0.05;
      const clamp = (value: number): number =>
        Math.max(min + margin, Math.min(max - margin, value));
      const forward = clamp(angle + span * 0.15);
      return Math.abs(forward - angle) > span * 1e-6
        ? forward
        : clamp(angle - span * 0.15);
    });

    try {
      const trajectory = advancedRobotics.planTrajectory(
        selectedMechanism,
        startConfig,
        endConfig,
        5.0, // 5 seconds
        'quintic'
      );

      setTrajectory(trajectory);
      setPlannedMove({ start: [...startConfig], target: [...endConfig] });
      setRunMessage({
        kind: 'ok',
        text: `Trajectory "${trajectory.name}": ${trajectory.waypoints.length} waypoints · ${trajectory.duration.toFixed(1)} s · ${trajectory.profile} profile`,
      });
    } catch (error) {
      setTrajectory(null);
      setPlannedMove(null);
      setRunMessage({ kind: 'error', text: `Trajectory planning failed: ${(error as Error).message}` });
    }
  };

  const runSimulation = async () => {
    if (!selectedMechanism) return;

    setIsSimulating(true);
    try {
      // Replay the planned move from the pose it was planned at; with no plan,
      // hold the pose the operator currently sees instead of a stored rest pose.
      const replay = plannedMove
        ? { start: plannedMove.start, target: plannedMove.target, profile: trajectory?.profile }
        : { start: [...jointAngles], target: [...jointAngles], profile: 'quintic' as const };
      const results = advancedRobotics.simulateMechanism(
        selectedMechanism.id,
        trajectory?.duration ?? 5,
        0.1,
        replay,
      );
      setSimulationResults(results);

      const contactFrames = results.filter(result => result.collisions.length > 0).length;
      const contactNote = contactFrames > 0
        ? ` · link boxes overlap in ${contactFrames} frame(s) (conservative test)`
        : '';
      // Report the finished result before playback: background tabs throttle
      // timers, and the operator should not have to wait to read the outcome.
      setRunMessage({
        kind: 'ok',
        text: (plannedMove
          ? `Simulation replayed the planned ${trajectory?.profile ?? 'quintic'} move — ${results.length} frames.`
          : `Simulation held the current pose — ${results.length} frames. No move planned.`)
          + contactNote,
      });

      // Animate the simulation
      for (const result of results) {
        setJointAngles(result.jointAngles);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      setSimulationResults([]);
      setRunMessage({ kind: 'error', text: `Simulation failed: ${(error as Error).message}` });
    } finally {
      setIsSimulating(false);
    }
  };

  /**
   * Clearance check for a joint-space move to the target. The IK solution gives
   * the goal pose; the task layer then tests every interpolated tool position
   * against the obstacle. Poses come from the drawn chain, so the reported hit
   * is the geometry the user sees.
   */
  const checkPathToTarget = async () => {
    if (!selectedMechanism) return;
    const target = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
    const ik = advancedRobotics.inverseKinematics(
      selectedMechanism, target, undefined, 100, 0.001, jointAngles,
    );
    if (!ik.success || !ik.jointAngles.length) {
      setPathResult(null);
      setRunMessage({ kind: 'error', text: ik.error ?? 'Inverse kinematics failed; no path to check.' });
      return;
    }

    const joints = Array.from(selectedMechanism.joints.values()).map((joint) => ({
      id: joint.id,
      name: joint.name,
      // Spherical/planar joints are not modelled by this serial task layer; the
      // editor only creates revolute and prismatic joints today.
      type: (joint.type === 'prismatic' ? 'prismatic' : 'revolute') as 'revolute' | 'prismatic',
      axis: { x: joint.axis.x, y: joint.axis.y, z: joint.axis.z },
      position: { x: joint.position.x, y: joint.position.y, z: joint.position.z },
      limits: joint.limits,
    }));
    const links = Array.from(selectedMechanism.links.values()).map((link) => {
      link.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      link.geometry.boundingBox?.getSize(size);
      return {
        id: link.id,
        name: link.name,
        // The pose comes from joint frames; this length only sizes the service
        // record, so the bounding-box extent is the honest scene measurement.
        length: Math.max(size.x, size.y, size.z, 0.01),
        mass: link.mass,
      };
    });

    setPathBusy(true);
    try {
      const result = await checkTaskPath({
        name: selectedMechanism.name,
        joints,
        links,
        startAngles: jointAngles,
        endAngles: ik.jointAngles,
        obstacles: clearanceEnabled
          ? [{
              position: { x: obstacle.x, y: obstacle.y, z: obstacle.z },
              size: { x: obstacle.size, y: obstacle.size, z: obstacle.size },
            }]
          : [],
        samples: 32,
        durationSeconds: 2,
      });
      setPathResult(result);
      setRunMessage({
        kind: result.success ? 'ok' : 'error',
        text: result.success
          ? `Path clear over ${result.waypoints.length} waypoints · tool path ${result.pathLength.toFixed(3)} m`
          : `Path blocked — ${result.collisions} of ${result.waypoints.length} waypoints enter the obstacle's bounding sphere.`,
      });
    } catch (error) {
      setPathResult(null);
      setRunMessage({ kind: 'error', text: `Path check failed: ${(error as Error).message}` });
    } finally {
      setPathBusy(false);
    }
  };

  const exportSTL = () => {
    if (!selectedMechanism) return;

    try {
      // STL coordinates are written in millimetres, the convention slicers use.
      const stlContent = advancedRobotics.exportMechanismSTL(selectedMechanism, jointAngles);
      const blob = new Blob([stlContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedMechanism.name}-mm.stl`;
      link.click();
      URL.revokeObjectURL(url);
      setRunMessage({ kind: 'ok', text: 'STL exported at the current pose in millimetres.' });
    } catch (error) {
      setRunMessage({ kind: 'error', text: `STL export failed: ${(error as Error).message}` });
    }
  };

  /**
   * STEP export, gated. The mechanism is described in plain millimetres from the scene
   * graph — using the same link meshes the STL export emits — then run through the
   * manufacturability gate. A refusal lists the failed checks and downloads nothing.
   */
  const exportStep = () => {
    if (!selectedMechanism) return;
    const size = new THREE.Vector3();
    const measurements: LinkMeasurement[] = Array.from(selectedMechanism.links.values()).map(
      (link, index) => {
        link.geometry.computeBoundingBox();
        const half = link.geometry.boundingBox
          ? link.geometry.boundingBox.getSize(size).multiplyScalar(0.5)
          : new THREE.Vector3(25, 25, 25);
        const joint = Array.from(selectedMechanism.joints.values())[index];
        return {
          id: link.id,
          // Scene units are metres; the export set is millimetres.
          length: half.x * 2 * 1000,
          depth: Math.max(half.y, half.z) * 2 * 1000,
          mass: link.mass,
          angle: jointAngles[index] ?? joint?.angle ?? 0,
          jointMin: joint?.limits.min ?? -Math.PI,
          jointMax: joint?.limits.max ?? Math.PI,
        };
      },
    );

    let described;
    try {
      described = describeMechanism(measurements);
    } catch (error) {
      setRunMessage({ kind: 'error', text: `Cannot export: ${(error as Error).message}` });
      return;
    }

    const result = exportMechanismStep(
      described.links,
      {
        material: { modulus: 3.5e9, yieldStrength: 50e6 },
        printer: { bedWidth: 250, bedDepth: 210, bedHeight: 250 },
        payload: 2,
        joints: described.joints,
      },
      { jointBore: 4, name: selectedMechanism.name },
    );

    if (!result.ok) {
      setExportBlocked(result.findings);
      return;
    }
    setExportBlocked([]);
    downloadText(result.step, `${selectedMechanism.name}.step`, 'application/step');
  };

  const updateJointAngle = (jointIndex: number, angle: number) => {
    const newAngles = [...jointAngles];
    newAngles[jointIndex] = angle;
    setJointAngles(newAngles);
    // Editing the pose invalidates a move planned from the previous one.
    setPlannedMove(null);
    setTrajectory(null);
  };

  return (
    <>
    <div className="flex h-full w-full flex-col lg:flex-row">
      {/* Left Panel - Controls */}
      <div className="max-h-[45%] w-full flex-shrink-0 space-y-4 overflow-y-auto border-b border-border bg-card p-4 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Advanced Robotics</h2>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close robotics panel" title="Close robotics panel">
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
            <Button
              variant="outline"
              className="w-full"
              onClick={loadTwoLinkDemo}
            >
              Load 2-link demo (FK + STEP)
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setShowToolbox(true)}>
              Open mechatronics toolbox
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
                    value={[jointToDisplay(joint, jointAngles[index])]}
                    onValueChange={([value]) => updateJointAngle(index, jointFromDisplay(joint, value))}
                    min={jointToDisplay(joint, joint.limits.min)}
                    max={jointToDisplay(joint, joint.limits.max)}
                    step={1}
                    className="w-full"
                  />
                  <div className="text-xs text-muted-foreground">
                    {formatJointValue(joint, jointAngles[index])}
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
                  aria-label="Target X"
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
                  aria-label="Target Y"
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
                  aria-label="Target Z"
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

            <div className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Clearance obstacle</Label>
                <input
                  type="checkbox"
                  checked={clearanceEnabled}
                  onChange={(e) => setClearanceEnabled(e.target.checked)}
                  aria-label="Enable clearance obstacle"
                  className="rounded"
                />
              </div>
              {clearanceEnabled && (
                <div className="grid grid-cols-4 gap-1">
                  {(['x', 'y', 'z', 'size'] as const).map((key) => (
                    <div key={key}>
                      <Label className="text-[10px] uppercase">{key === 'size' ? 'size' : key}</Label>
                      <Input
                        type="number"
                        step="0.05"
                        value={obstacle[key]}
                        aria-label={`Obstacle ${key}`}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value);
                          setObstacle((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : prev[key] }));
                        }}
                        className="h-7"
                      />
                    </div>
                  ))}
                </div>
              )}
              <Button
                onClick={checkPathToTarget}
                disabled={!selectedMechanism || pathBusy}
                variant="outline"
                size="sm"
                className="w-full"
              >
                {pathBusy ? 'Checking...' : 'Check path to target'}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Interpolates the current pose to the IK solution and tests each tool position
                against the obstacle's bounding sphere.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {(runMessage || kinematicsResult?.success || dynamicsResult || trajectory) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {runMessage && (
                <p role="status" className={runMessage.kind === 'error' ? 'text-destructive' : 'text-foreground'}>
                  {runMessage.text}
                </p>
              )}
              {kinematicsResult?.success && kinematicsResult.positions.length > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>End effector</span>
                    <span className="font-mono">
                      {(() => {
                        const pose = selectedMechanism
                          ? advancedRobotics.endEffectorPose(selectedMechanism, kinematicsResult.jointAngles)
                          : null;
                        const p = pose?.position ?? kinematicsResult.positions[kinematicsResult.positions.length - 1];
                        return `(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`;
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Joints</span>
                    <span className="font-mono">
                      {(() => {
                        const joints = selectedMechanism ? Array.from(selectedMechanism.joints.values()) : [];
                        return kinematicsResult.jointAngles
                          .map((value, index) => formatJointValue(joints[index], value))
                          .join(' ');
                      })()}
                    </span>
                  </div>
                </div>
              )}
              {dynamicsResult && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Total energy</span>
                    <span className="font-mono">{dynamicsResult.totalEnergy.toFixed(3)} J</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Mass-matrix conditioning</span>
                    <span className="font-mono">{dynamicsResult.massMatrixCondition.toFixed(3)}</span>
                  </div>
                  {dynamicsResult.jointTorques.length > 0 && (
                    <div className="flex justify-between">
                      <span>Peak |torque|</span>
                      <span className="font-mono">
                        {Math.max(...dynamicsResult.jointTorques.map(Math.abs)).toFixed(2)} N·m
                      </span>
                    </div>
                  )}
                </div>
              )}
              {trajectory && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Waypoints</span>
                    <span className="font-mono">{trajectory.waypoints.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span className="font-mono">{trajectory.duration.toFixed(1)} s</span>
                  </div>
                </div>
              )}
              {pathResult && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Tool path</span>
                    <span className="font-mono">{pathResult.pathLength.toFixed(3)} m</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Collisions</span>
                    <span className="font-mono">{pathResult.collisions}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Smoothness</span>
                    <span className="font-mono">{pathResult.smoothness.toFixed(3)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              onClick={exportStep}
              variant="outline"
              className="w-full"
              disabled={!selectedMechanism}
            >
              Export STEP (manufacturable check)
            </Button>
            <Button
              onClick={exportSTL}
              variant="ghost"
              className="w-full"
              disabled={!selectedMechanism}
            >
              Export STL
            </Button>

            {/* A refused export names every failed check instead of staying silent. */}
            {exportBlocked.length > 0 && (
              <div
                role="alert"
                className="cad-export-blocked space-y-1 rounded-md border border-destructive/40 p-2"
              >
                <p className="text-xs font-semibold text-destructive">
                  Export refused — {exportBlocked.length} check
                  {exportBlocked.length === 1 ? '' : 's'} failed
                </p>
                <ul className="space-y-1">
                  {exportBlocked.map((finding) => (
                    <li key={`${finding.check}-${finding.subject}`} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{finding.subject}</span>
                      {': '}
                      {finding.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
          camera={{ position: [0.9, 0.55, 1.0], fov: 45, near: 0.01, far: 100 }}
          shadows
        >
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#bcd6ff', '#1f2126', 0.6]} />
          <directionalLight
            position={[4, 6, 3]}
            intensity={1.4}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-2}
            shadow-camera-right={2}
            shadow-camera-top={2}
            shadow-camera-bottom={-2}
            shadow-camera-near={0.1}
            shadow-camera-far={20}
          />

          {/* Ground grid in theme greys; the old 10×10 pale-blue grid dwarfed the arm. */}
          <Grid
            position={[0, -0.001, 0]}
            cellSize={0.05}
            cellThickness={0.6}
            cellColor="#3f3f46"
            sectionSize={0.25}
            sectionThickness={1}
            sectionColor="#63636b"
            fadeDistance={6}
            fadeStrength={1.5}
            infiniteGrid
          />

          {/* Mechanism Visualization */}
          {selectedMechanism && <MechanismVisualization mechanism={selectedMechanism} jointAngles={jointAngles} />}

          {/* Target Position */}
          <mesh position={[targetPosition.x, targetPosition.y, targetPosition.z]}>
            <sphereGeometry args={[0.025, 20, 14]} />
            <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.8} />
          </mesh>

          {/* Clearance obstacle used by the task-path check */}
          {clearanceEnabled && (
            <mesh position={[obstacle.x, obstacle.y, obstacle.z]}>
              <boxGeometry args={[obstacle.size, obstacle.size, obstacle.size]} />
              <meshStandardMaterial color="#c0392b" transparent opacity={0.5} />
            </mesh>
          )}

          {/* Workspace Visualization */}
          {showWorkspace && selectedMechanism && (
            <WorkspaceVisualization workspace={selectedMechanism.workspace} />
          )}

          {/* Trajectory Visualization */}
          {trajectory && <TrajectoryVisualization trajectory={trajectory} />}

          <OrbitControls
            makeDefault
            enablePan
            enableZoom
            enableRotate
            enableDamping
            dampingFactor={0.08}
            minDistance={0.2}
            maxDistance={20}
          />
          <CameraFit mechanism={selectedMechanism} />
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport axisColors={['red', 'green', 'blue']} labelColor="#d4d4d8" />
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
    {showToolbox && <RoboticsToolbox onClose={() => setShowToolbox(false)} />}
    </>
  );
};

// 3D Visualization Components
const MechanismVisualization: React.FC<{ mechanism: Mechanism; jointAngles: number[] }> = ({ mechanism, jointAngles }) => {
  const joints = Array.from(mechanism.joints.values());
  const links = Array.from(mechanism.links.values());

  // Forward kinematics gives each link's joint frame; the link mesh inherits
  // both position and orientation so a rotating joint actually swings its arm.
  const fkResult = advancedRobotics.forwardKinematics(joints, jointAngles);

  if (!fkResult.success) return null;

  const base = mechanism.base.position;
  const last = fkResult.positions.length - 1;
  const toolPosition = last >= 0
    ? fkResult.positions[last].clone()
      .add(mechanism.endEffector.position.clone().applyQuaternion(fkResult.orientations[last]))
    : new THREE.Vector3();

  return (
    <group position={[base.x, base.y, base.z]}>
      {/* Base */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.2, 0.2, 0.1]} />
        <meshPhongMaterial color="#666666" />
      </mesh>

      {/* Links */}
      {links.map((link, index) => {
        const position = fkResult.positions[index];
        const orientation = fkResult.orientations[index];
        if (!position || !orientation) return null;
        return (
          <mesh key={link.id} position={position} quaternion={orientation} castShadow receiveShadow>
            <primitive object={link.geometry} />
            <primitive object={link.material} />
          </mesh>
        );
      })}

      {/* Joints */}
      {joints.map((joint, index) => {
        const position = fkResult.positions[index] ?? joint.position;
        return (
          <mesh key={joint.id} position={position} castShadow>
            <sphereGeometry args={[0.032, 24, 16]} />
            <meshStandardMaterial color="#f97316" metalness={0.35} roughness={0.4} />
          </mesh>
        );
      })}

      {/* Tool point (last joint plus the end-effector offset) */}
      <mesh position={toolPosition}>
        <sphereGeometry args={[0.018, 20, 14]} />
        <meshStandardMaterial color="#22c55e" emissive="#14532d" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
};

const WorkspaceVisualization: React.FC<{ workspace: Mechanism['workspace'] }> = ({ workspace }) => {
  const reachableCenter = workspace.reachable.getCenter(new THREE.Vector3());
  const dexterousCenter = workspace.dexterous.getCenter(new THREE.Vector3());

  return (
    <group>
      {/* Reachable workspace */}
      <mesh position={reachableCenter}>
        <boxGeometry args={[
          workspace.reachable.max.x - workspace.reachable.min.x,
          workspace.reachable.max.y - workspace.reachable.min.y,
          workspace.reachable.max.z - workspace.reachable.min.z
        ]} />
        <meshBasicMaterial color="blue" transparent opacity={0.1} wireframe />
      </mesh>

      {/* Dexterous workspace (heuristic inner box) */}
      <mesh position={dexterousCenter}>
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

  return (
    <Line points={points} color="purple" lineWidth={2} />
  );
};
