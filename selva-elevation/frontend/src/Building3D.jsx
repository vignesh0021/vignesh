import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildBuilding, buildCompound } from "./building3d.js";

// clean vertical gradient sky (reliable on every GPU)
function gradientSky(THREE, top, bottom) {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top); grd.addColorStop(1, bottom);
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Real-time 3D elevation viewer. Rebuilds geometry when spec/theme change.
export default function Building3D({ spec, theme, projectName = "building" }) {
  const mountRef = useRef();
  const api = useRef({});
  const [exporting, setExporting] = useState(false);

  // Route A: export the exact model as .glb for Blender / Lumion / Twinmotion
  const exportGlb = () => {
    const { buildingGroup } = api.current;
    if (!buildingGroup) return;
    setExporting(true);
    new GLTFExporter().parse(
      buildingGroup,
      (result) => {
        const blob = new Blob([result], { type: "model/gltf-binary" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${projectName}-${theme.id}.glb`;
        a.click();
        URL.revokeObjectURL(a.href);
        setExporting(false);
      },
      (err) => { console.error(err); setExporting(false); },
      { binary: true }
    );
  };

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
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.5, 4000);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.03;

    // image-based lighting -> soft realistic shading + reflections on glass/metal
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // gradient sky background
    const sunPos = new THREE.Vector3();
    const elevation = 34, azimuth = -42;         // warm mid-morning sun
    sunPos.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation),
                                  THREE.MathUtils.degToRad(azimuth));

    // lighting
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6b6250, 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2df, 2.4);
    sun.position.copy(sunPos).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 110, bottom: -60, near: 1, far: 500 });
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

    // gradient sky background (tinted from the theme)
    scene.background = gradientSky(THREE, "#5b9bd5", "#dfeefb");

    // ground
    if (!api.current.ground) {
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(600, 64),
        new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.95 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      ground.receiveShadow = true;
      scene.add(ground);
      api.current.ground = ground;
      // paved forecourt in front of the building
      const pave = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 40),
        new THREE.MeshStandardMaterial({ color: "#c9c4bc", roughness: 0.8 })
      );
      pave.rotation.x = -Math.PI / 2; pave.position.set(0, 0, 40); pave.receiveShadow = true;
      scene.add(pave);
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

  return (
    <div className="relative">
      <div ref={mountRef} className="w-full h-[460px] rounded-lg overflow-hidden bg-slate-200" />
      <button
        onClick={exportGlb}
        disabled={exporting}
        title="Export the exact model for Blender / Lumion / Twinmotion photoreal rendering"
        className="absolute top-2 right-2 text-xs px-3 py-1.5 rounded-lg bg-white/90 hover:bg-white border border-slate-300 shadow-sm font-medium disabled:opacity-60"
      >
        {exporting ? "Exporting…" : "⬇ Download 3D (.glb)"}
      </button>
    </div>
  );
}
