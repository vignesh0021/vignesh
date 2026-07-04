import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildBuilding, buildCompound } from "./building3d.js";

// Real-time 3D elevation viewer. Rebuilds geometry when spec/theme change.
export default function Building3D({ spec, theme }) {
  const mountRef = useRef();
  const api = useRef({});

  // one-time scene setup
  useEffect(() => {
    const mount = mountRef.current;
    const w = mount.clientWidth, h = mount.clientHeight || 460;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.5, 2000);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.03;

    // lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556070, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(-40, 70, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
    scene.add(sun);

    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);

    let raf;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const W = mount.clientWidth, H = mount.clientHeight || 460;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    api.current = { renderer, scene, camera, controls, buildingGroup, sun };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // (re)build geometry on spec/theme change
  useEffect(() => {
    const { scene, camera, controls, buildingGroup } = api.current;
    if (!scene || !spec) return;

    while (buildingGroup.children.length) buildingGroup.remove(buildingGroup.children[0]);

    // sky + ground
    scene.background = new THREE.Color(theme.sky);
    if (!api.current.ground) {
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(400, 48),
        new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      api.current.ground = ground;
      // a few trees
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const r = 70 + (i % 3) * 14;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 8),
          new THREE.MeshStandardMaterial({ color: "#6b4a2b" }));
        trunk.position.y = 4;
        const crown = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12),
          new THREE.MeshStandardMaterial({ color: "#2f7a34", roughness: 1 }));
        crown.position.y = 11; crown.castShadow = true;
        tree.add(trunk, crown);
        tree.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r - 30);
        scene.add(tree);
      }
    } else {
      api.current.ground.material.color.set(theme.ground);
    }

    const model = buildBuilding(THREE, spec, theme);
    buildCompound(THREE, spec, theme, model);
    buildingGroup.add(model);

    const { tw, td, height } = model.userData.dims;
    // frame the model, front-biased so it reads as an elevation
    camera.position.set(tw * 0.55, height * 0.6, td / 2 + tw * 1.25);
    controls.target.set(0, height * 0.42, 0);
    controls.update();
  }, [spec, theme]);

  return <div ref={mountRef} className="w-full h-[460px] rounded-lg overflow-hidden bg-slate-200" />;
}
