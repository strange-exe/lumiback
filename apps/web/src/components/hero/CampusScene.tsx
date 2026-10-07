"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import type { ScenePalette } from "@/components/hero/palette";

/** Soft, generously bevelled boxes: the clay look depends on rounded edges catching the light. */
function useRounded(w: number, h: number, d: number, r: number): RoundedBoxGeometry {
  return useMemo(() => new RoundedBoxGeometry(w, h, d, 4, r), [w, h, d, r]);
}

function Clay({
  color,
  emissive,
  intensity = 0,
}: {
  color: string;
  emissive?: string;
  intensity?: number;
}): ReactNode {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.85}
      metalness={0}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={intensity}
    />
  );
}

function Block({
  position,
  size,
  palette,
}: {
  position: [number, number, number];
  size: [number, number, number];
  palette: ScenePalette;
}): ReactNode {
  const body = useRounded(size[0], size[1], size[2], 0.12);
  const roof = useRounded(size[0] + 0.12, 0.16, size[2] + 0.12, 0.07);
  return (
    <group position={position}>
      <mesh geometry={body} position={[0, size[1] / 2, 0]} castShadow receiveShadow>
        <Clay color={palette.block} />
      </mesh>
      <mesh geometry={roof} position={[0, size[1] + 0.06, 0]} castShadow>
        <Clay color={palette.roof} />
      </mesh>
    </group>
  );
}

function Tree({
  position,
  scale = 1,
  palette,
}: {
  position: [number, number, number];
  scale?: number;
  palette: ScenePalette;
}): ReactNode {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 0.45, 12]} />
        <Clay color={palette.trunk} />
      </mesh>
      <mesh position={[0, 0.68, 0]} castShadow>
        <sphereGeometry args={[0.36, 24, 18]} />
        <Clay color={palette.tree} />
      </mesh>
    </group>
  );
}

function Gate({ palette }: { palette: ScenePalette }): ReactNode {
  const pillar = useRounded(0.42, 1.5, 0.42, 0.1);
  const cap = useRounded(0.56, 0.16, 0.56, 0.06);
  const lantern = useRounded(0.22, 0.28, 0.22, 0.07);
  return (
    <group position={[0, 0, -0.55]}>
      {[-0.95, 0.95].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh geometry={pillar} position={[0, 0.75, 0]} castShadow receiveShadow>
            <Clay color={palette.pillar} />
          </mesh>
          <mesh geometry={cap} position={[0, 1.56, 0]} castShadow>
            <Clay color={palette.arch} />
          </mesh>
        </group>
      ))}
      {/* The arch, then the lantern hanging from its crown. */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <torusGeometry args={[0.95, 0.075, 16, 48, Math.PI]} />
        <Clay color={palette.arch} />
      </mesh>
      <mesh position={[0, 2.2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.3, 6]} />
        <Clay color={palette.arch} />
      </mesh>
      <mesh geometry={lantern} position={[0, 1.95, 0]}>
        <Clay color={palette.lantern} emissive={palette.lantern} intensity={0.45} />
      </mesh>
      <pointLight
        position={[0, 1.9, 0.25]}
        color={palette.glow}
        intensity={palette.lamp}
        distance={4}
        decay={2}
      />
    </group>
  );
}

/** "You": a pin hovering over the path outside the gate, with a ring that slowly breathes out. */
function Pin({ palette, still }: { palette: ScenePalette; still: boolean }): ReactNode {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (still) return;
    const t = clock.getElapsedTime();
    if (group.current) group.current.position.y = 1.15 + Math.sin(t * 1.4) * 0.08;
    if (ring.current) {
      const phase = (t * 0.55) % 1;
      ring.current.scale.setScalar(0.6 + phase * 1.6);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - phase);
    }
  });
  return (
    <group position={[0.15, 0, 1.25]}>
      <group ref={group} position={[0, 1.15, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.24, 32, 24]} />
          <Clay color={palette.pin} emissive={palette.pin} intensity={0.35} />
        </mesh>
        <mesh position={[0, -0.3, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[0.17, 0.36, 32]} />
          <Clay color={palette.pin} />
        </mesh>
        <mesh position={[0, 0.02, 0.2]}>
          <sphereGeometry args={[0.085, 16, 12]} />
          <Clay color={palette.glow} emissive={palette.glow} intensity={0.6} />
        </mesh>
      </group>
      <mesh ref={ring} position={[0, 0.27, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.38, 48]} />
        <meshBasicMaterial
          color={palette.pin}
          transparent
          opacity={still ? 0.35 : 0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Turned so the gate faces the camera at a slight angle, with the path coming toward you. */
const BASE_TURN = 0.42;

function Diorama({ palette, still }: { palette: ScenePalette; still: boolean }): ReactNode {
  const root = useRef<THREE.Group>(null);
  const platform = useRounded(5.6, 0.5, 4.4, 0.22);
  const path = useRounded(0.9, 0.06, 2.6, 0.03);

  // Gentle parallax toward the pointer: the scene feels like an object on the desk, not a video.
  useFrame(({ pointer }, delta) => {
    if (still || !root.current) return;
    const targetY = BASE_TURN + pointer.x * 0.18;
    const targetX = pointer.y * -0.05;
    const k = 1 - Math.exp(-delta * 3);
    root.current.rotation.y += (targetY - root.current.rotation.y) * k;
    root.current.rotation.x += (targetX - root.current.rotation.x) * k;
  });

  return (
    <group ref={root} rotation={[0, BASE_TURN, 0]}>
      <mesh geometry={platform} position={[0, -0.25, 0]} receiveShadow castShadow>
        <Clay color={palette.platform} />
      </mesh>
      <mesh geometry={path} position={[0.1, 0.02, 0.55]} receiveShadow>
        <Clay color={palette.path} />
      </mesh>
      <Gate palette={palette} />
      <Block position={[-1.85, 0, -1.35]} size={[1.3, 1.25, 0.95]} palette={palette} />
      <Block position={[1.9, 0, -1.4]} size={[1.1, 0.9, 0.9]} palette={palette} />
      <Tree position={[-2.1, 0, 0.9]} palette={palette} />
      <Tree position={[-1.45, 0, 1.6]} scale={0.75} palette={palette} />
      <Tree position={[2.15, 0, 0.6]} scale={0.9} palette={palette} />
      <Pin palette={palette} still={still} />
    </group>
  );
}

/**
 * The hero's focal object (DESIGN.md: one 3D focal point, matte clay, one light, one camera).
 * Loaded lazily by HeroVisual after first paint; `still` renders one frame and stops.
 */
export default function CampusScene({
  palette,
  still,
  onReady,
}: {
  palette: ScenePalette;
  still: boolean;
  onReady?: () => void;
}): ReactNode {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop={still ? "demand" : "always"}
      camera={{ position: [6.5, 5.5, 8.05], fov: 30, near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0.45, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        onReady?.();
      }}
      aria-hidden="true"
    >
      <hemisphereLight args={["#ffffff", palette.ground, palette.sky]} />
      <directionalLight
        position={[-4, 7, 5]}
        intensity={palette.sun}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-radius={6}
        shadow-bias={-0.0005}
      />
      <Diorama palette={palette} still={still} />
    </Canvas>
  );
}
