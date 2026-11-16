(() => {
  'use strict';

  const devices = [
    { id: 'feed', name: '上料与输送', description: '输送带将工件移动至定位工位，等待识别。' },
    { id: 'robot', name: '六轴工业机器人', description: '机器人执行取件、移动和柔性装配动作。' },
    { id: 'fixture', name: '柔性装配夹具', description: '定位、支撑并夹紧工件，支持不同型号切换。' },
    { id: 'vision', name: '视觉定位与检测', description: '工业相机和光源示意工件识别与检测。' },
    { id: 'safety', name: '安全防护', description: '围栏、安全门和急停用于演示设备安全互锁。' },
    { id: 'output', name: '成品输出', description: '完成装配的工件经过输出输送线。' }
  ];
  const byId = Object.fromEntries(devices.map(device => [device.id, device]));
  const stages = ['上料', '工件定位', '视觉识别', '机器人取件', '移动至装配位置', '执行装配', '检测', '成品输出'];
  const stageDevice = ['feed', 'fixture', 'vision', 'robot', 'robot', 'fixture', 'vision', 'output'];

  async function mount(container, options = {}) {
    container.innerHTML = `
      <div class="robot-station">
        <div class="robot-station-head">
          <div><strong>柔性装配工作站</strong><span class="robot-station-tag">方案示意 · 模拟运行</span></div>
          <div class="robot-station-state" role="status">正在加载 3D 场景…</div>
        </div>
        <div class="robot-station-layout">
          <aside class="robot-station-devices" aria-label="工作站设备">
            <div class="robot-station-subtitle">工作站设备</div>
            <div class="robot-station-device-buttons"></div>
          </aside>
          <div class="robot-station-viewport">
            <div class="robot-station-canvas"></div>
            <div class="robot-station-hint">拖动旋转 · 滚轮缩放 · 右键平移</div>
            <div class="robot-station-error" role="status" hidden></div>
          </div>
        </div>
        <div class="robot-station-stage" aria-live="polite">工序：待机</div>
        <div class="robot-station-actions">
          <button type="button" data-action="play">开始生产</button>
          <button type="button" data-action="pause">暂停</button>
          <button type="button" data-action="stop">停止并复位</button>
          <button type="button" data-action="model">切换工件 · A</button>
          <button type="button" data-action="tool">拆解末端执行器</button>
          <button type="button" data-action="fixture">拆解夹具</button>
          <button type="button" data-action="assemble">重新组装</button>
          <button type="button" data-action="door">打开安全门</button>
          <button type="button" data-action="emergency" class="robot-emergency">急停</button>
          <button type="button" data-action="reset">视角复位</button>
          <button type="button" data-action="rotate">自动旋转：关</button>
        </div>
        <p class="robot-station-caption">工作站动作与安全联锁为模拟演示，场景布局为方案示意。</p>
      </div>`;
    const ui = container.querySelector('.robot-station');
    const canvasHost = ui.querySelector('.robot-station-canvas');
    const stateText = ui.querySelector('.robot-station-state');
    const stageText = ui.querySelector('.robot-station-stage');
    const errorBox = ui.querySelector('.robot-station-error');
    const action = name => ui.querySelector(`[data-action="${name}"]`);
    const deviceButtons = ui.querySelector('.robot-station-device-buttons');
    deviceButtons.innerHTML = devices.map(device =>
      `<button type="button" data-device="${device.id}">${device.name}</button>`).join('');

    function unavailable(message) {
      stateText.textContent = '3D 场景暂不可用';
      errorBox.hidden = false;
      errorBox.textContent = message;
      function choose(id) {
        const device = byId[id];
        if (!device) return;
        for (const button of deviceButtons.querySelectorAll('[data-device]'))
          button.setAttribute('aria-pressed', String(button.dataset.device === id));
        if (typeof options.onSelect === 'function') options.onSelect({ ...device });
      }
      deviceButtons.addEventListener('click', event => {
        const button = event.target.closest('[data-device]');
        if (button) choose(button.dataset.device);
      });
      choose('feed');
      return { select:choose, resize() {}, setVisible() {}, destroy() { container.replaceChildren(); } };
    }

    let THREE;
    let OrbitControls;
    try {
      [THREE, { OrbitControls }] = await Promise.all([
        import('https://esm.sh/three@0.170.0'),
        import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js')
      ]);
    } catch {
      return unavailable('无法加载 3D 组件，请检查网络后刷新页面。');
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return unavailable('当前浏览器无法启用 3D 渲染，请检查浏览器的硬件加速设置。');
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    canvasHost.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#091421');
    scene.fog = new THREE.Fog('#091421', 15, 45);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const homeCamera = new THREE.Vector3(11, 9, 14);
    const homeTarget = new THREE.Vector3(0, 1, 0);
    camera.position.copy(homeCamera);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(homeTarget);
    controls.minDistance = 4;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.HemisphereLight('#b5dcf7', '#111c2d', 2));
    const mainLight = new THREE.DirectionalLight('#f1f6ff', 3);
    mainLight.position.set(3, 12, 8);
    scene.add(mainLight);
    const edgeLight = new THREE.DirectionalLight('#329cff', 2);
    edgeLight.position.set(-8, 5, -6);
    scene.add(edgeLight);

    const materials = {
      metal: new THREE.MeshStandardMaterial({ color: '#8498a7', metalness: 0.75, roughness: 0.32 }),
      dark: new THREE.MeshStandardMaterial({ color: '#263746', metalness: 0.68, roughness: 0.42 }),
      frame: new THREE.MeshStandardMaterial({ color: '#596d7b', metalness: 0.8, roughness: 0.4 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#dfaa31', metalness: 0.55, roughness: 0.38 }),
      black: new THREE.MeshStandardMaterial({ color: '#17232e', metalness: 0.18, roughness: 0.7 }),
      blue: new THREE.MeshStandardMaterial({ color: '#29b9e8', metalness: 0.35, roughness: 0.28, emissive: '#0a789c', emissiveIntensity: 0.6 }),
      green: new THREE.MeshStandardMaterial({ color: '#51d2ab', metalness: 0.25, roughness: 0.45 }),
      glass: new THREE.MeshStandardMaterial({ color: '#5cbfe0', metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    };

    function box(group, size, pos, material, key, rotation = 0) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...pos);
      mesh.rotation.z = rotation;
      if (key) mesh.userData.device = key;
      group.add(mesh);
      return mesh;
    }
    function cylinder(group, radius, height, pos, material, key, axis = 'y') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material);
      mesh.position.set(...pos);
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      if (key) mesh.userData.device = key;
      group.add(mesh);
      return mesh;
    }

    const floor = box(scene, [13, 0.2, 9], [0, -0.15, 0], materials.dark);
    floor.userData.noSelect = true;
    const grid = new THREE.GridHelper(13, 26, '#285975', '#1a3548');
    grid.position.y = -0.035;
    scene.add(grid);
    const equipment = {};
    for (const device of devices) {
      equipment[device.id] = new THREE.Group();
      equipment[device.id].userData.device = device.id;
      scene.add(equipment[device.id]);
    }

    function conveyor(group, centerX, width, key) {
      group.position.set(centerX, 0, 1.5);
      box(group, [width, 0.28, 1.35], [0, 0.8, 0], materials.frame, key);
      box(group, [width - 0.12, 0.08, 1.12], [0, 0.98, 0], materials.black, key);
      for (let i = -2; i <= 2; i++) {
        box(group, [0.04, 0.025, 1.08], [i * (width - 0.2) / 5, 1.03, 0], materials.metal, key);
      }
      for (const x of [-width / 2 + 0.18, width / 2 - 0.18]) {
        for (const z of [-0.5, 0.5]) box(group, [0.12, 0.8, 0.12], [x, 0.4, z], materials.dark, key);
      }
      for (const z of [-0.72, 0.72]) box(group, [width, 0.13, 0.08], [0, 1.07, z], materials.metal, key);
    }
    conveyor(equipment.feed, -3.6, 3.8, 'feed');
    conveyor(equipment.output, 3.65, 3.6, 'output');

    const fixture = equipment.fixture;
    box(fixture, [2.2, 0.18, 1.8], [0, 0.87, 1.5], materials.frame, 'fixture');
    const fixtureBase = box(fixture, [1.5, 0.12, 1.08], [0, 1.03, 1.5], materials.metal, 'fixture');
    for (const x of [-0.8, 0.8]) for (const z of [0.85, 2.15])
      box(fixture, [0.13, 0.8, 0.13], [x, 0.4, z], materials.dark, 'fixture');
    const fixtureParts = [];
    for (const x of [-0.68, 0.68]) {
      const part = box(fixture, [0.2, 0.4, 0.58], [x, 1.25, 1.5], materials.yellow, 'fixture');
      fixtureParts.push({ object: part, original: part.position.clone(), offset: new THREE.Vector3(x < 0 ? -0.7 : 0.7, 0.55, 0) });
    }
    for (const z of [1.1, 1.9]) {
      const part = cylinder(fixture, 0.06, 0.28, [0, 1.2, z], materials.dark, 'fixture');
      fixtureParts.push({ object: part, original: part.position.clone(), offset: new THREE.Vector3(0, 0.65, z < 1.5 ? -0.35 : 0.35) });
    }

    const robot = equipment.robot;
    robot.position.set(0, 0, -1.3);
    cylinder(robot, 0.65, 0.22, [0, 0.14, 0], materials.dark, 'robot');
    cylinder(robot, 0.47, 0.45, [0, 0.45, 0], materials.metal, 'robot');
    const baseJoint = new THREE.Group();
    baseJoint.position.y = 0.68;
    robot.add(baseJoint);
    cylinder(baseJoint, 0.38, 0.38, [0, 0.08, 0], materials.yellow, 'robot');
    const shoulder = new THREE.Group();
    shoulder.position.y = 0.35;
    baseJoint.add(shoulder);
    cylinder(shoulder, 0.32, 0.68, [0, 0, 0], materials.dark, 'robot', 'x');
    box(shoulder, [0.4, 1.6, 0.42], [0, 0.8, 0], materials.yellow, 'robot');
    const elbow = new THREE.Group();
    elbow.position.y = 1.6;
    shoulder.add(elbow);
    cylinder(elbow, 0.28, 0.66, [0, 0, 0], materials.dark, 'robot', 'x');
    box(elbow, [0.33, 1.32, 0.34], [0, 0.66, 0], materials.yellow, 'robot');
    const wrist = new THREE.Group();
    wrist.position.y = 1.32;
    elbow.add(wrist);
    cylinder(wrist, 0.25, 0.5, [0, 0, 0], materials.dark, 'robot', 'x');
    box(wrist, [0.27, 0.55, 0.27], [0, 0.25, 0], materials.metal, 'robot');
    const tool = new THREE.Group();
    tool.position.y = 0.58;
    wrist.add(tool);
    const toolParts = [];
    const flange = cylinder(tool, 0.2, 0.12, [0, 0, 0], materials.metal, 'robot');
    const quickCoupler = cylinder(tool, 0.16, 0.1, [0, 0.1, 0], materials.blue, 'robot');
    const toolBody = box(tool, [0.48, 0.22, 0.3], [0, 0.25, 0], materials.dark, 'robot');
    const cable = box(tool, [0.045, 0.34, 0.045], [0.26, 0.1, 0.05], materials.black, 'robot');
    const leftFinger = box(tool, [0.09, 0.38, 0.12], [-0.2, 0.47, 0], materials.metal, 'robot');
    const rightFinger = box(tool, [0.09, 0.38, 0.12], [0.2, 0.47, 0], materials.metal, 'robot');
    [flange, quickCoupler, toolBody, leftFinger, rightFinger, cable].forEach((object, i) =>
      toolParts.push({ object, original: object.position.clone(), offset: new THREE.Vector3((i - 2.5) * 0.24, i * 0.2, 0) }));
    shoulder.rotation.x = 0.75;
    elbow.rotation.x = 1.2;
    wrist.rotation.x = 0;

    const vision = equipment.vision;
    vision.position.set(1.45, 0, 0);
    box(vision, [0.18, 3.65, 0.18], [0, 1.85, 1.3], materials.frame, 'vision');
    box(vision, [1.35, 0.14, 0.14], [-0.55, 3.65, 1.3], materials.frame, 'vision');
    box(vision, [0.44, 0.32, 0.46], [-1.05, 3.4, 1.3], materials.black, 'vision');
    cylinder(vision, 0.13, 0.14, [-1.05, 3.18, 1.3], materials.blue, 'vision');
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.65, 4, 1, true), materials.glass);
    cone.position.set(-1.05, 2.28, 1.3);
    cone.rotation.z = Math.PI;
    cone.userData.device = 'vision';
    vision.add(cone);

    const safety = equipment.safety;
    const posts = [[-5.9,-3.1],[-5.9,3.3],[5.9,-3.1],[5.9,3.3],[-2,-3.1],[2,-3.1]];
    for (const [x,z] of posts) {
      box(safety, [0.13, 2.4, 0.13], [x, 1.2, z], materials.yellow, 'safety');
    }
    box(safety, [11.8, 0.1, 0.1], [0, 2.36, -3.1], materials.frame, 'safety');
    for (const x of [-5.9,5.9]) {
      box(safety, [0.1, 0.1, 6.4], [x, 2.36, 0.1], materials.frame, 'safety');
      box(safety, [0.03, 2.1, 6.2], [x, 1.2, 0.1], materials.glass, 'safety');
    }
    box(safety, [11.6, 2.1, 0.03], [0, 1.2, -3.1], materials.glass, 'safety');
    const door = new THREE.Group();
    door.position.set(-2, 0, 3.3);
    safety.add(door);
    box(door, [2.6, 0.1, 0.1], [1.3, 2.36, 0], materials.yellow, 'safety');
    box(door, [0.1, 2.4, 0.1], [2.55, 1.2, 0], materials.yellow, 'safety');
    box(door, [2.5, 2.2, 0.03], [1.3, 1.2, 0], materials.glass, 'safety');
    box(safety, [2.6, 0.1, 0.1], [4.6, 2.36, 3.3], materials.frame, 'safety');
    box(safety, [0.35, 0.7, 0.25], [5.35, 1.45, 3.08], materials.dark, 'safety');
    const stopMaterial = new THREE.MeshStandardMaterial({ color:'#e74938', emissive:'#731008', emissiveIntensity:0.5 });
    cylinder(safety, 0.12, 0.12, [5.35, 1.6, 3.26], stopMaterial, 'safety', 'z');

    const products = new THREE.Group();
    scene.add(products);
    const workpiece = new THREE.Group();
    products.add(workpiece);
    const productA = box(workpiece, [0.62, 0.25, 0.42], [0, 0.15, 0], materials.metal);
    const productB = box(workpiece, [0.46, 0.42, 0.5], [0, 0.24, 0], materials.green);
    productB.visible = false;
    box(workpiece, [0.75, 0.07, 0.62], [0, 0.02, 0], materials.dark);
    workpiece.position.set(-4.6, 1.04, 1.5);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const cameraGoal = new THREE.Vector3();
    const targetGoal = new THREE.Vector3();
    let cameraMoving = false;
    let selected = null;
    let selectionOutline = null;
    let exploded = null;
    let running = false;
    let paused = false;
    let doorOpen = false;
    let emergency = false;
    let model = 'A';
    let stage = 0;
    let elapsed = 0;
    let active = true;
    let destroyed = false;
    let frame = 0;
    let lastTime = 0;
    const clock = new THREE.Clock();
    const partOverlay = document.createElement('div');
    partOverlay.className = 'robot-station-part-labels';
    partOverlay.setAttribute('aria-hidden', 'true');
    canvasHost.parentElement.append(partOverlay);
    const partLabels = [
      ...toolParts.map((item, index) => ({ ...item, kind:'tool', name:['连接法兰','快换连接机构','执行器主体','左夹指','右夹指','连接线缆'][index] })),
      ...fixtureParts.map((item, index) => ({ ...item, kind:'fixture', name:['左夹紧机构','右夹紧机构','前定位元件','后定位元件'][index] })),
      { object:fixtureBase, kind:'fixture', name:'夹具底座' }
    ];
    for (const item of partLabels) {
      item.label = document.createElement('span');
      item.label.textContent = item.name;
      partOverlay.append(item.label);
    }

    function updateButtons() {
      action('pause').textContent = paused ? '继续' : '暂停';
      action('model').textContent = `切换工件 · ${model}`;
      action('door').textContent = doorOpen ? '关闭安全门' : '打开安全门';
      action('emergency').textContent = emergency ? '解除急停' : '急停';
      action('emergency').classList.toggle('active', emergency);
      action('rotate').textContent = controls.autoRotate ? '自动旋转：开' : '自动旋转：关';
      stateText.textContent = emergency ? '急停已触发' : doorOpen ? '安全门已打开' : running ? (paused ? '模拟已暂停' : '模拟运行中') : '待机';
    }
    function focus(id) {
      const group = equipment[id];
      const bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(4, size.length() * 1.2);
      targetGoal.copy(center);
      cameraGoal.copy(center).add(new THREE.Vector3(distance * 0.8, distance * 0.65, distance));
      cameraMoving = true;
    }
    function select(id, moveCamera = true) {
      if (!byId[id]) return;
      selected = id;
      for (const button of deviceButtons.querySelectorAll('[data-device]'))
        button.setAttribute('aria-pressed', String(button.dataset.device === id));
      if (selectionOutline) scene.remove(selectionOutline);
      selectionOutline = new THREE.BoxHelper(equipment[id], '#45d7ff');
      selectionOutline.material.transparent = true;
      selectionOutline.material.opacity = 0.65;
      scene.add(selectionOutline);
      if (moveCamera) focus(id);
      if (typeof options.onSelect === 'function') options.onSelect({ ...byId[id] });
    }
    function resetPose() {
      baseJoint.rotation.y = 0;
      shoulder.rotation.x = 0.75;
      elbow.rotation.x = 1.2;
      wrist.rotation.x = 0;
      workpiece.position.set(-4.6, 1.04, 1.5);
    }
    function stop() {
      running = false;
      paused = false;
      stage = 0;
      elapsed = 0;
      exploded = null;
      stageText.textContent = '工序：待机';
      resetPose();
      cameraGoal.copy(homeCamera);
      targetGoal.copy(homeTarget);
      cameraMoving = true;
      updateButtons();
    }
    function checkReady() {
      if (emergency) { stageText.textContent = '请先解除急停。'; return false; }
      if (doorOpen) { stageText.textContent = '请先关闭安全门。'; return false; }
      if (exploded) { stageText.textContent = '请先重新组装设备。'; return false; }
      return true;
    }
    function changeExplosion(target) {
      running = false;
      paused = false;
      exploded = target;
      select(target === 'tool' ? 'robot' : 'fixture');
      stageText.textContent = target === 'tool' ? '末端执行器拆解示意' : '柔性夹具拆解示意';
      updateButtons();
    }
    deviceButtons.addEventListener('click', event => {
      const button = event.target.closest('[data-device]');
      if (button) select(button.dataset.device);
    });
    let pointerStart = null;
    renderer.domElement.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
    renderer.domElement.addEventListener('pointerup', event => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects(Object.values(equipment), true)[0];
      let object = hit?.object;
      while (object && !object.userData.device) object = object.parent;
      if (object?.userData.device) select(object.userData.device);
    });
    ui.querySelector('.robot-station-actions').addEventListener('click', event => {
      const name = event.target.closest('[data-action]')?.dataset.action;
      if (!name) return;
      if (name === 'play') {
        if (!checkReady()) return;
        if (!running) { stage = 0; elapsed = 0; resetPose(); }
        running = true; paused = false;
      } else if (name === 'pause') {
        if (running && !paused) paused = true;
        else if (running && paused && checkReady()) paused = false;
      } else if (name === 'stop') stop();
      else if (name === 'model') {
        if (running && !paused) { stageText.textContent = '请先暂停或停止，再切换工件。'; return; }
        model = model === 'A' ? 'B' : 'A';
        productA.visible = model === 'A';
        productB.visible = model === 'B';
        fixtureParts[0].original.x = model === 'A' ? -0.68 : -0.56;
        fixtureParts[1].original.x = model === 'A' ? 0.68 : 0.56;
        stageText.textContent = `已切换工件 ${model}，夹具位置已调整。`;
      } else if (name === 'tool') changeExplosion('tool');
      else if (name === 'fixture') changeExplosion('fixture');
      else if (name === 'assemble') { exploded = null; stageText.textContent = '设备已重新组装。'; }
      else if (name === 'door') {
        doorOpen = !doorOpen;
        if (doorOpen && running) paused = true;
        stageText.textContent = doorOpen ? '安全门已打开，模拟已暂停。' : '安全门已关闭。';
      } else if (name === 'emergency') {
        emergency = !emergency;
        if (emergency && running) paused = true;
        stageText.textContent = emergency ? '急停已触发，模拟已暂停。' : '急停已解除。';
      } else if (name === 'reset') {
        cameraGoal.copy(homeCamera); targetGoal.copy(homeTarget); cameraMoving = true;
      } else if (name === 'rotate') controls.autoRotate = !controls.autoRotate;
      updateButtons();
    });

    function resize() {
      const width = canvasHost.clientWidth;
      const height = canvasHost.clientHeight;
      if (!width || !height || destroyed) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvasHost);
    function animate() {
      if (!active || destroyed) return;
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      lastTime += dt;
      if (running && !paused) {
        elapsed += dt;
        if (elapsed >= 2.4) {
          elapsed = 0;
          stage++;
          if (stage >= stages.length) {
            running = false;
            stage = stages.length - 1;
            stageText.textContent = '工序：装配完成 · 模拟数据';
            updateButtons();
          }
        }
        if (running) {
          stageText.textContent = `工序：${stages[stage]} · 工件 ${model} · 模拟运行`;
          const t = elapsed / 2.4;
          if (stage === 0) workpiece.position.x = -4.6 + t * 3.8;
          if (stage === 1 || stage === 2) workpiece.position.x = -0.8 + t * 0.8;
          if (stage >= 3 && stage <= 5) {
            const turn = stage === 3 ? -0.2 : stage === 4 ? -0.2 + t * 0.4 : 0.2;
            baseJoint.rotation.y = THREE.MathUtils.lerp(baseJoint.rotation.y, turn, 1 - Math.exp(-dt * 4));
            shoulder.rotation.x = 0.75 + Math.sin(lastTime * 1.3) * 0.07;
            elbow.rotation.x = 1.2 + Math.sin(lastTime * 1.3 + 1) * 0.1;
            scene.updateMatrixWorld(true);
            const grip = tool.localToWorld(new THREE.Vector3(0, 0.58, 0));
            const destination = stage === 5 && t > 0.55 ? new THREE.Vector3(0.6, 1.04, 1.5) : grip;
            workpiece.position.lerp(destination, 1 - Math.exp(-dt * 4));
          }
          if (stage === 7) {
            workpiece.position.set(0.6 + t * 4, 1.04, 1.5);
          }
          if (selected !== stageDevice[stage]) select(stageDevice[stage], false);
        }
      }
      for (const [key, parts] of [['tool', toolParts], ['fixture', fixtureParts]]) {
        for (const item of parts) {
          const goal = item.original.clone();
          if (exploded === key) goal.add(item.offset);
          item.object.position.lerp(goal, 1 - Math.exp(-dt * 6));
        }
      }
      door.rotation.y = THREE.MathUtils.lerp(door.rotation.y, doorOpen ? -Math.PI / 2 : 0, 1 - Math.exp(-dt * 5));
      if (cameraMoving) {
        camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 3));
        controls.target.lerp(targetGoal, 1 - Math.exp(-dt * 3));
        if (camera.position.distanceTo(cameraGoal) < 0.03 && controls.target.distanceTo(targetGoal) < 0.03) cameraMoving = false;
      }
      if (selectionOutline) selectionOutline.update();
      controls.update();
      renderer.render(scene, camera);
      for (const item of partLabels) {
        const visible = exploded === item.kind;
        item.label.hidden = !visible;
        if (!visible) continue;
        const point = item.object.getWorldPosition(new THREE.Vector3()).project(camera);
        item.label.hidden = point.z < -1 || point.z > 1;
        item.label.style.left = ((point.x + 1) * 50) + '%';
        item.label.style.top = ((1 - point.y) * 50) + '%';
      }
    }
    function setVisible(value) {
      if (destroyed || active === value) return;
      active = value;
      if (active) { resize(); clock.getDelta(); animate(); }
      else { cancelAnimationFrame(frame); }
    }
    function destroy() {
      destroyed = true;
      active = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse(object => { if (object.geometry) object.geometry.dispose(); });
      for (const material of [...Object.values(materials), stopMaterial]) material.dispose();
      if (selectionOutline) selectionOutline.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      container.replaceChildren();
    }
    resize();
    select('feed', false);
    updateButtons();
    animate();
    return { select, resize, setVisible, destroy };
  }
  window.RobotWorkstation = { mount, devices: devices.map(device => ({ ...device })) };
})();
