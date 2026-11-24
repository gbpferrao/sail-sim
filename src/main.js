import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBoat } from './boat.js';
import { SailSimulation } from './simulation.js';
import { VectorArrow } from './vectors.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.fog = new THREE.Fog(0x0b1220, 16, 36);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(-5.8, 3.8, 6.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.6, 0);

// Lighting
const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.9);
scene.add(hemi);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
dirLight.position.set(6, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
scene.add(dirLight);

const underLight = new THREE.PointLight(0x0ea5e9, 1.1, 14);
underLight.position.set(-2.5, -2.2, 2.0);
scene.add(underLight);

// Translucent water surface at y = 0 so above-water sail and underwater keel are both visible
const waterPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(36, 36),
  new THREE.MeshStandardMaterial({
    color: 0x0c4a6e,
    roughness: 0.25,
    metalness: 0.15,
    transparent: true,
    opacity: 0.36,
    side: THREE.DoubleSide,
  })
);
waterPlane.rotation.x = -Math.PI / 2;
waterPlane.position.y = 0;
scene.add(waterPlane);

const grid = new THREE.GridHelper(24, 24, 0x1e3a5f, 0x16263d);
grid.position.y = 0.005;
scene.add(grid);

// Compass ring around the boat
const ringGeo = new THREE.RingGeometry(4.4, 4.48, 64);
ringGeo.rotateX(-Math.PI / 2);
const ringMesh = new THREE.Mesh(
  ringGeo,
  new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
);
ringMesh.position.y = 0.02;
scene.add(ringMesh);

// Live wind direction indicator arrow around the boat
const windIndicator = new VectorArrow(0xfbbf24, { shaftRadius: 0.045, headRadius: 0.13, headLength: 0.34 });
scene.add(windIndicator.group);

// Boat + Simulation
const boat = createBoat();
scene.add(boat.root);

const phaseBadge = document.getElementById('phase-badge');
const phaseDesc = document.getElementById('phase-desc');
const phaseItems = Array.from(document.querySelectorAll('#phase-list li'));

function onPhaseChange(phase, badge, desc) {
  phaseBadge.textContent = badge;
  phaseDesc.textContent = desc;
  for (const li of phaseItems) {
    const p = Number(li.dataset.phase);
    li.classList.toggle('active', p === phase);
    li.classList.toggle('done', phase > 0 && p < phase);
  }
}

const sim = new SailSimulation(scene, boat, onPhaseChange);

function updateWindIndicator() {
  const dir = sim.getWindDir();
  const origin = new THREE.Vector3().copy(dir).multiplyScalar(-4.6);
  origin.y = 1.9;
  windIndicator.set(origin, dir.clone().multiplyScalar(1.45 * sim.windStrength));
}
updateWindIndicator();

// HUD bindings
const windSlider = document.getElementById('wind-angle');
const windVal = document.getElementById('wind-angle-val');
const windStrengthSlider = document.getElementById('wind-strength');
const windStrengthVal = document.getElementById('wind-strength-val');
const sailSlider = document.getElementById('sail-angle');
const sailVal = document.getElementById('sail-angle-val');
const speedSlider = document.getElementById('sim-speed');
const speedVal = document.getElementById('sim-speed-val');
const btnPulse = document.getElementById('btn-pulse');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');

windSlider.addEventListener('input', () => {
  const deg = Number(windSlider.value);
  windVal.textContent = `${deg}°`;
  sim.setWindAngle(deg);
  updateWindIndicator();
});

windStrengthSlider.addEventListener('input', () => {
  const strength = Number(windStrengthSlider.value);
  windStrengthVal.textContent = strength.toFixed(2);
  sim.setWindStrength(strength);
  updateWindIndicator();
});

sailSlider.addEventListener('input', () => {
  const deg = Number(sailSlider.value);
  sailVal.textContent = `${deg}°`;
  sim.setSailAngle(deg);
});

speedSlider.addEventListener('input', () => {
  const s = Number(speedSlider.value);
  speedVal.textContent = `${s.toFixed(2)}x`;
  sim.setSpeed(s);
});

btnPulse.addEventListener('click', () => {
  btnPause.textContent = 'pause';
  sim.firePulse();
});

btnPause.addEventListener('click', () => {
  const paused = sim.togglePause();
  btnPause.textContent = paused ? 'resume' : 'pause';
});

btnReset.addEventListener('click', () => {
  btnPause.textContent = 'pause';
  sim.reset();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const elapsed = clock.elapsedTime;
  sim.update(dt, elapsed);
  controls.update();
  renderer.render(scene, camera);
}

animate();
