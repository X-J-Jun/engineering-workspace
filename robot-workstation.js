/* Interactive digital-twin viewer for the flexible assembly workstation.
   Geometry lives in robot-model.js; this file owns the HUD, the exploded view
   and the production simulation. */
(() => {
  'use strict';

  const devices = [
    { id: 'feed', name: '上料与输送', index: '01', description: '入口料仓、振动供料与模组化输送线；托盘由入口段送入装配工位。' },
    { id: 'robot', name: '六轴工业机器人', index: '02', description: '三台六轴机械臂分别承担上料、装配与下料；装配臂配快换夹爪与力控。' },
    { id: 'fixture', name: '柔性装配夹具', index: '03', description: '定位销、气动夹紧与随行托盘构成柔性夹具，可在两种工件间切换。' },
    { id: 'vision', name: '视觉定位与检测', index: '04', description: '龙门架安装工业相机与环形光源，完成识别与装配后检测。' },
    { id: 'safety', name: '安全防护', index: '05', description: '铝型材围栏、安全门、安全互锁与光幕，保证人机隔离。' },
    { id: 'output', name: '成品输出', index: '06', description: '下料机械臂将成品移入成品料箱，AGV 负责整箱转运。' }
  ];
  const deviceById = Object.fromEntries(devices.map(device => [device.id, device]));

  const phases = [
    { name: '上料', device: 'feed', duration: 2.8 },
    { name: '输送定位', device: 'fixture', duration: 2 },
    { name: '取装配件', device: 'robot', duration: 1.3 },
    { name: '转移与装配', device: 'robot', duration: 2.1 },
    { name: '视觉检测', device: 'vision', duration: 2.8 },
    { name: '输送成品', device: 'output', duration: 1.8 },
    { name: '下料', device: 'output', duration: 2.8 }
  ];

  const explodeGroups = [
    { id: 'robotParts', label: '机器人关节', device: 'robot' },
    { id: 'fixture', label: '柔性夹具', device: 'fixture' },
    { id: 'visionParts', label: '视觉检测', device: 'vision' },
    { id: 'conveyor', label: '输送线驱动', device: 'feed' },
    { id: 'feeder', label: '振动供料', device: 'feed' },
    { id: 'agv', label: 'AGV 搬运车', device: 'output' },
    { id: 'tool', label: '末端执行器', device: 'robot' },
    { id: 'all', label: '整线总装', device: null }
  ];

  let libraries;

  function loadLibraries() {
    libraries ||= Promise.all([
      import('https://esm.sh/three@0.170.0'),
      import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js')
    ]);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('3D 组件加载超时')), 9000);
      libraries.then(resolve, reject).finally(() => clearTimeout(timeout));
    });
  }

  /* Soft studio environment so metal reads correctly without extra imports. */
  function environmentMap(THREE, renderer) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1b3348');
    gradient.addColorStop(.45, '#7d95ab');
    gradient.addColorStop(.62, '#2a3f55');
    gradient.addColorStop(1, '#0b1520');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 256);
    const glow = context.createRadialGradient(150, 70, 4, 150, 70, 130);
    glow.addColorStop(0, 'rgba(255,255,255,.95)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, 512, 256);
    const cool = context.createRadialGradient(390, 120, 4, 390, 120, 150);
    cool.addColorStop(0, 'rgba(110,205,255,.75)');
    cool.addColorStop(1, 'rgba(110,205,255,0)');
    context.fillStyle = cool;
    context.fillRect(0, 0, 512, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(texture);
    pmrem.dispose();
    texture.dispose();
    return target.texture;
  }

  async function createViewer(host, { preview = false, offsetX = 0 } = {}) {
    const [THREE, { OrbitControls }] = await loadLibraries();
    if (!window.RobotModel) throw new Error('缺少 3D 模型模块');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: preview ? 'low-power' : 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, preview ? 1 : 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = preview ? .95 : 1.08;
    if (!preview) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    host.append(renderer.domElement);

    const model = window.RobotModel.build(THREE, { preview });
    const scene = model.scene;

    let environment = null;
    try {
      environment = environmentMap(THREE, renderer);
      scene.environment = environment;
      scene.environmentIntensity = .55;
    } catch { /* environment is optional */ }

    scene.add(new THREE.HemisphereLight('#dcecff', '#31465a', preview ? 2.2 : 1.7));
    const key = new THREE.DirectionalLight('#fff3e6', preview ? 2.4 : 2.7);
    key.position.set(-6, 13, 9);
    if (!preview) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 42;
      key.shadow.camera.left = -18;
      key.shadow.camera.right = 18;
      key.shadow.camera.top = 14;
      key.shadow.camera.bottom = -12;
      key.shadow.bias = -.0008;
      key.shadow.normalBias = .02;
    }
    const rim = new THREE.DirectionalLight('#79c8ff', 1.9);
    rim.position.set(8, 6, -10);
    const fill = new THREE.DirectionalLight('#ffd9b0', .65);
    fill.position.set(-11, 3, -4);
    const follow = new THREE.DirectionalLight('#a9d8ff', .9);
    follow.position.set(-1, 7, 6);
    scene.add(key, rim, fill, follow);

    const camera = new THREE.PerspectiveCamera(36, 1, .1, 120);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .075;
    controls.autoRotateSpeed = .55;
    controls.enablePan = !preview;
    controls.enableZoom = !preview;
    controls.minDistance = 2.4;
    controls.maxDistance = 62;
    controls.minPolarAngle = .32;
    controls.maxPolarAngle = 1.48;
    controls.autoRotate = preview && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!preview) {
      scene.traverse(object => {
        if (!object.isMesh) return;
        if (object.userData.skipPick) return;
        if (object.material === model.materials.glass) return;
        object.castShadow = true;
        object.receiveShadow = false;
      });
      // The floor is the shadow catcher.
      scene.children.forEach(child => {
        if (child.isMesh && child.material === model.materials.floor) child.receiveShadow = true;
      });
    }

    const desiredPosition = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const homeDirection = new THREE.Vector3(10.2, 8.6, 12.4).normalize();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    let homeDistance = 21;
    let overview = true;
    let focusMoving = false;
    let visible = false;
    let stopped = false;
    let frameId = 0;
    let previousTime = 0;
    let draw = true;
    let clock = 0;
    let frames = 0;
    let update = () => {};
    let overlay = () => {};
    let homeTarget = new THREE.Vector3(offsetX, 1.32, .2);

    const tempBox = new THREE.Box3();
    const tempVector = new THREE.Vector3();

    function fitDistance(box, padding = 1.25, tall = true) {
      box.getSize(tempVector);
      const size = Math.max(tempVector.x, tempVector.y * (tall ? 1.4 : 1), tempVector.z);
      if (!Number.isFinite(size) || size <= 0) return NaN;
      const vertical = size / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const horizontal = vertical / Math.max(.55, camera.aspect);
      return Math.max(1.2, Math.min(46, Math.max(vertical, horizontal) * padding));
    }

    function home(immediate = false) {
      overview = true;
      desiredTarget.copy(homeTarget);
      desiredPosition.copy(homeDirection).multiplyScalar(homeDistance).add(desiredTarget);
      focusMoving = !immediate;
      if (immediate) {
        camera.position.copy(desiredPosition);
        controls.target.copy(desiredTarget);
        controls.update();
      }
      draw = true;
    }

    function frameBox(box, { padding = 1.2, direction = null, immediate = false, tall = true } = {}) {
      overview = false;
      box.getCenter(desiredTarget);
      const distance = fitDistance(box, padding, tall);
      if (!Number.isFinite(desiredTarget.x) || !Number.isFinite(desiredTarget.y) ||
          !Number.isFinite(desiredTarget.z) || !Number.isFinite(distance) || distance <= 0) {
        // A degenerate bounding box must never poison the camera.
        overview = true;
        desiredTarget.copy(homeTarget);
        desiredPosition.copy(homeDirection).multiplyScalar(homeDistance).add(desiredTarget);
        focusMoving = !immediate;
        draw = true;
        return;
      }
      const dir = direction || homeDirection;
      desiredPosition.copy(dir).normalize().multiplyScalar(distance).add(desiredTarget);
      focusMoving = !immediate;
      if (immediate) {
        camera.position.copy(desiredPosition);
        controls.target.copy(desiredTarget);
        controls.update();
      }
      draw = true;
    }

    function focusObject(object, options = {}) {
      tempBox.setFromObject(object);
      frameBox(tempBox, options);
    }

    function resize() {
      const { clientWidth: width, clientHeight: height } = host;
      if (stopped || !width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      const fit = 12.6 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      homeDistance = Math.min(36, Math.max(14, fit));
      if (overview) home(true);
      draw = true;
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    controls.addEventListener('start', () => { focusMoving = false; overview = false; });
    controls.addEventListener('change', () => { draw = true; });

    function tick(time) {
      frameId = 0;
      if (stopped || !visible || document.hidden) return;
      const dt = previousTime ? Math.min((time - previousTime) / 1000, .15) : 0;
      previousTime = time;
      clock += dt;
      frames++;

      const animated = update(dt, clock);
      model.update(clock);

      if (model.halo.visible) {
        model.halo.position.y = .014 + Math.sin(clock * 1.7) * .004;
      }

      if (focusMoving) {
        const blend = 1 - Math.exp(-dt * 6.2);
        camera.position.lerp(desiredPosition, blend);
        controls.target.lerp(desiredTarget, blend);
        if (camera.position.distanceToSquared(desiredPosition) < .0004 && controls.target.distanceToSquared(desiredTarget) < .0004) {
          focusMoving = false;
        }
        draw = true;
      }
      controls.update(dt);
      if (animated || draw) {
        renderer.render(scene, camera);
        overlay(camera);
        draw = false;
      }
      frameId = requestAnimationFrame(tick);
    }

    function stopFrame() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      previousTime = 0;
    }

    function schedule() {
      stopFrame();
      if (!stopped && visible && !document.hidden) {
        draw = true;
        frameId = requestAnimationFrame(tick);
      }
    }

    function setVisible(value) {
      if (stopped || value === visible) return;
      visible = value;
      if (visible) resize();
      schedule();
    }

    function destroy() {
      if (stopped) return;
      stopped = true;
      stopFrame();
      observer.disconnect();
      controls.dispose();
      model.dispose();
      environment?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }

    document.addEventListener('visibilitychange', schedule);
    home(true);
    resize();
    return {
      THREE, model, scene, camera, controls, element: renderer.domElement,
      home, frameBox, focusObject, setVisible, resize, destroy,
      invalidate() { draw = true; },
      debug() { return { frames, visible, overview, focusMoving }; },
      setUpdate(callback, renderOverlay) { update = callback; overlay = renderOverlay; }
    };
  }

  function addFallback(container, message) {
    const fallback = container.querySelector('.robot-station-error');
    if (!fallback) return;
    fallback.textContent = message;
    fallback.hidden = false;
  }

  function chooseDevice(buttons, callback, id) {
    const device = deviceById[id];
    if (!device) return;
    for (const button of buttons.querySelectorAll('[data-device]')) {
      button.setAttribute('aria-pressed', String(button.dataset.device === id));
    }
    callback?.({ ...device });
  }

  const smooth = value => value * value * (3 - 2 * value);

  function updateAssembly(viewer, stage, progress, modelKind) {
    const { model } = viewer;
    const THREE = viewer.THREE;
    const { arms, base, insert, pallet, scan, jaws } = model;
    const input = [-6.72, 1.13, 1.92];
    const stock = [.53, 1.26, 1.65];
    const output = [7.04, 1.13, 1.97];
    const pace = (a, b) => THREE.MathUtils.smoothstep(progress, a, b);
    const mix = (from, to, t) => THREE.MathUtils.lerp(from, to, t);
    const points = [[model.feedX, model.feedX], [model.feedX, 0], [0, 0], [0, 0], [0, model.visionX], [model.visionX, model.outX], [model.outX, model.outX]];
    const interval = points[stage] || [model.feedX, model.feedX];
    const trayX = mix(interval[0], interval[1], stage === 4 ? pace(0, .68) : pace(0, 1));
    const onTray = [trayX, model.palletY, model.beltZ];
    const assembly = [trayX, model.palletY + (modelKind === 'A' ? .135 : .22), model.beltZ];
    pallet.position.x = trayX;
    base.position.set(...onTray);
    insert.position.set(...(stage > 3 ? assembly : stock));
    scan.visible = stage === 4 && progress > .56;
    for (const arm of arms) arm.pose(arm.idle);

    function transfer(object, arm, source, destination, fraction, lift) {
      const point = object.position;
      point.set(
        mix(source[0], destination[0], fraction),
        mix(source[1], destination[1], fraction) + Math.sin(Math.PI * fraction) * lift,
        mix(source[2], destination[2], fraction));
      arm.pose(point, fraction > 0 && fraction < 1);
    }

    if (stage === -1) {
      base.position.set(...input);
    } else if (stage === 0) {
      transfer(base, arms[0], input, onTray, pace(.08, .92), .62);
    } else if (stage === 2) {
      transfer(insert, arms[1], stock, [stock[0], 1.88, stock[2]], pace(.12, .94), 0);
    } else if (stage === 3) {
      transfer(insert, arms[1], [stock[0], 1.88, stock[2]], assembly, pace(.03, .94), .27);
    } else if (stage === 6) {
      transfer(base, arms[2], onTray, output, pace(.07, .93), .65);
      insert.position.copy(base.position);
      insert.position.y += modelKind === 'A' ? .135 : .22;
    }
    const closing = stage === 3 ? .09 * pace(.45, .88) : 0;
    if (jaws) {
      jaws[-1].position.x = -.44 + closing;
      jaws[1].position.x = .44 - closing;
    }
  }

  async function mount(container, { onSelect, details } = {}) {
    container.innerHTML =
      '<div class="robot-station">' +
      '<div class="rw-statusbar">' +
      '<span class="rw-pulse" aria-hidden="true"></span>' +
      '<p class="rw-state" role="status">正在加载 3D 场景…</p>' +
      '<p class="rw-stage" aria-live="polite">工序 · 待机</p>' +
      '<span class="rw-tag">方案示意 · 模拟运行</span>' +
      '</div>' +
      '<div class="robot-station-layout">' +
      '<aside class="rw-side rw-devices" aria-label="工作站设备"><header><h3>产线矩阵</h3><b>06</b></header>' +
      '<div class="rw-device-buttons"></div>' +
      '<p class="rw-side-note">点击设备聚焦 · 拖动模型旋转</p></aside>' +
      '<div class="rw-viewport">' +
      '<div class="rw-canvas"></div>' +
      '<span class="rw-frame" aria-hidden="true"></span>' +
      '<span class="rw-selection" hidden></span>' +
      '<svg class="rw-leaders" aria-hidden="true"></svg>' +
      '<div class="rw-annotations" aria-hidden="true"></div>' +
      '<div class="rw-legend"><i class="rw-key rw-key-cyan"></i>运行中 <i class="rw-key rw-key-amber"></i>待机 <i class="rw-key rw-key-red"></i>急停</div>' +
      '<div class="rw-hint">拖动旋转 · 滚轮缩放 · 点击零件查看参数</div>' +
      '<div class="rw-loading">3D 场景加载中…</div>' +
      '<div class="robot-station-error" role="status" hidden></div>' +
      '</div>' +
      '<aside class="rw-side rw-detail">' +
      '<div class="rw-parts" hidden><header><h3>拆解清单</h3><b class="rw-parts-count">0</b></header><ol></ol></div>' +
      '<div class="robot-station-detail"></div>' +
      '</aside>' +
      '</div>' +
      '<div class="rw-toolbar">' +
      '<fieldset class="rw-tools"><legend>数字孪生拆解</legend>' +
      '<label class="rw-select">拆解对象<select data-role="explode-sub">' +
      explodeGroups.map(group => '<option value="' + group.id + '">' + group.label + '</option>').join('') +
      '</select></label>' +
      '<label class="rw-range">拆解程度<input type="range" min="0" max="100" value="0" data-role="explode-range" aria-label="拆解程度"></label>' +
      '<button type="button" data-action="explode">一键拆解</button>' +
      '<button type="button" class="secondary" data-action="assemble">重新组装</button>' +
      '</fieldset>' +
      '<fieldset class="rw-tools"><legend>生产模拟</legend>' +
      '<button type="button" data-action="play">开始生产</button>' +
      '<button type="button" class="secondary" data-action="pause">暂停</button>' +
      '<button type="button" class="secondary" data-action="stop">停止复位</button>' +
      '<button type="button" class="secondary" data-action="model">工件 A</button>' +
      '</fieldset>' +
      '<fieldset class="rw-tools"><legend>安全联锁</legend>' +
      '<button type="button" class="secondary" data-action="door">打开安全门</button>' +
      '<button type="button" class="danger" data-action="emergency">急停</button>' +
      '</fieldset>' +
      '<fieldset class="rw-tools"><legend>视角</legend>' +
      '<button type="button" class="secondary" data-action="rotate" aria-pressed="false">自动环视</button>' +
      '<button type="button" class="secondary" data-action="reset">整线总览</button>' +
      '</fieldset>' +
      '</div></div>';

    const ui = container.querySelector('.robot-station');
    if (details) ui.querySelector('.robot-station-detail').append(details);

    const refs = {
      viewport: ui.querySelector('.rw-viewport'),
      canvas: ui.querySelector('.rw-canvas'),
      status: ui.querySelector('.rw-state'),
      stage: ui.querySelector('.rw-stage'),
      deviceButtons: ui.querySelector('.rw-device-buttons'),
      selection: ui.querySelector('.rw-selection'),
      leaders: ui.querySelector('.rw-leaders'),
      annotations: ui.querySelector('.rw-annotations'),
      loading: ui.querySelector('.rw-loading'),
      parts: ui.querySelector('.rw-parts'),
      partsList: ui.querySelector('.rw-parts ol'),
      partsCount: ui.querySelector('.rw-parts-count'),
      range: ui.querySelector('[data-role="explode-range"]'),
      subSelect: ui.querySelector('[data-role="explode-sub"]')
    };
    const actions = Object.fromEntries([...ui.querySelectorAll('[data-action]')].map(button => [button.dataset.action, button]));
    refs.deviceButtons.innerHTML = devices.map(device =>
      '<button type="button" data-device="' + device.id + '"><span class="rw-idx">' + device.index + '</span>' +
      '<span class="rw-name">' + device.name + '</span><i class="rw-led" aria-hidden="true"></i></button>').join('');

    const events = new AbortController();
    const listener = { signal: events.signal };
    refs.deviceButtons.addEventListener('click', event => {
      const button = event.target.closest('[data-device]');
      if (button) select(button.dataset.device);
    }, listener);

    let viewer;
    let select = id => chooseDevice(refs.deviceButtons, onSelect, id);
    select('feed');

    try {
      viewer = await createViewer(refs.canvas);
    } catch (error) {
      refs.status.textContent = '3D 场景暂不可用';
      refs.loading.hidden = true;
      addFallback(ui, '可使用左侧设备列表查看关联记录。');
      for (const action of Object.values(actions)) action.disabled = true;
      return { select(id) { select(id); }, resize() {}, setVisible() {}, destroy() { events.abort(); ui.remove(); } };
    }

    const { THREE, model } = viewer;
    const { parts, sub } = model;
    refs.loading.hidden = true;
    ui.classList.add('is-ready');

    const partGroups = {
      tool: model.arms[1].toolParts,
      robotParts: model.armParts,
      fixture: model.fixtureParts,
      conveyor: model.conveyorParts,
      feeder: model.feedParts,
      visionParts: model.visionParts,
      agv: model.agvParts
    };
    const activeSources = { ...partGroups, all: Object.values(partGroups).flat() };

    /* Part state: every registered part tracks its own explode amount. */
    for (const part of parts) {
      part.amount = 0;
      part.target = 0;
      part.localOffset = part.offset.clone();
      part.worldPosition = new THREE.Vector3();
      const geometry = part.object.geometry;
      if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere();
      const scale = Math.max(
        Math.abs(part.object.scale.x), Math.abs(part.object.scale.y), Math.abs(part.object.scale.z), 1);
      part.radius = geometry?.boundingSphere ? geometry.boundingSphere.radius * scale : .25;
    }

    /* Radial exploded view: every part moves away from its sub-assembly centroid
       by a distance proportional to the assembly radius, biased upward so nothing
       sinks through the floor. Falls back to the authored offset if needed. */
    const subMeta = {};
    function computeSubMeta() {
      model.scene.updateMatrixWorld(true);
      const bySub = {};
      for (const part of parts) {
        const position = part.object.getWorldPosition(new THREE.Vector3());
        (bySub[part.sub] ||= []).push(position);
      }
      for (const [id, list] of Object.entries(bySub)) {
        const center = new THREE.Vector3();
        for (const position of list) center.add(position);
        center.divideScalar(list.length);
        let radius = 0;
        for (const position of list) radius = Math.max(radius, position.distanceTo(center));
        subMeta[id] = { center, radius: Math.max(radius, .22) };
      }
    }

    function refreshExplodeOffsets() {
      model.scene.updateMatrixWorld(true);
      const roots = new Set(parts.map(part => part.object));
      // The end effector is only a few centimetres across, so its parts are laid
      // out in a world-space row (like a parts tray) instead of radially.
      const toolStack = sub.tool || [];
      const toolDirection = new THREE.Vector3(.86, .3, .42).normalize();
      toolStack.forEach((part, index) => {
        const parent = part.object.parent;
        if (!parent) return;
        const worldHome = parent.localToWorld(part.home.clone());
        const target = worldHome.clone().addScaledVector(toolDirection, .1 + index * .17);
        part.localOffset = parent.worldToLocal(target).sub(part.home);
        part.offset.copy(toolDirection);
      });
      for (const part of parts) {
        if (part.sub === 'tool') continue;
        const parent = part.object.parent;
        if (!parent) { part.localOffset = part.offset.clone(); continue; }
        // A part nested inside another part (motor inside drive unit) travels with
        // its parent, so it only needs a small extra gap to stay readable.
        let ancestor = parent;
        let nested = false;
        while (ancestor && ancestor !== model.scene) {
          if (roots.has(ancestor)) { nested = true; break; }
          ancestor = ancestor.parent;
        }
        const direction = part.offset.clone();
        if (direction.lengthSq() < 1e-4) direction.set(0, 1, 0);
        direction.normalize();
        direction.y = Math.max(direction.y, .14);
        direction.normalize();
        const distance = nested
          ? .3
          : THREE.MathUtils.clamp(.52 + (part.radius || .2) * .5, .5, 1.25) *
            (part.sub === 'tool' ? .45 : 1);
        const worldHome = parent.localToWorld(part.home.clone());
        const worldTarget = worldHome.clone().addScaledVector(direction, distance);
        part.localOffset = parent.worldToLocal(worldTarget).sub(part.home);
        part.offset.copy(direction).multiplyScalar(distance);
      }
    }

    computeSubMeta();

    let selectedDevice = 'feed';
    let lastExplodeSize = new THREE.Vector3();
    let pendingExplodeFrame = false;
    let explodeSub = null;
    let explodeValue = 0;
    let explodeTarget = 0;
    let highlighted = null;
    const highlightBox = new THREE.BoxHelper(model.arms[1].base, '#8ef0ff');
    highlightBox.material.transparent = true;
    highlightBox.material.opacity = .55;
    highlightBox.material.depthTest = false;
    highlightBox.visible = false;
    model.scene.add(highlightBox);

    const annotations = new Map();
    const labelCards = [];
    for (let i = 0; i < 12; i++) {
      const card = document.createElement('span');
      card.className = 'rw-annot';
      card.hidden = true;
      card.innerHTML = '<b class="rw-annot-index"></b><span class="rw-annot-text"></span>';
      refs.annotations.append(card);
      labelCards.push(card);
    }
    const leaderLines = [];
    for (let i = 0; i < 12; i++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'rw-leader');
      line.style.display = 'none';
      refs.leaders.append(line);
      leaderLines.push(line);
    }

    let running = false;
    let paused = false;
    let doorOpen = false;
    let emergency = false;
    let modelKind = 'A';
    let phaseIndex = -1;
    let timeInPhase = 0;
    let simulationMessage = '工序 · 待机';

    function syncControls() {
      actions.pause.textContent = paused ? '继续' : '暂停';
      actions.pause.disabled = !running;
      actions.model.textContent = '工件 ' + modelKind;
      actions.door.textContent = doorOpen ? '关闭安全门' : '打开安全门';
      actions.emergency.textContent = emergency ? '解除急停' : '急停';
      actions.emergency.classList.toggle('active', emergency);
      actions.explode.disabled = false;
      actions.rotate.setAttribute('aria-pressed', String(viewer.controls.autoRotate));
      const state = emergency ? '急停已触发' : doorOpen ? '安全门已打开' : running ? (paused ? '模拟已暂停' : '模拟运行中') : '待机';
      refs.status.textContent = state;
      refs.status.dataset.state = emergency ? 'stop' : doorOpen || paused ? 'hold' : running ? 'run' : 'idle';
      refs.stage.textContent = simulationMessage;
      const signal = emergency ? 2 : doorOpen || paused ? 1 : 0;
      for (const bulbs of model.stackLights) {
        for (const [i, bulb] of bulbs.entries()) {
          bulb.material = i === signal ? bulb.userData.lit : model.materials.dark;
        }
      }
      viewer.invalidate();
    }

    for (const bulbs of model.stackLights) for (const bulb of bulbs) bulb.userData.lit = bulb.material;

    function setHighlight(object) {
      highlighted = object;
      if (!object) {
        highlightBox.visible = false;
        refs.selection.hidden = true;
        return;
      }
      highlightBox.setFromObject(object);
      highlightBox.visible = true;
      const meta = parts.find(part => part.object === object);
      if (meta) {
        refs.selection.hidden = false;
        refs.selection.innerHTML = '<b>' + meta.name + '</b><span>' + meta.spec + '</span>';
      }
    }

    function framesFor(id) {
      const info = model.devices[id];
      if (!info) return null;
      const box = new THREE.Box3().setFromObject(info.group);
      return box;
    }

    select = (id, moveCamera = true, announcement) => {
      if (!deviceById[id]) return;
      selectedDevice = id;
      chooseDevice(refs.deviceButtons, onSelect, id);
      const info = model.devices[id];
      const box = new THREE.Box3().setFromObject(info.group);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const measurable = !box.isEmpty() && Number.isFinite(center.x) && Number.isFinite(center.z) &&
        Number.isFinite(size.x) && Number.isFinite(size.z);
      model.selection.visible = measurable && !explodeSub;
      if (model.selection.visible) model.selection.setFromObject(info.group);
      model.halo.visible = measurable;
      if (measurable) {
        model.halo.position.set(center.x, .014, center.z);
        model.halo.userData.radius = THREE.MathUtils.clamp(Math.min(size.x, size.z) * .55, 1.1, 2.3);
      }
      refs.selection.hidden = false;
      refs.selection.innerHTML = '<b>' + (deviceById[id]?.name || '') + '</b><span>' + (announcement || deviceById[id]?.index || '') + '</span>';
      if (moveCamera && measurable) {
        viewer.controls.autoRotate = false;
        viewer.frameBox(box, { padding: 1.15 });
      }
      viewer.invalidate();
      syncControls();
    };

    function setIsolation(hostDevice) {
      for (const [id, info] of Object.entries(model.devices)) {
        const keep = !hostDevice || hostDevice === 'all' || id === hostDevice;
        info.group.visible = keep;
      }
    }

    /* While a sub-assembly is exploded, hide every mesh that is not one of its
       registered parts so the residual machine does not read as a duplicate. */
    function setPartVisibility(activeParts) {
      if (!activeParts) {
        for (const info of Object.values(model.devices)) {
          info.group.traverse(object => { if (object.isMesh) object.visible = true; });
        }
        return;
      }
      const keep = new Set();
      for (const part of activeParts) part.object.traverse(object => keep.add(object));
      for (const info of Object.values(model.devices)) {
        info.group.traverse(object => {
          if (object.isMesh) object.visible = keep.has(object);
        });
      }
    }

    function setExplode(groupId) {
      explodeSub = groupId;
      explodeTarget = 1;
      const group = explodeGroups.find(item => item.id === groupId);
      if (running) {
        running = false;
        paused = false;
        phaseIndex = -1;
        timeInPhase = 0;
      }
      updateAssembly(viewer, -1, 0, modelKind);
      refreshExplodeOffsets();
      if (group?.device) select(group.device, false);
      setIsolation(group?.device || 'all');
      setPartVisibility(groupId === 'tool' ? activeSources.tool : null);
      renderPartList();
      refs.parts.hidden = false;
      simulationMessage = '拆解 · ' + (group?.label || '设备');
      // Framing happens once the parts have actually settled (see the update loop);
      // predicting the bounding box from offsets proved unreliable.
      pendingExplodeFrame = true;
      syncControls();
    }

    function assemble() {
      explodeTarget = 0;
      explodeSub = null;
      setIsolation(null);
      setPartVisibility(null);
      model.selection.visible = Boolean(selectedDevice);
      simulationMessage = '已重新组装';
      viewer.home();
      syncControls();
    }

    function renderPartList() {
      const source = activeSources[explodeSub] || [];
      refs.partsCount.textContent = String(source.length).padStart(2, '0');
      refs.partsList.innerHTML = source.map((part, i) =>
        '<li data-part="' + parts.indexOf(part) + '"><b>' + String(i + 1).padStart(2, '0') + '</b>' +
        '<span><strong>' + part.name + '</strong><em>' + part.spec + '</em></span></li>').join('');
      for (const part of source) {
        if (!annotations.has(part)) {
          annotations.set(part, true);
        }
      }
    }

    refs.partsList.addEventListener('click', event => {
      const row = event.target.closest('[data-part]');
      if (!row) return;
      const part = parts[Number(row.dataset.part)];
      if (!part) return;
      explodeTarget = Math.max(explodeTarget, .55);
      setHighlight(part.object);
      viewer.focusObject(part.object, { padding: 2.6, direction: new THREE.Vector3(4, 3, 7) });
      simulationMessage = '零件 · ' + part.name;
      syncControls();
    }, listener);

    refs.partsList.addEventListener('pointerover', event => {
      const row = event.target.closest('[data-part]');
      if (!row) return;
      const part = parts[Number(row.dataset.part)];
      if (part) setHighlight(part.object);
    }, listener);

    refs.subSelect.addEventListener('change', () => {
      setExplode(refs.subSelect.value);
      refs.range.value = '100';
      explodeTarget = 1;
    }, listener);

    refs.range.addEventListener('input', () => {
      explodeTarget = Number(refs.range.value) / 100;
      if (!explodeSub) {
        explodeSub = 'robotParts';
        refs.subSelect.value = 'robotParts';
        renderPartList();
      }
      refs.parts.hidden = explodeTarget === 0;
      syncControls();
    }, listener);

    ui.querySelector('.rw-toolbar').addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      switch (action) {
        case 'play':
          if (emergency) { simulationMessage = '请先解除急停。'; break; }
          if (doorOpen) { simulationMessage = '请先关闭安全门。'; break; }
          if (explodeTarget > 0) { simulationMessage = '请先重新组装设备。'; break; }
          if (!running) {
            timeInPhase = 0;
            updateAssembly(viewer, -1, 0, modelKind);
            running = true;
            activatePhase(0);
          }
          paused = false;
          simulationMessage = '工序 · ' + phases[phaseIndex].name + ' · 工件 ' + modelKind;
          break;
        case 'pause':
          if (!running) break;
          paused = !paused;
          simulationMessage = (paused ? '模拟已暂停 · ' : '工序 · ') + phases[phaseIndex].name;
          break;
        case 'stop':
          stop();
          break;
        case 'model':
          if (running) { simulationMessage = '停止后可切换工件型号。'; break; }
          modelKind = modelKind === 'A' ? 'B' : 'A';
          model.productA.visible = model.insertA.visible = modelKind === 'A';
          model.productB.visible = model.insertB.visible = modelKind === 'B';
          updateAssembly(viewer, -1, 0, modelKind);
          simulationMessage = '已切换工件 ' + modelKind;
          break;
        case 'explode':
          setExplode(refs.subSelect.value);
          refs.range.value = '100';
          break;
        case 'assemble':
          assemble();
          refs.range.value = '0';
          refs.parts.hidden = true;
          break;
        case 'door':
          doorOpen = !doorOpen;
          if (doorOpen && running) paused = true;
          simulationMessage = doorOpen ? '安全门已打开 · 生产联锁' : '安全门已关闭';
          break;
        case 'emergency':
          emergency = !emergency;
          if (emergency && running) paused = true;
          simulationMessage = emergency ? '急停已触发 · 动作停止' : '急停已解除';
          break;
        case 'rotate':
          viewer.controls.autoRotate = !viewer.controls.autoRotate;
          break;
        case 'reset':
          viewer.controls.autoRotate = false;
          viewer.home();
          refs.selection.hidden = true;
          setHighlight(null);
          break;
      }
      syncControls();
    }, listener);

    function activatePhase(index) {
      phaseIndex = index;
      const phase = phases[index];
      simulationMessage = '工序 · ' + phase.name + ' · 工件 ' + modelKind;
      if (selectedDevice !== phase.device) select(phase.device, false, phase.name);
      else refs.selection.innerHTML = '<b>' + (deviceById[phase.device]?.name || '') + '</b><span>' + phase.name + '</span>';
      syncControls();
    }

    function stop() {
      running = false;
      paused = false;
      phaseIndex = -1;
      timeInPhase = 0;
      simulationMessage = '工序 · 待机';
      updateAssembly(viewer, -1, 0, modelKind);
      viewer.controls.autoRotate = false;
      viewer.home();
      syncControls();
    }

    /* Pointer picking: devices and individual parts. */
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let pointerStart = null;
    viewer.element.addEventListener('pointerdown', event => {
      pointerStart = event.button === 0 ? [event.clientX, event.clientY] : null;
    }, listener);
    viewer.element.addEventListener('pointerup', event => {
      if (!pointerStart) return;
      const moved = Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]);
      pointerStart = null;
      if (moved > 5) return;
      const rect = viewer.element.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      raycaster.setFromCamera(pointer, viewer.camera);
      const hits = raycaster.intersectObjects(Object.values(model.devices).map(info => info.group), true);
      const hit = hits.find(item => !item.object.userData.skipPick);
      if (!hit) return;
      const meta = parts.find(part => part.object === hit.object);
      if (meta) {
        setHighlight(meta.object);
        refs.selection.innerHTML = '<b>' + meta.name + '</b><span>' + meta.spec + '</span>';
        simulationMessage = '零件 · ' + meta.name;
        syncControls();
        return;
      }
      let node = hit.object;
      while (node && !node.userData.device) node = node.parent;
      if (node) select(node.userData.device);
    }, listener);

    /* Animation + label overlay. */
    viewer.setUpdate(dt => {
      let changed = false;

      if (running && !paused) {
        timeInPhase += dt;
        const duration = phases[phaseIndex].duration;
        if (timeInPhase >= duration) {
          updateAssembly(viewer, phaseIndex, 1, modelKind);
          if (phaseIndex === phases.length - 1) {
            running = false;
            simulationMessage = '装配完成 · 工件 ' + modelKind;
            syncControls();
          } else {
            timeInPhase -= duration;
            activatePhase(phaseIndex + 1);
          }
        }
        if (running) updateAssembly(viewer, phaseIndex, timeInPhase / phases[phaseIndex].duration, modelKind);
        changed = true;
      }

      // Explode animation with per-layer stagger.
      const source = explodeSub ? activeSources[explodeSub] : null;
      const blend = 1 - Math.exp(-dt * 7.5);
      for (const part of parts) {
        let targetAmount = 0;
        if (source && source.includes(part)) {
          const window = Math.max(.001, 1 - 1.15);
          const staged = THREE.MathUtils.clamp((explodeTarget * 1.15 - part.layer * .18) / window, 0, 1);
          targetAmount = smooth(staged);
        }
        if (Math.abs(part.amount - targetAmount) > 1e-4) {
          part.amount += (targetAmount - part.amount) * blend;
          if (Math.abs(part.amount - targetAmount) < 1e-3) part.amount = targetAmount;
          part.object.position.copy(part.home).addScaledVector(part.localOffset || part.offset, part.amount);
          changed = true;
        }
      }

      // Reframe once the parts have finished travelling, using their real bounds.
      if (pendingExplodeFrame) {
        const active = explodeSub ? activeSources[explodeSub] : null;
        if (!active) {
          pendingExplodeFrame = false;
        } else if (active.every(part => Math.abs(part.amount - 1) < .06)) {
          model.scene.updateMatrixWorld(true);
          const box = new THREE.Box3();
          for (const part of active) box.expandByObject(part.object);
          if (!box.isEmpty()) {
            lastExplodeSize = box.getSize(new THREE.Vector3());
            viewer.frameBox(box, { padding: 1.15, tall: true, direction: new THREE.Vector3(5.6, 4.4, 10.5) });
          }
          pendingExplodeFrame = false;
        }
      }

      const glass = model.materials.glass;      const glassTarget = explodeTarget > .05 ? .028 : .06;
      if (Math.abs(glass.opacity - glassTarget) > .002) {
        glass.opacity += (glassTarget - glass.opacity) * Math.min(1, blend * 1.4);
        changed = true;
      }

      const doorAngle = doorOpen ? Math.PI * .44 : 0;
      if (model.door && Math.abs(model.door.rotation.y - doorAngle) > .001) {
        model.door.rotation.y = THREE.MathUtils.lerp(model.door.rotation.y, doorAngle, blend);
        changed = true;
      }

      if (highlighted && highlightBox.visible) {
        highlightBox.setFromObject(highlighted);
      }
      if (model.selection.visible) {
        model.selection.setFromObject(model.devices[selectedDevice].group);
      }      return changed;
    }, camera => {
      for (const card of labelCards) card.hidden = true;
      for (const line of leaderLines) line.style.display = 'none';

      const source = explodeSub ? activeSources[explodeSub] : null;
      if (!source) return;
      const rect = refs.viewport.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const items = [];
      source.forEach((part, index) => {
        if (part.amount < .45) return;
        part.object.getWorldPosition(part.worldPosition);
        const projected = part.worldPosition.clone().project(camera);
        if (projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05) return;
        items.push({
          part, index,
          px: (projected.x + 1) * width / 2,
          py: (1 - projected.y) * height / 2
        });
      });
      if (!items.length) return;

      const columns = [
        { side: 'left', items: items.filter(item => item.px < width * .52).sort((a, b) => a.py - b.py) },
        { side: 'right', items: items.filter(item => item.px >= width * .52).sort((a, b) => a.py - b.py) }
      ];

      let slot = 0;
      for (const column of columns) {
        let cursor = 96;
        for (const item of column.items) {
          if (slot >= labelCards.length) break;
          const card = labelCards[slot];
          const line = leaderLines[slot];
          card.querySelector('.rw-annot-index').textContent = String(item.index + 1).padStart(2, '0');
          card.querySelector('.rw-annot-text').textContent = item.part.name;
          card.hidden = false;
          const cardWidth = card.offsetWidth || 130;
          const cardHeight = card.offsetHeight || 22;
          const top = Math.min(Math.max(item.py - cardHeight / 2, cursor), height - cardHeight - 18);
          cursor = top + cardHeight + 9;
          const left = column.side === 'left' ? 18 : Math.max(18, width - cardWidth - 18);
          card.style.transform = 'translate(' + left + 'px,' + top + 'px)';
          line.style.display = '';
          line.setAttribute('x1', item.px);
          line.setAttribute('y1', item.py);
          line.setAttribute('x2', column.side === 'left' ? left + cardWidth : left);
          line.setAttribute('y2', top + cardHeight / 2);
          slot++;
        }
      }
    });

    viewer.element.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      refs.status.textContent = '3D 场景暂不可用';
      addFallback(ui, '可使用左侧设备列表查看关联记录。');
      for (const action of Object.values(actions)) action.disabled = true;
      viewer.destroy();
    }, listener);

    updateAssembly(viewer, -1, 0, modelKind);
    model.productB.visible = model.insertB.visible = false;
    syncControls();
    select('feed', false);
    viewer.setVisible(true);

    return {
      select(id) { select(id); },
      resize: viewer.resize,
      setVisible: viewer.setVisible,
      debug() {
        return {
          distance: viewer.camera.position.distanceTo(viewer.controls.target),
          target: viewer.controls.target.toArray().map(value => Math.round(value * 100) / 100),
          explode: explodeTarget,
          explodeSub,
          ...viewer.debug(),
          boxes: model.describeBoxes(),
          explodeSize: lastExplodeSize.toArray().map(value => Math.round(value * 100) / 100),
          amounts: parts.filter(part => part.amount > .01).length
        };
      },
      destroy() { events.abort(); viewer.destroy(); ui.remove(); }
    };
  }

  async function mountPreview(container) {
    const ui = document.createElement('div');
    ui.className = 'robot-preview';
    ui.innerHTML = '<div class="robot-preview-canvas"></div>' +
      '<div class="robot-preview-controls" hidden>' +
      '<button class="secondary" type="button" data-preview-action="orbit">暂停环视</button>' +
      '<button class="secondary" type="button" data-preview-action="reset">复位视角</button></div>';
    container.append(ui);
    let viewer;
    try {
      viewer = await createViewer(ui.querySelector('.robot-preview-canvas'), { preview: true, offsetX: 2.6 });
    } catch (error) {
      ui.remove();
      throw error;
    }
    const bar = ui.querySelector('.robot-preview-controls');
    const orbit = bar.querySelector('[data-preview-action=orbit]');
    const reset = bar.querySelector('[data-preview-action=reset]');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const events = new AbortController();
    const options = { signal: events.signal };
    const { model } = viewer;
    updateAssembly(viewer, -1, 0, 'A');
    model.productB.visible = model.insertB.visible = false;
    for (const bulbs of model.stackLights) for (const bulb of bulbs.slice(1)) bulb.material = model.materials.dark;

    function setOrbit(value) {
      viewer.controls.autoRotate = value;
      orbit.textContent = value ? '暂停环视' : '继续环视';
      orbit.setAttribute('aria-pressed', String(value));
      viewer.invalidate();
    }
    setOrbit(!motion.matches);
    motion.addEventListener('change', event => { if (event.matches) setOrbit(false); }, options);
    viewer.controls.addEventListener('start', () => setOrbit(false));
    orbit.addEventListener('click', () => setOrbit(!viewer.controls.autoRotate), options);
    reset.addEventListener('click', () => viewer.home(), options);
    viewer.element.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      viewer.destroy();
      ui.remove();
    }, options);
    bar.hidden = false;
    viewer.setVisible(true);
    return { setVisible: viewer.setVisible, destroy() { events.abort(); viewer.destroy(); ui.remove(); } };
  }

  window.RobotWorkstation = { mount, mountPreview, devices: devices.map(device => ({ ...device })) };
})();
