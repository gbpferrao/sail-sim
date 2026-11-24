import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class VectorArrow {
  constructor(color = 0xf97316, { shaftRadius = 0.04, headRadius = 0.11, headLength = 0.28, opacity = 1 } = {}) {
    this.group = new THREE.Group();
    this.headLength = headLength;

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.1,
      transparent: opacity < 1,
      opacity,
    });

    const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 12);
    shaftGeo.translate(0, 0.5, 0);
    this.shaft = new THREE.Mesh(shaftGeo, mat);

    const headGeo = new THREE.ConeGeometry(headRadius, headLength, 16);
    headGeo.translate(0, headLength * 0.5, 0);
    this.head = new THREE.Mesh(headGeo, mat);

    this.group.add(this.shaft, this.head);
    this.group.visible = false;

    this._dir = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
  }

  set(origin, vec) {
    const len = vec.length();
    if (len < 0.04) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.copy(origin);

    this._dir.copy(vec).divideScalar(len);
    this._quat.setFromUnitVectors(UP, this._dir);
    this.group.quaternion.copy(this._quat);

    const headLen = Math.min(this.headLength, len * 0.45);
    const shaftLen = Math.max(0.01, len - headLen);

    this.shaft.scale.set(1, shaftLen, 1);
    this.head.position.set(0, shaftLen, 0);
    this.head.scale.set(1, headLen / this.headLength, 1);
  }

  hide() {
    this.group.visible = false;
  }
}
