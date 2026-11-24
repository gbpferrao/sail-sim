import * as THREE from 'three';

export function createBoat() {
  const root = new THREE.Group();

  // Shared wave uniforms so downward (amber) and upward (cyan) propagation waves
  // sweep smoothly across sail -> mast -> hull -> keel and back up.
  const waveUniforms = {
    uDownActive: { value: 0 },
    uDownY: { value: 2.0 },
    uDownOrigin: { value: new THREE.Vector3(0, 1.9, -0.3) },
    uDownRadius: { value: 0.0 },
    uUpActive: { value: 0 },
    uUpY: { value: -1.4 },
  };

  function makeWaveMaterial(options) {
    const mat = new THREE.MeshStandardMaterial(options);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDownActive = waveUniforms.uDownActive;
      shader.uniforms.uDownY = waveUniforms.uDownY;
      shader.uniforms.uDownOrigin = waveUniforms.uDownOrigin;
      shader.uniforms.uDownRadius = waveUniforms.uDownRadius;
      shader.uniforms.uUpActive = waveUniforms.uUpActive;
      shader.uniforms.uUpY = waveUniforms.uUpY;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vBoatPos;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec4 wp = modelMatrix * vec4(transformed, 1.0);
           vBoatPos = wp.xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vBoatPos;
           uniform float uDownActive;
           uniform float uDownY;
           uniform vec3 uDownOrigin;
           uniform float uDownRadius;
           uniform float uUpActive;
           uniform float uUpY;`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           // Downward propagation wave (amber/orange) from sail hit area -> mast -> hull -> keel
           if (uDownActive > 0.001) {
             float distFromHit = distance(vBoatPos, uDownOrigin);
             float radialBand = exp(-pow((distFromHit - uDownRadius) / 0.34, 2.0));
             float yBand = exp(-pow((vBoatPos.y - uDownY) / 0.32, 2.0));
             float trail = smoothstep(uDownY + 1.1, uDownY, vBoatPos.y) * smoothstep(uDownY - 0.5, uDownY, vBoatPos.y) * 0.25;
             float intensity = max(radialBand * 0.85, yBand) + trail;
             totalEmissiveRadiance += vec3(1.0, 0.48, 0.08) * intensity * uDownActive * 1.45;
           }
           // Upward propagation wave (cyan) from keel -> hull
           if (uUpActive > 0.001) {
             float upBand = exp(-pow((vBoatPos.y - uUpY) / 0.28, 2.0));
             float upTrail = smoothstep(uUpY - 0.9, uUpY, vBoatPos.y) * smoothstep(uUpY + 0.45, uUpY, vBoatPos.y) * 0.25;
             totalEmissiveRadiance += vec3(0.08, 0.88, 1.0) * (upBand + upTrail) * uUpActive * 1.45;
           }`
        );
    };
    return mat;
  }

  // 1. Hull: clean parallelepiped straddling the waterline (y = 0)
  const hullGeo = new THREE.BoxGeometry(1.15, 0.52, 3.6);
  const hullMat = makeWaveMaterial({
    color: 0x334155,
    roughness: 0.45,
    metalness: 0.2,
  });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.set(0, 0.04, 0);
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);

  const hullEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(hullGeo),
    new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 })
  );
  hull.add(hullEdges);

  // Subtle bow pointer on top of the parallelepiped so forward (+Z) is unmistakable
  const bowGeo = new THREE.ConeGeometry(0.18, 0.42, 3);
  bowGeo.rotateX(Math.PI / 2);
  const bowMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const bowMarker = new THREE.Mesh(bowGeo, bowMat);
  bowMarker.position.set(0, 0.33, 1.45);
  root.add(bowMarker);

  // 2. Mast: vertical bar coming up from the parallelepiped
  const mastGeo = new THREE.CylinderGeometry(0.055, 0.068, 2.85, 16);
  const mastMat = makeWaveMaterial({
    color: 0xcbd5e1,
    roughness: 0.35,
    metalness: 0.5,
  });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(0, 1.72, 0.28);
  mast.castShadow = true;
  root.add(mast);

  // 3. Sail: short sail-esque rectangle attached to the mast, pivoting around it
  const sailPivot = new THREE.Group();
  sailPivot.position.set(0, 1.92, 0.28);
  root.add(sailPivot);

  const sailWidth = 1.65;
  const sailHeight = 1.75;
  const sailThickness = 0.055;
  const sailGeo = new THREE.BoxGeometry(sailThickness, sailHeight, sailWidth);
  const sailMat = makeWaveMaterial({
    color: 0xf1f5f9,
    roughness: 0.55,
    metalness: 0.05,
  });
  const sailMesh = new THREE.Mesh(sailGeo, sailMat);
  // Attach leading edge (luff) to the mast, extending aft (-Z)
  sailMesh.position.set(0, 0, -sailWidth * 0.5);
  sailMesh.castShadow = true;
  sailPivot.add(sailMesh);

  const sailEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(sailGeo),
    new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.55 })
  );
  sailMesh.add(sailEdges);

  // 4. Keel: narrow fin below the hull
  const keelWidth = 0.11;
  const keelHeight = 1.45;
  const keelLength = 1.5;
  const keelGeo = new THREE.BoxGeometry(keelWidth, keelHeight, keelLength);
  const keelMat = makeWaveMaterial({
    color: 0x1e293b,
    roughness: 0.4,
    metalness: 0.35,
  });
  const keel = new THREE.Mesh(keelGeo, keelMat);
  keel.position.set(0, -0.22 - keelHeight * 0.5, 0.05);
  keel.castShadow = true;
  root.add(keel);

  const keelEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(keelGeo),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 })
  );
  keel.add(keelEdges);

  return {
    root,
    hull,
    mast,
    sailPivot,
    sailMesh,
    keel,
    waveUniforms,
    dims: {
      sailWidth,
      sailHeight,
      sailThickness,
      keelWidth,
      keelHeight,
      keelLength,
    },
    setSailAngle(deg) {
      sailPivot.rotation.y = THREE.MathUtils.degToRad(deg);
    },
  };
}
