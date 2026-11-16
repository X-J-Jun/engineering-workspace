/* Geometry for the flexible assembly workstation.
   Exposes window.RobotModel.build(THREE, {preview}) -> scene graph + part registry.

   Conventions: metres, the conveyor runs along X, belt centre plane at z = 0.7,
   belt surface at y = 1.04. Parts registered through `record()` become the
   exploitable sub-assemblies used by the viewer. */
(() => {
  'use strict';

  const BELT_Z = 0.7;
  const BELT_TOP = 1.04;
  const PALLET_Y = 1.15;
  const FEED_X = -6.0;
  const VISION_X = 3.35;
  const OUT_X = 6.15;

  function build(THREE, { preview = false } = {}) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#07101c', .013);

    const geometries = new Set();
    const materials = new Set();
    const parts = [];
    const sub = {};
    const devices = {};
    const stackLights = [];

    const material = (color, properties = {}) => {
      const item = new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .15, ...properties });
      materials.add(item);
      return item;
    };

    const M = {
      alu: material('#b9c7d6', { metalness: .78, roughness: .32 }),
      aluDark: material('#7d8ea1', { metalness: .72, roughness: .42 }),
      steel: material('#93a3b6', { metalness: .88, roughness: .26 }),
      machine: material('#5d6e83', { metalness: .6, roughness: .45 }),
      white: material('#e9eff6', { metalness: .1, roughness: .38 }),
      blue: material('#2f7fc4', { metalness: .3, roughness: .44 }),
      dark: material('#25313f', { metalness: .35, roughness: .55 }),
      black: material('#141b24', { metalness: .3, roughness: .7 }),
      rubber: material('#0f151d', { roughness: .94, metalness: .02 }),
      oak: material('#c2945a', { roughness: .82, metalness: .02 }),
      yellow: material('#e8b23c', { roughness: .45, metalness: .2 }),
      rail: material('#9a7f3c', { roughness: .62, metalness: .28 }),
      glass: material('#9fd4ef', { transparent: true, opacity: .06, depthWrite: false, side: THREE.DoubleSide, roughness: .06, metalness: .25 }),
      screen: material('#0f2a3a', { emissive: '#1b6f96', emissiveIntensity: .75, roughness: .3 }),
      cyan: material('#5fe3ff', { emissive: '#1d9fc4', emissiveIntensity: 1.1, roughness: .3 }),
      green: material('#45e6a4', { emissive: '#0d8f63', emissiveIntensity: .95 }),
      amber: material('#ffc65c', { emissive: '#c07a08', emissiveIntensity: .85 }),
      red: material('#ff6a5e', { emissive: '#b81f13', emissiveIntensity: .9 }),
      beam: material('#7fe4ff', { transparent: true, opacity: .15, depthWrite: false, side: THREE.DoubleSide, emissive: '#2aa8d6', emissiveIntensity: .5 }),
      floor: material('#1d2a3a', { metalness: .35, roughness: .72 }),
      lane: material('#e3b455', { emissive: '#7a5a12', emissiveIntensity: .22, roughness: .6 })
    };

    const geo = {
      cube: new THREE.BoxGeometry(1, 1, 1),
      tube: new THREE.CylinderGeometry(1, 1, 1, preview ? 12 : 24),
      sphere: new THREE.SphereGeometry(1, preview ? 10 : 18, preview ? 8 : 14),
      torus: new THREE.TorusGeometry(1, .08, 8, preview ? 18 : 32),
      cone: new THREE.ConeGeometry(1, 1, 4, 1, true)
    };
    for (const item of Object.values(geo)) geometries.add(item);

    const group = (parent, x = 0, y = 0, z = 0) => {
      const item = new THREE.Group();
      item.position.set(x, y, z);
      parent.add(item);
      return item;
    };

    const mesh = (parent, geometry, matItem, size, position, axis) => {
      const item = new THREE.Mesh(geometry, matItem);
      item.scale.set(size[0], size[1], size[2]);
      item.position.set(position[0], position[1], position[2]);
      if (axis === 'x') item.rotation.z = Math.PI / 2;
      if (axis === 'z') item.rotation.x = Math.PI / 2;
      parent.add(item);
      return item;
    };

    const box = (parent, size, position, matItem) => mesh(parent, geo.cube, matItem, size, position);
    const cyl = (parent, radius, height, position, matItem, axis) =>
      mesh(parent, geo.tube, matItem, [radius, height, radius], position, axis);
    const ball = (parent, size, position, matItem) =>
      mesh(parent, geo.sphere, matItem, Array.isArray(size) ? size : [size, size, size], position);

    const torus = (parent, radius, position, matItem, axis = 'y') => {
      const item = mesh(parent, geo.torus, matItem, [radius, radius, radius], position);
      if (axis === 'y') item.rotation.x = Math.PI / 2;
      if (axis === 'x') item.rotation.y = Math.PI / 2;
      return item;
    };

    const hose = (parent, points, matItem, radius = .024) => {
      const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(point[0], point[1], point[2])));
      const geometry = new THREE.TubeGeometry(curve, preview ? 8 : 20, radius, 6, false);
      geometries.add(geometry);
      const item = new THREE.Mesh(geometry, matItem);
      parent.add(item);
      return item;
    };

    /* T-slot aluminium extrusion: body plus darker groove lines. */
    function profile(parent, length, size, position, axis, matItem = M.alu) {
      const holder = group(parent, position[0], position[1], position[2]);
      const dims = axis === 'x' ? [length, size, size] : axis === 'z' ? [size, size, length] : [size, length, size];
      box(holder, dims, [0, 0, 0], matItem);
      const groove = size * .28;
      if (axis === 'x') {
        for (const side of [-1, 1]) {
          box(holder, [length, groove, .01], [0, side * size * .27, side * size * .5], M.dark);
          box(holder, [length, .01, groove], [0, side * size * .5, side * size * .27], M.dark);
        }
      } else if (axis === 'z') {
        for (const side of [-1, 1]) {
          box(holder, [groove, .01, length], [side * size * .27, side * size * .5, 0], M.dark);
          box(holder, [.01, groove, length], [side * size * .5, side * size * .27, 0], M.dark);
        }
      } else {
        for (const side of [-1, 1]) {
          box(holder, [groove, length, .01], [side * size * .27, 0, side * size * .5], M.dark);
          box(holder, [.01, length, groove], [side * size * .5, 0, side * size * .27], M.dark);
        }
      }
      return holder;
    }

    function boltRing(parent, radius, count, position, axis = 'y', matItem = M.steel) {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        if (axis === 'y') {
          cyl(parent, .016, .02, [position[0] + radius * Math.cos(angle), position[1], position[2] + radius * Math.sin(angle)], matItem);
        } else {
          cyl(parent, .015, .018, [position[0], position[1] + radius * Math.sin(angle), position[2] + radius * Math.cos(angle)], matItem, 'x');
        }
      }
    }

    function foot(parent, x, z, height) {
      cyl(parent, .028, height, [x, height / 2, z], M.steel);
      cyl(parent, .085, .02, [x, .012, z], M.rubber);
    }

    /* ---------------------------------------------------------- registry */

    /* Explode distances are authored per part in metres, then scaled per
       sub-assembly so small fixtures open up as much as big machine frames. */
    const EXPLODE_SCALE = {
      tool: .9, robotParts: 1, fixture: 1.25, conveyor: 1.05,
      feeder: .95, visionParts: 1.35, agv: 1.3
    };

    function record(subId, name, spec, object, offset, layer = 0) {
      const scale = EXPLODE_SCALE[subId] ?? 1.4;
      const entry = {
        sub: subId,
        name,
        spec,
        object,
        offset: new THREE.Vector3(offset[0] * scale, offset[1] * scale, offset[2] * scale),
        layer,
        home: object.position.clone()
      };
      parts.push(entry);
      (sub[subId] ||= []).push(entry);
      return entry;
    }

    const device = (id, name, description) => {
      const holder = group(scene);
      holder.userData.device = id;
      devices[id] = { id, name, description, group: holder, focus: new THREE.Vector3() };
      return holder;
    };

    /* -------------------------------------------------------------- floor */

    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = floorCanvas.height = 512;
    const context = floorCanvas.getContext('2d');
    context.fillStyle = '#15212b';
    context.fillRect(0, 0, 512, 512);
    context.strokeStyle = 'rgba(96,196,240,.16)';
    context.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 512); context.stroke();
      context.beginPath(); context.moveTo(0, i); context.lineTo(512, i); context.stroke();
    }
    context.strokeStyle = 'rgba(120,214,255,.34)';
    context.lineWidth = 4;
    context.strokeRect(0, 0, 512, 512);
    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(8, 5);
    floorTexture.anisotropy = 4;
    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, color: '#5c7387', roughness: .58, metalness: .45 });
    materials.add(floorMaterial);
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(48, 28), floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -.02, -1.4);
    geometries.add(floorMesh.geometry);
    scene.add(floorMesh);
    mesh(scene, geo.cube, M.dark, [48, .3, 28], [0, -.19, -1.4]);

    for (const z of [-4.4, 4.1]) {
      box(scene, [25, .012, .05], [0, -.006, z], M.lane);
      for (let x = -11.5; x <= 11.5; x += .9) box(scene, [.42, .012, .06], [x, -.006, z + .15], M.lane);
    }
    for (const x of [-11.3, 11.3]) box(scene, [.05, .012, 8.7], [x, -.006, -.4], M.lane);
    for (let i = 0; i < 12; i++) box(scene, [.05, .008, 1.7], [-1.3 + i * .24, -.004, -.5], M.yellow);

    /* ----------------------------------------------------------- conveyor */

    const feed = device('feed', '上料与输送', '入口料仓、振动供料与模组化输送线；托盘由入口段送入装配工位。');
    const robotDevice = device('robot', '六轴工业机器人', '三台六轴机械臂分别承担上料、装配与下料，装配臂配快换夹爪。');
    const fixtureDevice = device('fixture', '柔性装配夹具', '定位销、气动夹紧与托盘构成柔性夹具，可在两种工件间切换。');
    const visionDevice = device('vision', '视觉定位与检测', '龙门架安装工业相机与环形光源，完成识别与装配后检测。');
    const safetyDevice = device('safety', '安全防护', '铝型材围栏、安全门与安全互锁保证人机隔离。');
    const outputDevice = device('output', '成品输出', '下料机械臂将成品移入成品料箱，AGV 负责整箱转运。');

    const conveyorParts = [];
    const armParts = [];

    function conveyorModule(parent, x, width, driven) {
      const module = group(parent, x, 0, BELT_Z);
      const frameY = .9;
      const halfZ = .42;

      for (const side of [-1, 1]) {
        profile(module, width, .085, [0, frameY, side * halfZ], 'x');
        box(module, [width, .045, .05], [0, BELT_TOP + .03, side * .3], M.aluDark);
        box(module, [width, .025, .015], [0, BELT_TOP + .062, side * .3], M.rubber);
      }

      box(module, [width, .05, .64], [0, BELT_TOP - .02, 0], M.black);
      if (!preview) {
        const step = .13;
        for (let offset = -width / 2 + step; offset < width / 2; offset += step) {
          box(module, [step * .8, .012, .62], [offset, BELT_TOP + .008, 0], M.steel);
        }
      }

      const legCount = Math.max(2, Math.round(width / 1.25));
      for (let i = 0; i < legCount; i++) {
        const lx = -width / 2 + .16 + i * ((width - .32) / Math.max(1, legCount - 1));
        for (const side of [-1, 1]) {
          profile(module, .95, .075, [lx, .47, side * halfZ], 'y');
          foot(module, lx, side * halfZ, .07);
        }
        box(module, [.05, .05, halfZ * 2 - .08], [lx, .44, 0], M.aluDark);
        box(module, [.04, .04, halfZ * 2 - .14], [lx, .18, 0], M.aluDark);
      }

      box(module, [width - .2, .05, .24], [0, .63, 0], M.aluDark);
      for (let i = 0; i < Math.round(width / .5); i++) {
        box(module, [.02, .06, .28], [-width / 2 + .3 + i * .5, .63, 0], M.dark);
      }

      for (const side of [-1, 1]) {
        box(module, [.09, .12, .07], [side * (width / 2 - .28), BELT_TOP + .14, .34], M.dark);
        cyl(module, .02, .04, [side * (width / 2 - .28), BELT_TOP + .14, .29], M.cyan, 'z');
        box(module, [.05, .22, .05], [side * (width / 2 - .32), BELT_TOP + .12, -.3], M.aluDark);
      }

      if (driven) {
        const drive = group(module, width / 2 - .34, .8, .86);
        box(drive, [.4, .34, .26], [0, 0, 0], M.dark);
        const motor = cyl(drive, .15, .42, [0, 0, .2], M.steel, 'z');
        cotter(drive, .15, .22);
        cyl(drive, .1, .04, [0, 0, .42], M.black, 'z');
        torus(drive, .062, [0, 0, .45], M.steel, 'z');
        box(drive, [.2, .2, .1], [-.2, 0, -.04], M.machine);
        for (let i = 0; i < 4; i++) box(drive, [.03, .26, .012], [-.2, 0, -.09 - i * .03], M.dark);
        // Only the two middle modules are registered, so the exploded view stays
        // readable instead of spanning the whole 24 m line.
        if (Math.abs(x + 2.15) < .01 || Math.abs(x - 2.05) < .01) {
          conveyorParts.push(record('conveyor', '输送驱动电机', '0.75 kW · 1:25 减速', motor, [.62, .55, .62], 1));
          conveyorParts.push(record('conveyor', '驱动单元与胀紧机构', '同步带传动', drive, [.22, .1, 1.15], 0));
        }
      }
      return module;
    }

    function cotter(parent, radius, z) {
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        cyl(parent, .011, .05, [Math.cos(angle) * radius, Math.sin(angle) * radius, z], M.aluDark, 'z');
      }
    }

    const benches = [
      { x: -11.35, width: 4.4, dev: feed, driven: true },
      { x: -6.67, width: 4.6, dev: feed, driven: true },
      { x: -2.15, width: 4.2, dev: fixtureDevice, driven: true },
      { x: 2.05, width: 3.9, dev: visionDevice, driven: true },
      { x: 6.53, width: 4.6, dev: outputDevice, driven: true },
      { x: 11.35, width: 4.4, dev: outputDevice, driven: true }
    ];
    for (const bench of benches) conveyorModule(bench.dev, bench.x, bench.width, bench.driven);
    /* Module joints belong to no single device; keep them out of device bounds. */
    for (const x of [-9.02, -4.42, -.06, 4.32, 8.92]) box(scene, [.06, .05, .9], [x, .63, BELT_Z], M.aluDark);

    /* ------------------------------------------------------------- robots */

    const arms = [];

    function robot(parent, x, z, index) {
      const baseGroup = group(parent, x, 0, z);
      const toolParts = [];

      box(baseGroup, [1.02, .1, 1.02], [0, .05, 0], M.machine);
      for (const dx of [-.4, .4]) for (const dz of [-.4, .4]) {
        cyl(baseGroup, .034, .05, [dx, .1, dz], M.steel);
        cyl(baseGroup, .024, .02, [dx, .13, dz], M.aluDark);
      }

      const j1Base = cyl(baseGroup, .44, .2, [0, .2, 0], M.dark);
      const j1Gear = torus(baseGroup, .43, [0, .3, 0], M.steel);
      if (!preview) {
        for (let i = 0; i < 36; i++) {
          const angle = (i / 36) * Math.PI * 2;
          box(baseGroup, [.04, .034, .03], [.45 * Math.cos(angle), .3, .45 * Math.sin(angle)], M.steel);
        }
      }
      cyl(baseGroup, .38, .06, [0, .33, 0], M.aluDark);
      boltRing(baseGroup, .34, 12, [0, .36, 0]);

      const yaw = group(baseGroup, 0, .38, 0);
      cyl(yaw, .36, .3, [0, .15, 0], M.white);
      cyl(yaw, .3, .06, [0, .32, 0], M.alu);
      boltRing(yaw, .285, 10, [0, .35, 0]);
      box(yaw, [.3, .24, .2], [0, .16, -.24], M.white);
      box(yaw, [.26, .12, .06], [0, .2, -.34], M.blue);
      box(yaw, [.16, .1, .05], [0, .05, -.3], M.dark);

      const shoulder = group(yaw, 0, .42, 0);
      let j2Servo = null;
      for (const side of [-1, 1]) {
        box(shoulder, [.1, .56, .34], [side * .27, .03, 0], M.white);
        const servo = cyl(shoulder, .2, .09, [side * .33, .03, 0], M.steel, 'x');
        if (side > 0) j2Servo = servo;
        torus(shoulder, .17, [side * .37, .03, 0], M.dark, 'x');
        boltRing(shoulder, .13, 6, [side * .38, .03, 0], 'x');
      }
      const j2Harmonic = cyl(shoulder, .21, .07, [0, .03, .22], M.aluDark, 'z');
      cyl(shoulder, .12, .03, [0, .03, .27], M.steel, 'z');

      const upperLength = 1.42;
      const upper = group(shoulder, 0, .06, 0);
      const upperBody = box(upper, [.24, upperLength, .26], [0, upperLength / 2, 0], M.white);
      box(upper, [.28, upperLength * .82, .1], [0, upperLength / 2, .15], M.white);
      for (const side of [-1, 1]) box(upper, [.02, upperLength * .7, .18], [side * .13, upperLength / 2, 0], M.aluDark);
      for (let i = 1; i <= 3; i++) box(upper, [.3, .03, .3], [0, i * upperLength / 3.6, 0], M.aluDark);
      box(upper, [.16, .3, .16], [0, upperLength * .58, -.18], M.blue);

      const elbow = group(upper, 0, upperLength, 0);
      const j3Joint = cyl(elbow, .2, .42, [0, 0, 0], M.dark, 'x');
      for (const side of [-1, 1]) {
        cyl(elbow, .155, .07, [side * .25, 0, 0], M.steel, 'x');
        torus(elbow, .13, [side * .29, 0, 0], M.aluDark, 'x');
        boltRing(elbow, .1, 6, [side * .3, 0, 0], 'x');
      }
      const j3Cap = cyl(elbow, .16, .08, [0, 0, .22], M.alu, 'z');

      const lowerLength = 1.3;
      const lower = group(elbow, 0, 0, 0);
      const foreArm = box(lower, [.19, lowerLength, .21], [0, lowerLength / 2, 0], M.white);
      box(lower, [.22, lowerLength * .8, .08], [0, lowerLength / 2, .12], M.white);
      box(lower, [.12, lowerLength * .5, .05], [0, lowerLength * .5, -.12], M.blue);
      for (let i = 0; i < 3; i++) box(lower, [.2, .025, .2], [0, .22 + i * .34, 0], M.aluDark);

      const wrist = group(lower, 0, lowerLength, 0);
      const j4Wrist = cyl(wrist, .155, .2, [0, .06, 0], M.white);
      cyl(wrist, .12, .12, [0, .19, 0], M.steel);
      torus(wrist, .1, [0, .18, 0], M.aluDark);
      cyl(wrist, .085, .1, [0, .26, 0], M.white);

      const tool = group(wrist, 0, .3, 0);
      const flange = cyl(tool, .078, .055, [0, .03, 0], M.steel);
      const changer = cyl(tool, .065, .05, [0, .085, 0], M.aluDark);
      const gripperBody = box(tool, [.22, .1, .17], [0, .16, 0], M.dark);
      const gripperRail = box(tool, [.24, .04, .19], [0, .215, 0], M.alu);
      const leftFinger = box(tool, [.04, .16, .06], [-.075, .3, 0], M.steel);
      const rightFinger = box(tool, [.04, .16, .06], [.075, .3, 0], M.steel);
      const proximity = cyl(tool, .028, .05, [-.13, .2, 0], M.cyan);
      const changerRing = torus(tool, .062, [0, .1, 0], M.cyan);

      hose(lower, [[.1, .1, -.1], [.16, .4, -.22], [.13, .95, -.2], [.08, lowerLength - .1, -.1]], M.rubber, .02);
      hose(upper, [[.14, .08, -.14], [.2, .5, -.24], [.16, 1.1, -.2], [.08, upperLength - .05, -.12]], M.rubber, .018);

      const aim = new THREE.Vector3();
      function pose(target, gripping = false) {
        aim.copy(target);
        const side = aim.x - x;
        const forward = aim.z - z;
        const radius = Math.hypot(side, forward);
        const dy = aim.y + .62 - 1.5;
        const distance = THREE.MathUtils.clamp(Math.hypot(radius, dy), .3, upperLength + lowerLength - .02);
        const joint = Math.acos(THREE.MathUtils.clamp(
          (distance * distance - upperLength * upperLength - lowerLength * lowerLength) /
          (2 * upperLength * lowerLength), -1, 1));
        yaw.rotation.y = Math.atan2(side, forward);
        shoulder.rotation.x = Math.atan2(radius, dy) -
          Math.atan2(lowerLength * Math.sin(joint), upperLength + lowerLength * Math.cos(joint));
        elbow.rotation.x = joint;
        wrist.rotation.x = Math.PI - shoulder.rotation.x - joint;
        leftFinger.position.x = gripping ? -.045 : -.075;
        rightFinger.position.x = gripping ? .045 : .075;
      }
      const idle = new THREE.Vector3(x + .48, 1.72, z + 1.4);
      pose(idle);

      const arm = { base: baseGroup, tool, toolParts, pose, idle, index };
      arms.push(arm);

      if (index === 1) {
        /* Ordered fan: base parts sink, upper-link parts rise, so the assembly
           reads as an exploded drawing instead of a jumble. */
        armParts.push(record('robotParts', 'J1 轴底座', '预埋地脚 · 8×M20', j1Base, [0, -1.35, 0], 0));
        armParts.push(record('robotParts', 'J1 回转齿圈', '48 齿 · 渗碳淬火', j1Gear, [0, -.55, 0], 1));
        if (j2Servo) armParts.push(record('robotParts', 'J2 肩关节伺服电机', '2.0 kW 绝对值', j2Servo, [1.55, .15, .2], 1));
        armParts.push(record('robotParts', 'J2 谐波减速器', '传动比 120:1', j2Harmonic, [1.15, .55, .95], 2));
        armParts.push(record('robotParts', '大臂本体', '铝合金铸造 · 空心走线', upperBody, [.15, 1.45, 0], 0));
        armParts.push(record('robotParts', 'J3 肘关节', 'RV 减速机 · 中空轴', j3Joint, [-1.35, 1.7, 0], 1));
        armParts.push(record('robotParts', 'J3 关节端盖', '带注脂口', j3Cap, [-1.0, 2.15, .85], 2));
        armParts.push(record('robotParts', '小臂本体', '带线缆护罩', foreArm, [-.35, 2.5, 0], 0));
        armParts.push(record('robotParts', 'J4/J5 腕部', '双谐波减速器', j4Wrist, [-.6, 3.15, .15], 1));
      }

      if (index === 1) {
        toolParts.push(record('tool', '机器人法兰', 'ISO 9409-1-50-4-M6', flange, [-.34, -.02, 0], 0));
        toolParts.push(record('tool', '快换主盘', '气动锁紧 · 6 bar', changer, [.34, .04, 0], 0));
        toolParts.push(record('tool', '夹爪本体', '行程 20 mm', gripperBody, [0, .3, 0], 1));
        toolParts.push(record('tool', '夹爪导轨', '双指同步', gripperRail, [0, .44, 0], 2));
        toolParts.push(record('tool', '左夹指', '可换钳口', leftFinger, [-.28, .48, 0], 2));
        toolParts.push(record('tool', '右夹指', '可换钳口', rightFinger, [.28, .48, 0], 2));
        toolParts.push(record('tool', '夹爪位置传感器', '磁性开关', proximity, [-.32, .28, .2], 2));
        toolParts.push(record('tool', '快换到位指示环', '气隙检测', changerRing, [0, .16, .34], 1));
      }
      return arm;
    }

    robot(feed, -6.25, -.07, 0);
    const armMain = robot(robotDevice, 0, -.6, 1);
    robot(outputDevice, 6.58, -.13, 2);

    /* ---------------------------------------------------------- enclosure */

    let doorPivot = null;

    function enclosurePanel(parent, x, width, withDoor) {
      const back = -2.9;
      const front = 2.16;
      const height = 3.2;
      const left = x - width / 2;
      const right = x + width / 2;

      for (const edge of [left, right]) {
        for (const z of [back, front]) {
          profile(parent, height, .1, [edge, height / 2, z], 'y');
          box(parent, [.24, .08, .24], [edge, .04, z], M.dark);
        }
        for (const y of [.3, height]) profile(parent, front - back, .09, [edge, y, (front + back) / 2], 'z');
        const panel = box(parent, [.025, 2.55, front - back - .12], [edge, 1.75, (front + back) / 2], M.glass);
        panel.userData.skipPick = true;
        box(parent, [.035, .04, front - back - .12], [edge, 3.02, (front + back) / 2], M.alu);
        box(parent, [.035, .04, front - back - .12], [edge, .48, (front + back) / 2], M.alu);
      }
      for (const z of [back, front]) profile(parent, width, .1, [x, height, z], 'x');
      profile(parent, width, .09, [x, .3, back], 'x');
      const backPanel = box(parent, [width - .1, 2.55, .025], [x, 1.75, back], M.glass);
      backPanel.userData.skipPick = true;
      box(parent, [width - .1, .04, .03], [x, 3.02, back], M.alu);
      box(parent, [width - .1, .04, .03], [x, .48, back], M.alu);

      if (!withDoor) {
        profile(parent, width, .09, [x, .3, front], 'x');
        const frontPanel = box(parent, [width - .1, 2.55, .025], [x, 1.75, front], M.glass);
        frontPanel.userData.skipPick = true;
        box(parent, [width - .1, .04, .03], [x, 3.02, front], M.alu);
        box(parent, [width - .1, .04, .03], [x, .48, front], M.alu);
        return;
      }

      const door = group(parent, right, 0, front + .02);
      doorPivot = door;
      for (const y of [.4, 2.95]) profile(door, width - .14, .07, [-(width - .14) / 2, y, 0], 'x');
      profile(door, 2.55, .07, [-(width - .14), 1.68, 0], 'y');
      const doorPanel = box(door, [width - .2, 2.4, .022], [-(width - .14) / 2 - .03, 1.68, 0], M.glass);
      doorPanel.userData.skipPick = true;
      box(door, [.06, .34, .07], [-(width - .16), 1.2, .06], M.rubber);
      box(door, [.11, .22, .05], [-(width - .2), 1.2, .1], M.steel);
      for (const y of [1.05, 2.3]) cyl(door, .035, .12, [0, y, .05], M.steel, 'z');
      box(parent, [.1, .16, .09], [right - .02, 1.02, front + .1], M.amber);
      cyl(parent, .05, .05, [right - .02, 1.02, front + .16], M.red, 'z');
    }

    enclosurePanel(safetyDevice, -5.98, 3.9, false);
    enclosurePanel(safetyDevice, -.45, 4.3, true);
    enclosurePanel(safetyDevice, 5.05, 4.7, false);

    for (const x of [-5.98, -.45, 5.05]) {
      box(safetyDevice, [4.2, .03, .03], [x, 3.22, -2.9], M.aluDark);
      for (let i = 0; i < 4; i++) box(safetyDevice, [.03, .03, 4.9], [x - 1.6 + i * 1.05, 3.22, -.37], M.aluDark);
    }
    for (const side of [-1, 1]) {
      box(safetyDevice, [.08, 1.9, .08], [-.45 + side * 2.2, 1.0, 2.3], M.dark);
      box(safetyDevice, [.05, 1.7, .03], [-.45 + side * 2.14, 1.0, 2.26], M.amber);
    }

    function stackLight(parent, x, z) {
      const holder = group(parent, x, 0, z);
      cyl(holder, .032, 1.5, [0, .95, 0], M.steel);
      const bulbs = [M.green, M.amber, M.red].map((matItem, i) => cyl(holder, .07, .1, [0, 1.78 + i * .11, 0], matItem));
      cyl(holder, .078, .04, [0, 2.12, 0], M.dark);
      cyl(holder, .078, .04, [0, 1.72, 0], M.dark);
      stackLights.push(bulbs);
      return holder;
    }

    box(safetyDevice, [.26, .3, .1], [1.7, 1.45, 2.3], M.yellow);
    cyl(safetyDevice, .085, .06, [1.7, 1.47, 2.37], M.red, 'z');
    stackLight(safetyDevice, -3.45, 2.45);
    stackLight(safetyDevice, 2.05, 2.45);
    stackLight(safetyDevice, 6.9, 2.45);

    /* ---------------------------------------------------------- vibratory */

    const feedParts = [];
    const feeder = group(feed, -8.75, 0, -.6);
    cyl(feeder, .52, .1, [0, .05, 0], M.dark);
    const coil = cyl(feeder, .3, .34, [0, .26, 0], M.machine);
    cyl(feeder, .36, .05, [0, .45, 0], M.aluDark);
    const bowl = group(feeder, 0, .5, 0);
    const bowlShell = cyl(bowl, .46, .3, [0, .15, 0], M.alu);
    torus(bowl, .46, [0, .3, 0], M.aluDark);
    for (let i = 0; i < 3; i++) torus(bowl, .4 - i * .07, [0, .06 + i * .09, 0], M.steel);
    const track = group(bowl);
    for (let i = 0; i < 22; i++) {
      const angle = i * .42;
      const radius = .42 - i * .008;
      box(track, [.05, .03, .07], [radius * Math.cos(angle), .02 + i * .012, radius * Math.sin(angle)], M.aluDark);
    }
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.4;
      const radius = .12 + (i % 4) * .07;
      box(bowl, [.07, .05, .05], [radius * Math.cos(angle), .06, radius * Math.sin(angle)], M.steel);
    }
    cyl(feeder, .2, .1, [0, .46, 0], M.dark);
    hose(feeder, [[.3, .3, .1], [.55, .16, .2], [.72, .1, .1]], M.rubber, .018);

    const feederController = group(feed, -9.85, .62, .35);
    box(feederController, [.34, .46, .22], [0, 0, 0], M.dark);
    box(feederController, [.3, .2, .02], [0, .1, .12], M.screen);
    cyl(feederController, .03, .02, [-.1, -.12, .12], M.amber, 'z');
    box(feederController, [.03, 1.1, .03], [-.15, -.35, -.05], M.alu);

    feedParts.push(record('feeder', '振动盘外壳', 'Ø900 不锈钢', bowlShell, [0, .68, 0], 1));
    feedParts.push(record('feeder', '螺旋供料轨道', '节距 22 mm', track, [0, .34, .48], 2));
    feedParts.push(record('feeder', '电磁振动线圈', '50 Hz 双线圈', coil, [0, -.12, .55], 0));
    feedParts.push(record('feeder', '供料控制器', '调频调幅', feederController, [-.62, .34, .45], 0));

    /* ------------------------------------------------------------ fixture */

    const fixtureParts = [];
    const fixture = group(fixtureDevice, 0, 0, BELT_Z);
    const fixtureBase = box(fixture, [1.5, .1, 1.4], [0, 1.09, 0], M.steel);
    box(fixture, [1.34, .03, 1.24], [0, 1.15, 0], M.aluDark);
    fixtureParts.push(record('fixture', '夹具底座', '45# 钢 · 磨削', fixtureBase, [0, .55, 0], 0));

    for (const [dx, dz] of [[-.5, -.45], [.5, -.45], [-.5, .45], [.5, .45]]) {
      const pin = cyl(fixture, .05, .16, [dx, 1.24, dz], M.steel);
      fixtureParts.push(record('fixture', '定位销', 'Ø10 h6 · 淬硬', pin, [dx * 2.2, .7, dz * 2.2], 2));
    }

    const jaws = {};
    for (const side of [-1, 1]) {
      const cylinderBody = box(fixture, [.22, .18, .5], [side * .56, 1.24, 0], M.dark);
      const jaw = box(fixture, [.1, .1, .44], [side * .44, 1.3, 0], M.steel);
      jaws[side] = jaw;
      fixtureParts.push(record('fixture', side < 0 ? '左夹紧气缸' : '右夹紧气缸', 'Ø32 行程 20', cylinderBody, [side * .82, .5, 0], 1));
      fixtureParts.push(record('fixture', side < 0 ? '左夹紧钳口' : '右夹紧钳口', '可调行程', jaw, [side * 1.2, .32, 0], 2));
    }

    const manifold = box(fixture, [.7, .12, .18], [0, .95, -.78], M.aluDark);
    for (let i = 0; i < 4; i++) cyl(fixture, .028, .05, [-.24 + i * .16, 1.03, -.78], M.steel);
    fixtureParts.push(record('fixture', '气动阀岛', '4 位 5 通 · 6 bar', manifold, [0, .6, -1.15], 0));
    hose(fixture, [[-.24, 1.0, -.76], [-.38, .95, -.5], [-.4, 1.05, -.2], [-.5, 1.15, -.05]], M.rubber, .017);
    hose(fixture, [[.24, 1.0, -.76], [.38, .95, -.5], [.4, 1.05, -.2], [.5, 1.15, -.05]], M.rubber, .017);
    box(fixture, [.16, .3, .16], [.72, .9, -.72], M.dark);
    cyl(fixture, .06, .22, [.72, .78, -.72], M.steel);

    /* ------------------------------------------------------------- vision */

    const visionParts = [];
    const sensor = group(visionDevice, VISION_X, 0, BELT_Z);
    for (const z of [-.86, .86]) {
      profile(sensor, 2.9, .09, [0, 1.45, z], 'y');
      box(sensor, [.22, .06, .22], [0, .03, z], M.dark);
      boltRing(sensor, .07, 4, [0, 2.92, z], 'y');
    }
    const gantryBeam = profile(sensor, 1.82, .1, [0, 2.9, 0], 'z');

    const carriage = group(sensor, 0, 2.7, 0);
    box(carriage, [.3, .22, .3], [0, 0, 0], M.dark);
    cyl(carriage, .12, .1, [0, -.11, 0], M.machine);
    const cameraBody = box(carriage, [.3, .26, .4], [0, -.26, 0], M.machine);
    cyl(carriage, .11, .12, [0, -.44, 0], M.dark);
    cyl(carriage, .075, .05, [0, -.53, 0], M.cyan);
    const ringLight = torus(carriage, .13, [0, -.5, 0], M.cyan);
    box(carriage, [.36, .04, .44], [0, -.13, 0], M.steel);
    hose(carriage, [[.14, -.2, -.16], [.26, .1, -.3], [.3, .8, -.9], [.2, 1.0, -.9]], M.rubber, .016);

    for (const dx of [-.62, .62]) {
      box(sensor, [.16, .1, 1.5], [dx, 2.62, 0], M.steel);
      box(sensor, [.12, .03, 1.4], [dx, 2.55, 0], M.cyan);
    }
    const lightController = box(sensor, [.26, .3, .18], [.9, 2.4, .4], M.dark);

    visionParts.push(record('visionParts', '工业相机', '5 MP · 35 mm 镜头', cameraBody, [0, .68, 0], 1));
    visionParts.push(record('visionParts', '视觉环形光源', '蓝色 460 nm', ringLight, [0, -.55, .5], 2));
    visionParts.push(record('visionParts', '龙门架型材', '80×80 铝型材', gantryBeam, [-.75, .12, 0], 0));
    visionParts.push(record('visionParts', '光源控制器', '4 通道恒流', lightController, [.65, .28, .3], 0));

    /* ---------------------------------------------------------------- AGV */

    const agvParts = [];
    const agv = group(outputDevice, 10.7, 0, 3.7);
    const agvBody = box(agv, [1.75, .3, 1.06], [0, .34, 0], M.dark);
    box(agv, [1.8, .07, 1.1], [0, .5, 0], M.machine);
    const agvDeck = box(agv, [1.25, .12, .78], [0, .6, 0], M.steel);
    for (const x of [-.6, .6]) for (const z of [-.5, .5]) {
      const wheel = cyl(agv, .17, .09, [x, .17, z], M.rubber, 'z');
      cyl(agv, .08, .03, [x, .17, z + Math.sign(z) * .06], M.steel, 'z');
      const corner = (x < 0 ? '左' : '右') + (z < 0 ? '前' : '后');
      agvParts.push(record('agv', corner + '驱动轮组', '双轮差速 · Ø340', wheel, [x * .5, -.02, z * .8], 1));
    }
    box(agv, [1.3, .04, .03], [0, .46, .56], M.cyan);
    box(agv, [.5, .12, .1], [0, .46, -.56], M.dark);
    cyl(agv, .012, .38, [.7, .72, -.3], M.steel);
    ball(agv, .03, [.7, .92, -.3], M.red);
    box(agv, [1.0, .04, .7], [0, .68, 0], M.oak);
    for (const dx of [-.3, 0, .3]) for (const dz of [-.2, .2]) cyl(agv, .055, .03, [dx, .71, dz], M.steel);

    agvParts.unshift(record('agv', 'AGV 车体', '载重 500 kg', agvBody, [0, .68, 0], 0));
    agvParts.push(record('agv', '举升承载平台', '行程 60 mm', agvDeck, [0, .62, 0], 1));

    /* --------------------------------------------------------- environment */

    /* A factory hall around the cell: back wall with pilasters, roof girders,
       an overhead crane, high-bay racking, neighbouring cells and floor clutter.
       Everything here is background only — no parts, no picking. */
    const hall = group(scene);

    // Back wall with pilasters and a mezzanine band.
    box(hall, [58, 8.6, .3], [2, 4.3, -15.4], M.machine);
    for (const x of [-21, -14, -7, 0, 7, 14, 21]) {
      box(hall, [.7, 8.6, .55], [x, 4.3, -15.1], M.aluDark);
      box(hall, [.7, .12, .6], [x, 6.6, -15.05], M.steel);
    }
    box(hall, [58, .3, .6], [2, 6.9, -15.05], M.aluDark);

    // Roof girders and luminaires.
    for (const z of [-14.8, -8.6, -2.4]) {
      box(hall, [58, .34, .34], [2, 7.95, z], M.aluDark);
      for (let x = -22; x <= 26; x += 4) {
        box(hall, [.12, .5, .12], [x, 7.6, z], M.steel);
      }
    }
    for (const x of [-16, -8, 0, 8, 16]) {
      for (const z of [-12, -5.4]) {
        box(hall, [2.2, .12, .5], [x, 7.62, z], M.screen);
      }
    }

    // Overhead crane: two rails, a bridge and a hoist.
    for (const z of [-10.2, -4.4]) box(hall, [50, .26, .2], [0, 7.25, z], M.yellow);
    const crane = group(hall, -5.5, 7.25, -7.3);
    box(crane, [.6, .34, 5.9], [0, 0, 0], M.yellow);
    box(crane, [1.1, .55, .9], [0, -.45, 0], M.dark);
    cyl(crane, .035, 1.7, [0, -1.5, 0], M.steel);
    box(crane, [.42, .34, .3], [0, -2.4, 0], M.dark);

    // High-bay racking flanking the line.
    for (const x of [-18.4, 18.4]) {
      const rack = group(hall, x, 0, -4);
      for (let level = 0; level < 4; level++) {
        const y = .32 + level * 1.55;
        box(rack, [1.5, .12, 17], [0, y, 0], M.aluDark);
        for (let i = 0; i < 8; i++) {
          const z = -7.2 + i * 2.05;
          box(rack, [1.15, .85, 1.3], [0, y + .48, z], level % 2 ? M.oak : M.dark);
          if (level % 2 === 0) box(rack, [1.2, .06, 1.35], [0, y + .94, z], M.steel);
        }
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) profile(rack, 6.4, .13, [side * .62, 3.2, -8.2 + i * 4.1], 'y', M.steel);
      }
      box(rack, [1.6, .1, 17], [0, 6.5, 0], M.yellow);
    }

    // Neighbouring production cells behind the line.
    for (const x of [-15, -9, -3, 3, 9, 15]) {
      const cell = group(hall, x, 0, -11.6);
      box(cell, [2.7, 1.5, 1.5], [0, .75, 0], M.dark);
      box(cell, [2.6, .1, 1.4], [0, 1.55, 0], M.aluDark);
      box(cell, [1.4, .55, .06], [0, 1.65, .66], M.screen);
      for (const side of [-1, 1]) profile(cell, 3.1, .1, [side * 1.25, 1.55, 0], 'y', M.steel);
      profile(cell, 2.5, .1, [0, 3.1, 0], 'x', M.steel);
      box(cell, [.8, .1, .06], [0, 2.9, .1], M.cyan);
    }

    // Pallet stacks, bins and a pair of operator desks along the aisle.
    for (const [x, z, count] of [[-13.6, 2.4, 4], [13.4, 2.2, 3], [10.4, 4.6, 5]]) {
      for (let i = 0; i < count; i++) box(hall, [1.0, .09, .8], [x, .06 + i * .1, z], M.oak);
      box(hall, [.95, .38, .72], [x, .12 + count * .1, z], M.dark);
    }
    for (const [x, z] of [[-10.9, 3.4], [-10.1, 3.4], [-9.3, 3.4], [8.9, 3.3], [9.7, 3.3]]) {
      box(hall, [.72, .3, .5], [x, .15, z], M.dark);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        box(hall, [.17, .12, .17], [x - .16 + i * .32, .3, z - .1 + j * .2], M.steel);
      }
    }
    for (const x of [-12.6, 12.6]) {
      const desk = group(hall, x, 0, 4.4);
      box(desk, [1.35, .07, .72], [0, .78, 0], M.machine);
      box(desk, [1.28, .58, .64], [0, .48, 0], M.dark);
      box(desk, [.62, .4, .05], [0, 1.06, -.32], M.screen);
      for (const dx of [-.52, .52]) box(desk, [.07, .78, .52], [dx, .39, 0], M.aluDark);
      cyl(desk, .028, .5, [.46, 1.05, .18], M.steel);
    }

    // Guard rails marking the AGV aisle.
    for (const z of [6.6, -5.8]) {
      for (let x = -14; x <= 14; x += 2.8) {
        cyl(hall, .04, .82, [x, .41, z], M.rail);
        box(hall, [.08, .08, .36], [x, .82, z], M.rail);
      }
      for (let x = -14; x <= 14; x += 2.8) box(hall, [2.8, .06, .06], [x + 1.4, .76, z], M.rail);
    }

    /* ------------------------------------------------------------ products */

    const pallet = group(scene, FEED_X, BELT_TOP, BELT_Z);
    box(pallet, [.86, .055, .7], [0, .03, 0], M.oak);
    for (const z of [-.26, 0, .26]) box(pallet, [.9, .045, .1], [0, .075, z], M.oak);
    for (const x of [-.3, .3]) box(pallet, [.1, .04, .68], [x, .012, 0], M.oak);

    const productRoot = group(scene);
    const base = group(productRoot);
    const productA = group(base);
    box(productA, [.54, .1, .42], [0, .07, 0], M.steel);
    for (const dx of [-.16, .16]) box(productA, [.1, .12, .41], [dx, .17, 0], M.dark);
    for (const dx of [-.17, .17]) for (const dz of [-.14, .14]) cyl(productA, .03, .04, [dx, .23, dz], M.steel);
    box(productA, [.2, .02, .12], [0, .235, .02], M.cyan);
    const productB = group(base);
    cyl(productB, .22, .12, [0, .07, 0], M.steel);
    cyl(productB, .13, .1, [0, .18, 0], M.dark);
    for (const dx of [-.13, .13]) box(productB, [.1, .08, .11], [dx, .18, 0], M.green);
    const insert = group(productRoot);
    const insertA = box(insert, [.24, .1, .24], [0, .07, 0], M.white);
    const insertB = cyl(insert, .09, .14, [0, .08, 0], M.white);

    const scan = mesh(sensor, geo.cone, M.beam, [.48, .92, .48], [0, 1.88, 0]);
    scan.userData.skipPick = true;
    scan.visible = false;

    /* -------------------------------------------------------------- bounds */

    for (const info of Object.values(devices)) {
      const bounds = new THREE.Box3().setFromObject(info.group);
      bounds.getCenter(info.focus);
    }

    const selection = new THREE.BoxHelper(armMain.base, '#6fe6ff');
    selection.material.transparent = true;
    selection.material.opacity = .5;
    selection.visible = false;
    scene.add(selection);
    geometries.add(selection.geometry);
    materials.add(selection.material);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(.82, 1, 72),
      new THREE.MeshBasicMaterial({ color: '#4fd8ff', transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = .012;
    halo.visible = false;
    halo.userData.radius = 2;
    scene.add(halo);
    geometries.add(halo.geometry);
    materials.add(halo.material);

    function describeBoxes() {
      const report = {};
      for (const [id, info] of Object.entries(devices)) {
        const box = new THREE.Box3().setFromObject(info.group);
        const size = new THREE.Vector3();
        box.getSize(size);
        const bad = [];
        info.group.traverse(object => {
          if (!object.isMesh || !object.geometry) return;
          const position = object.geometry.getAttribute('position');
          if (!position) { bad.push('no-position'); return; }
          const array = position.array;
          for (let i = 0; i < array.length; i++) {
            if (!Number.isFinite(array[i])) { bad.push(object.geometry.type + ':geometry-NaN'); return; }
          }
          for (const value of object.position.toArray()) if (!Number.isFinite(value)) { bad.push(object.geometry.type + ':position-NaN'); return; }
          for (const value of object.scale.toArray()) if (!Number.isFinite(value)) { bad.push(object.geometry.type + ':scale-NaN'); return; }
          for (const value of object.matrixWorld.elements) if (!Number.isFinite(value)) {
            bad.push(object.geometry.type + ':matrix-NaN scale=' + object.scale.toArray().join(',') +
              ' pos=' + object.position.toArray().join(','));
            return;
          }
        });
        report[id] = {
          min: box.min.toArray().map(v => Number.isFinite(v) ? Math.round(v * 100) / 100 : String(v)),
          max: box.max.toArray().map(v => Number.isFinite(v) ? Math.round(v * 100) / 100 : String(v)),
          size: size.toArray().map(v => Number.isFinite(v) ? Math.round(v * 100) / 100 : String(v)),
          meshes: (() => { let n = 0; info.group.traverse(o => { if (o.isMesh) n++; }); return n; })(),
          bad: bad.slice(0, 6)
        };
      }
      return report;
    }

    function update(time) {
      if (!halo.visible) return;
      const pulse = 1 + Math.sin(time * 2.2) * .035;
      halo.scale.setScalar(halo.userData.radius * pulse);
      halo.material.opacity = .2 + Math.sin(time * 2.2) * .07;
    }

    function dispose() {
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      floorTexture.dispose();
    }

    return {
      scene, devices, parts, sub, arms,
      conveyorParts, armParts, fixtureParts, feedParts, visionParts, agvParts,
      pallet, base, insert, productA, productB, insertA, insertB, scan,
      door: doorPivot, stackLights, selection, halo, materials: M, jaws,
      describeBoxes,
      beltZ: BELT_Z, beltTop: BELT_TOP, palletY: PALLET_Y,
      feedX: FEED_X, visionX: VISION_X, outX: OUT_X,
      update, dispose
    };
  }

  window.RobotModel = { build };
})();
