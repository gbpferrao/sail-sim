import * as THREE from 'three';
import { VectorArrow } from './vectors.js';

const PHASE_INFO = {
  0: {
    badge: 'ready',
    desc: 'set wind and sail angles, then fire a wind pulse to watch momentum transfer through the boat.',
  },
  1: {
    badge: 'phase 1 · wind',
    desc: 'a pulse of air particles approaches the sail along the chosen wind direction.',
  },
  2: {
    badge: 'phase 2 · sail hits',
    desc: 'air particles strike and deflect off the sail, transferring momentum into a decaying combined sail vector.',
  },
  3: {
    badge: 'phase 3 · down wave',
    desc: 'momentum propagates downward as a wave from the sail hit zone through the mast and hull into the keel.',
  },
  4: {
    badge: 'phase 4 · keel & water',
    desc: 'the keel pushes into the water molecules to its side; water impulses combine into a keel reaction vector.',
  },
  5: {
    badge: 'phase 5 · guided motion',
    desc: 'the keel reaction propagates up into the hull, combining with the sail force to drive guided forward motion.',
  },
};

export class SailSimulation {
  constructor(scene, boat, onPhaseChange) {
    this.scene = scene;
    this.boat = boat;
    this.onPhaseChange = onPhaseChange;

    this.windAngleDeg = 135;
    this.windStrength = 0.3;
    this.sailAngleDeg = -32;
    this.speed = 1.0;
    this.paused = false;

    this.phase = 0;
    this.phaseTime = 0;

    // Physics / vector state
    this.sailAccumVec = new THREE.Vector3();
    this.lockedSailForce = new THREE.Vector3();
    this.sailHitWorld = new THREE.Vector3(0, 1.92, -0.35);
    this.sailHitCount = 0;

    this.keelAccumVec = new THREE.Vector3();
    this.lockedKeelForce = new THREE.Vector3();
    this.netMotionVec = new THREE.Vector3();
    this.waterSide = -1; // -1 = left (-X) of keel by default

    this.boatBasePos = new THREE.Vector3(0, 0, 0);
    this.boatPhase3Offset = new THREE.Vector3();
    this.boatPhase5Start = new THREE.Vector3();

    // 3D Vector arrows
    this.sailArrow = new VectorArrow(0xf97316, { shaftRadius: 0.048, headRadius: 0.13, headLength: 0.32 });
    this.keelArrow = new VectorArrow(0x22d3ee, { shaftRadius: 0.048, headRadius: 0.13, headLength: 0.32 });
    this.netArrow = new VectorArrow(0x4ade80, { shaftRadius: 0.058, headRadius: 0.15, headLength: 0.38 });
    this.hullSailGhost = new VectorArrow(0xf97316, { shaftRadius: 0.032, headRadius: 0.09, headLength: 0.24, opacity: 0.6 });
    this.hullKeelGhost = new VectorArrow(0x22d3ee, { shaftRadius: 0.032, headRadius: 0.09, headLength: 0.24, opacity: 0.6 });

    this.scene.add(
      this.sailArrow.group,
      this.keelArrow.group,
      this.netArrow.group,
      this.hullSailGhost.group,
      this.hullKeelGhost.group
    );

    // Wind particle pool
    this.windParticles = [];
    this.windGroup = new THREE.Group();
    this.scene.add(this.windGroup);
    this._initWindParticles(44);

    // Water molecules cluster (spaced slightly to the left of the keel)
    this.waterMolecules = [];
    this.waterGroup = new THREE.Group();
    this.scene.add(this.waterGroup);
    this._initWaterMolecules(34);

    // Motion trail
    this.trailPoints = [];
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.75 });
    this.trailLine = new THREE.Line(trailGeo, trailMat);
    this.scene.add(this.trailLine);

    this.boat.setSailAngle(this.sailAngleDeg);
    this._positionWaterCluster(-1);
    this._emitPhase(0);
  }

  _initWindParticles(count) {
    const geo = new THREE.SphereGeometry(0.085, 12, 12);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xfde68a,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.4,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.windGroup.add(mesh);
      this.windParticles.push({
        mesh,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        hit: false,
        hitFlash: 0,
        active: false,
      });
    }
  }

  _initWaterMolecules(count) {
    const geo = new THREE.SphereGeometry(0.095, 12, 12);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.35,
        roughness: 0.25,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.waterGroup.add(mesh);

      // Arrange in a staggered 3D cloud beside the keel so the keel sweeps through them gradually
      const row = i % 4;
      const col = Math.floor(i / 4) % 5;
      const layer = Math.floor(i / 20);
      const staggerX = (i / count) * 0.62 + (Math.sin(i * 12.9898) * 0.5) * 0.08;
      const jitterY = (Math.cos(i * 78.233) * 0.5) * 0.12;
      const jitterZ = (Math.sin(i * 39.425) * 0.5) * 0.14;

      this.waterMolecules.push({
        mesh,
        localRest: new THREE.Vector3(
          0.46 + staggerX + layer * 0.06,
          -0.45 - row * 0.32 + jitterY,
          -0.62 + col * 0.34 + jitterZ
        ),
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        hit: false,
        hitFlash: 0,
        bobPhase: i * 0.7,
      });
    }
  }

  _positionWaterCluster(side) {
    this.waterSide = side;
    const base = this.boat.root.position;
    for (const m of this.waterMolecules) {
      m.pos.set(
        base.x + side * m.localRest.x,
        base.y + m.localRest.y,
        base.z + m.localRest.z
      );
      m.vel.set(0, 0, 0);
      m.hit = false;
      m.hitFlash = 0;
      m.mesh.position.copy(m.pos);
      m.mesh.material.color.setHex(0x38bdf8);
      m.mesh.material.emissive.setHex(0x0284c7);
      m.mesh.material.emissiveIntensity = 0.35;
      m.mesh.scale.setScalar(1);
    }
  }

  getWindDir() {
    // Wind direction vector: angle 0 = blowing toward +Z (from stern),
    // 90 = blowing toward +X (from port), 135 = blowing toward -X, -Z (from starboard-bow)
    // Wait: let's make 0° = wind coming from +Z (headwind, blowing -Z),
    // 90° = wind coming from +X (starboard, blowing -X),
    // 135° = wind coming from starboard-quarter/beam? Let's make it super intuitive:
    // windAngleDeg = where the wind is COMING FROM (compass bearing around boat, 0° = bow/+Z, 90° = starboard/+X, 180° = stern/-Z, 270° = port/-X)
    const rad = THREE.MathUtils.degToRad(this.windAngleDeg);
    const fromX = Math.sin(rad);
    const fromZ = Math.cos(rad);
    // Velocity points opposite to "coming from"
    return new THREE.Vector3(-fromX, 0, -fromZ).normalize();
  }

  setWindAngle(deg) {
    this.windAngleDeg = deg;
  }

  setWindStrength(strength) {
    this.windStrength = strength;
  }

  setSailAngle(deg) {
    this.sailAngleDeg = deg;
    this.boat.setSailAngle(deg);
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  reset() {
    this.phase = 0;
    this.phaseTime = 0;
    this.paused = false;

    this.boat.root.position.set(0, 0, 0);
    this.boatBasePos.set(0, 0, 0);
    this.boatPhase3Offset.set(0, 0, 0);
    this.boatPhase5Start.set(0, 0, 0);

    this.sailAccumVec.set(0, 0, 0);
    this.lockedSailForce.set(0, 0, 0);
    this.sailHitCount = 0;
    this.keelAccumVec.set(0, 0, 0);
    this.lockedKeelForce.set(0, 0, 0);
    this.netMotionVec.set(0, 0, 0);

    this.sailArrow.hide();
    this.keelArrow.hide();
    this.netArrow.hide();
    this.hullSailGhost.hide();
    this.hullKeelGhost.hide();

    for (const p of this.windParticles) {
      p.active = false;
      p.mesh.visible = false;
    }

    this.boat.waveUniforms.uDownActive.value = 0;
    this.boat.waveUniforms.uUpActive.value = 0;

    this.trailPoints = [];
    this.trailLine.geometry.setFromPoints([]);

    this._positionWaterCluster(-1);
    this._emitPhase(0);
  }

  firePulse() {
    this.reset();
    this.phase = 1;
    this.phaseTime = 0;

    const windDir = this.getWindDir();
    const perp = new THREE.Vector3(-windDir.z, 0, windDir.x);

    // Sail center in world space
    const sailCenter = new THREE.Vector3();
    this.boat.sailMesh.getWorldPosition(sailCenter);

    const spawnDist = 5.4;
    const baseSpeed = 4.6 * this.windStrength;

    // Spawn a cohesive pulse of air particles upwind of the sail
    for (let i = 0; i < this.windParticles.length; i++) {
      const p = this.windParticles[i];
      const u = ((i % 7) - 3) * 0.28 + (Math.sin(i * 4.3) * 0.08);
      const v = (Math.floor(i / 7) % 3 - 1) * 0.45 + (Math.cos(i * 7.1) * 0.12);
      const along = Math.floor(i / 21) * 0.62 + (Math.sin(i * 11.7) * 0.25);

      p.pos.copy(sailCenter)
        .addScaledVector(windDir, -(spawnDist + along))
        .addScaledVector(perp, u);
      p.pos.y = sailCenter.y + v;

      p.vel.copy(windDir).multiplyScalar(baseSpeed);
      p.hit = false;
      p.hitFlash = 0;
      p.active = true;
      p.mesh.position.copy(p.pos);
      p.mesh.visible = true;
      p.mesh.material.color.setHex(0xfde68a);
      p.mesh.material.emissive.setHex(0xf59e0b);
      p.mesh.material.emissiveIntensity = 0.4;
      p.mesh.scale.setScalar(1);
    }

    this._emitPhase(1);
  }

  _emitPhase(phase) {
    this.phase = phase;
    if (this.onPhaseChange) {
      const info = PHASE_INFO[phase] || PHASE_INFO[0];
      this.onPhaseChange(phase, info.badge, info.desc);
    }
  }

  update(rawDt, elapsed) {
    if (this.paused) return;
    const dt = Math.min(rawDt, 0.05) * this.speed;
    this.phaseTime += dt;

    // Gentle idle bob for water molecules
    if (this.phase < 4) {
      for (const m of this.waterMolecules) {
        m.mesh.position.y = m.pos.y + Math.sin(elapsed * 2.2 + m.bobPhase) * 0.035;
      }
    }

    if (this.phase === 1 || this.phase === 2) {
      this._updateWindAndSail(dt);
    } else if (this.phase === 3) {
      this._updateDownwardWave(dt);
    } else if (this.phase === 4) {
      this._updateKeelWater(dt);
    } else if (this.phase === 5) {
      this._updateUpwardAndMotion(dt);
    }
  }

  _updateWindAndSail(dt) {
    const sailMesh = this.boat.sailMesh;
    sailMesh.updateMatrixWorld(true);
    const invSailMat = new THREE.Matrix4().copy(sailMesh.matrixWorld).invert();
    const sailNormalWorld = new THREE.Vector3(1, 0, 0).transformDirection(sailMesh.matrixWorld).normalize();

    const halfW = this.boat.dims.sailWidth * 0.5 + 0.14;
    const halfH = this.boat.dims.sailHeight * 0.5 + 0.14;
    const hitThickness = 0.22;

    let activeCount = 0;
    let anyHitThisFrame = false;

    for (const p of this.windParticles) {
      if (!p.active) continue;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      if (!p.hit) {
        const localPos = p.pos.clone().applyMatrix4(invSailMat);
        if (
          Math.abs(localPos.x) < hitThickness &&
          Math.abs(localPos.y) < halfH &&
          Math.abs(localPos.z) < halfW
        ) {
          p.hit = true;
          p.hitFlash = 1.0;
          anyHitThisFrame = true;

          // Ensure normal opposes incoming particle velocity
          const n = sailNormalWorld.clone();
          if (n.dot(p.vel) > 0) n.negate();

          // Reflect/deflect particle off sail
          const vDotN = p.vel.dot(n);
          const vOut = p.vel.clone().addScaledVector(n, -1.55 * vDotN);
          // Momentum transferred to sail: deltaP = vIn - vOut (along -n)
          const impulse = p.vel.clone().sub(vOut);
          impulse.y = 0; // Keep horizontal sail force clean
          impulse.multiplyScalar(0.055);

          p.vel.copy(vOut);
          this.sailAccumVec.add(impulse);

          // Track average hit location on sail
          if (this.sailHitCount === 0) {
            this.sailHitWorld.copy(p.pos);
          } else {
            this.sailHitWorld.lerp(p.pos, 0.18);
          }
          this.sailHitCount++;

          p.mesh.material.color.setHex(0xffffff);
          p.mesh.material.emissive.setHex(0xf97316);
          p.mesh.material.emissiveIntensity = 1.6;
          p.mesh.scale.setScalar(1.35);
        }
      } else if (p.hitFlash > 0) {
        p.hitFlash = Math.max(0, p.hitFlash - dt * 2.5);
        p.mesh.scale.setScalar(1 + p.hitFlash * 0.35);
        p.mesh.material.emissiveIntensity = 0.4 + p.hitFlash * 1.2;
      }

      if (p.pos.length() < 11) {
        activeCount++;
      } else {
        p.active = false;
        p.mesh.visible = false;
      }
    }

    // Short decay on accumulated sail vector so user sees impulses combine live
    const decay = Math.exp(-dt * 0.55);
    this.sailAccumVec.multiplyScalar(decay);

    // Keep track of peak combined sail force
    if (this.sailAccumVec.length() > this.lockedSailForce.length()) {
      this.lockedSailForce.copy(this.sailAccumVec);
    }

    if (this.phase === 1 && anyHitThisFrame) {
      this._emitPhase(2);
      this.phaseTime = 0;
    }

    if (this.sailAccumVec.length() > 0.05) {
      const sailCenter = new THREE.Vector3();
      this.boat.sailMesh.getWorldPosition(sailCenter);
      this.sailArrow.set(sailCenter, this.sailAccumVec);
    }

    // Transition to Phase 3 once the pulse has finished hitting
    if (this.phase === 2 && this.phaseTime > 1.75) {
      // Fade out remaining wind particles
      for (const p of this.windParticles) {
        p.active = false;
        p.mesh.visible = false;
      }
      // Ensure we have a readable sail force even if wind was nearly edge-on
      if (this.lockedSailForce.length() < 0.2) {
        const windDir = this.getWindDir();
        this.lockedSailForce.copy(windDir).multiplyScalar(0.8);
      }
      const sailCenter = new THREE.Vector3();
      this.boat.sailMesh.getWorldPosition(sailCenter);
      this.sailArrow.set(sailCenter, this.lockedSailForce);

      // Place water molecules on the side the keel will be pushed toward
      // (default wind 135°, sail -32° pushes -X, which is to the left of the keel)
      const side = this.lockedSailForce.x <= 0.02 ? -1 : 1;
      this._positionWaterCluster(side);

      this._emitPhase(3);
      this.phaseTime = 0;
    } else if (this.phase === 1 && (activeCount === 0 || this.phaseTime > 3.2 / Math.max(this.windStrength, 0.05))) {
      // Wind missed sail completely (edge-on) -> fallback gently to phase 3
      const windDir = this.getWindDir();
      this.lockedSailForce.copy(windDir).multiplyScalar(0.6);
      this.boat.sailMesh.getWorldPosition(this.sailHitWorld);
      this.sailArrow.set(this.sailHitWorld, this.lockedSailForce);
      this._emitPhase(3);
      this.phaseTime = 0;
    }
  }

  _getMastRoot() {
    return this.boat.root.position.clone().add(new THREE.Vector3(0, 0.32, 0.28));
  }

  _updateDownwardWave(dt) {
    const duration = 1.9;
    const t = Math.min(1, this.phaseTime / duration);

    // Wave starts at sailHitWorld and propagates down through mast -> hull -> keel
    const startY = this.sailHitWorld.y;
    const endY = -1.55;
    const currentY = THREE.MathUtils.lerp(startY, endY, t);

    this.boat.waveUniforms.uDownActive.value = Math.sin(t * Math.PI);
    this.boat.waveUniforms.uDownY.value = currentY;
    this.boat.waveUniforms.uDownOrigin.value.copy(this.sailHitWorld);
    this.boat.waveUniforms.uDownRadius.value = t * 3.8;

    // Once wave reaches hull/keel (t > 0.55), nudge boat slightly along sail force toward water molecules
    if (t > 0.55) {
      const nudgeT = (t - 0.55) / 0.45;
      const eased = nudgeT * nudgeT * (3 - 2 * nudgeT);
      const lateralDir = this.waterSide;
      this.boatPhase3Offset.set(lateralDir * 0.36 * eased, 0, Math.sign(this.lockedSailForce.z) * 0.12 * eased);
      this.boat.root.position.copy(this.boatBasePos).add(this.boatPhase3Offset);
    }

    // Slide the sail vector down from sail center to the root of the mast pole as the wave propagates down
    const slideT = Math.min(1, t / 0.65);
    const slideEased = slideT * slideT * (3 - 2 * slideT);
    const sailCenter = new THREE.Vector3();
    this.boat.sailMesh.getWorldPosition(sailCenter);
    const mastRoot = this._getMastRoot();
    this.sailArrow.set(sailCenter.lerp(mastRoot, slideEased), this.lockedSailForce);

    if (t >= 1) {
      this.boat.waveUniforms.uDownActive.value = 0;
      this.sailArrow.set(this._getMastRoot(), this.lockedSailForce);
      this._emitPhase(4);
      this.phaseTime = 0;
    }
  }

  _updateKeelWater(dt) {
    const duration = 2.4;
    const t = Math.min(1, this.phaseTime / duration);

    // Keel sweeps steadily into the staggered water molecule cluster
    const pushCurve = 1 - Math.pow(1 - t, 1.6);
    const extraPushX = this.waterSide * 0.68 * pushCurve;
    this.boat.root.position.set(
      this.boatBasePos.x + this.boatPhase3Offset.x + extraPushX,
      0,
      this.boatBasePos.z + this.boatPhase3Offset.z
    );

    const keelWorld = new THREE.Vector3();
    this.boat.keel.getWorldPosition(keelWorld);

    // Collide keel face with water molecules one by one & accumulate reaction vector with decay
    const targetReactionMag = Math.abs(this.lockedSailForce.x) * 0.9;
    for (const m of this.waterMolecules) {
      const dx = (m.pos.x - keelWorld.x) * this.waterSide;
      const dz = m.pos.z - keelWorld.z;
      const inKeelZ = Math.abs(dz) < 0.95;

      if (!m.hit && dx < 0.18 && dx > -0.25 && inKeelZ) {
        m.hit = true;
        m.hitFlash = 1.0;

        // Water molecule deflects outward, imparting an opposite reaction impulse onto the keel
        m.vel.set(this.waterSide * (1.1 + Math.random() * 0.5), (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.45);

        // Each hit adds a modest impulse so the combined vector visibly builds up
        const perHitMag = Math.max(0.06, targetReactionMag * 0.14);
        const impulse = new THREE.Vector3(-this.waterSide * perHitMag, 0, 0);
        this.keelAccumVec.add(impulse);

        // Clamp so it doesn't overshoot the physical lateral resistance
        if (this.keelAccumVec.length() > targetReactionMag * 1.15 && targetReactionMag > 0.05) {
          this.keelAccumVec.setLength(targetReactionMag * 1.15);
        }

        m.mesh.material.color.setHex(0xffffff);
        m.mesh.material.emissive.setHex(0x22d3ee);
        m.mesh.material.emissiveIntensity = 1.7;
        m.mesh.scale.setScalar(1.35);
      }

      if (m.hit) {
        m.pos.addScaledVector(m.vel, dt);
        m.vel.multiplyScalar(Math.exp(-dt * 2.2));
        m.mesh.position.copy(m.pos);
        if (m.hitFlash > 0) {
          m.hitFlash = Math.max(0, m.hitFlash - dt * 1.8);
          m.mesh.scale.setScalar(1 + m.hitFlash * 0.35);
          m.mesh.material.emissiveIntensity = 0.45 + m.hitFlash * 1.25;
        }
      }
    }

    // Short decay so individual water impulses visibly pulse and combine in the keel region
    this.keelAccumVec.multiplyScalar(Math.exp(-dt * 1.15));
    if (this.keelAccumVec.length() > this.lockedKeelForce.length()) {
      this.lockedKeelForce.copy(this.keelAccumVec);
    }

    if (this.keelAccumVec.length() > 0.04) {
      this.keelArrow.set(keelWorld, this.keelAccumVec);
    } else {
      this.keelArrow.hide();
    }

    // Keep sail arrow anchored at the root of the mast pole
    this.sailArrow.set(this._getMastRoot(), this.lockedSailForce);

    if (t >= 1) {
      // Ensure keel reaction cleanly cancels most of the lateral sail force
      this.lockedKeelForce.set(-this.lockedSailForce.x * 0.9, 0, 0);
      this.keelArrow.set(keelWorld, this.lockedKeelForce);

      // Compute resultant net guided motion vector = Sail Force + Keel Reaction
      this.netMotionVec.copy(this.lockedSailForce).add(this.lockedKeelForce);
      this.boatPhase5Start.copy(this.boat.root.position);
      this.trailPoints = [this.boat.root.position.clone().setY(0.06)];

      this._emitPhase(5);
      this.phaseTime = 0;
    }
  }

  _updateUpwardAndMotion(dt) {
    const slideDuration = 1.25;
    const resultantDuration = 0.9;
    const motionDuration = 2.4;

    const keelWorld = new THREE.Vector3();
    this.boat.keel.getWorldPosition(keelWorld);
    const mastRoot = this._getMastRoot();

    // Hide hull ghost arrows — sail, keel, and resultant all meet at mastRoot
    this.hullSailGhost.hide();
    this.hullKeelGhost.hide();

    if (this.phaseTime <= slideDuration) {
      // Part A: Upward cyan propagation wave from keel -> hull + keel vector slides straight up to mast root
      const t = this.phaseTime / slideDuration;
      const eased = t * t * (3 - 2 * t);
      const currentY = THREE.MathUtils.lerp(-1.45, 0.35, t);
      this.boat.waveUniforms.uUpActive.value = Math.sin(t * Math.PI);
      this.boat.waveUniforms.uUpY.value = currentY;

      const slidOrigin = keelWorld.clone().lerp(mastRoot, eased);
      this.sailArrow.set(mastRoot, this.lockedSailForce);
      this.keelArrow.set(slidOrigin, this.lockedKeelForce);
      this.netArrow.hide();
    } else if (this.phaseTime <= slideDuration + resultantDuration) {
      // Part B: Sail and keel vectors both rooted at mast root; grow the green resultant vector before moving
      this.boat.waveUniforms.uUpActive.value = 0;

      const rt = (this.phaseTime - slideDuration) / resultantDuration;
      const eased = 1 - Math.pow(1 - rt, 3);

      this.sailArrow.set(mastRoot, this.lockedSailForce);
      this.keelArrow.set(mastRoot, this.lockedKeelForce);
      this.netArrow.set(mastRoot, this.netMotionVec.clone().multiplyScalar(eased));
    } else {
      // Part C: Guided boat motion along the resultant vector
      this.boat.waveUniforms.uUpActive.value = 0;

      const mt = Math.min(1, (this.phaseTime - slideDuration - resultantDuration) / motionDuration);
      const eased = 1 - Math.pow(1 - mt, 3); // smooth ease-out glide

      const travel = this.netMotionVec.clone().multiplyScalar(1.9 * eased);
      this.boat.root.position.copy(this.boatPhase5Start).add(travel);

      const movedMastRoot = this._getMastRoot();

      this.sailArrow.set(movedMastRoot, this.lockedSailForce);
      this.keelArrow.set(movedMastRoot, this.lockedKeelForce);
      this.netArrow.set(movedMastRoot, this.netMotionVec);

      // Record wake trail
      const trailPt = this.boat.root.position.clone().setY(0.06);
      if (
        this.trailPoints.length === 0 ||
        this.trailPoints[this.trailPoints.length - 1].distanceTo(trailPt) > 0.08
      ) {
        this.trailPoints.push(trailPt);
        this.trailLine.geometry.setFromPoints(this.trailPoints);
      }
    }
  }
}
