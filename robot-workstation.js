
(() => {
  'use strict';

  const devices = [
    { id:'feed', name:'上料与输送', description:'上料机械臂从料箱取件，将待装配件放到随行托盘。' },
    { id:'robot', name:'六轴工业机器人', description:'三台机械臂分别负责上料、装配和下料。装配机械臂配有快换夹具。' },
    { id:'fixture', name:'柔性装配夹具', description:'定位销、可调夹紧机构和随行托盘共同定位两种示例工件。' },
    { id:'vision', name:'视觉定位与检测', description:'相机和条形光源用于演示工件识别以及装配后的检测。' },
    { id:'safety', name:'安全防护', description:'透明防护板、安全门和急停按钮用于互锁模拟。' },
    { id:'output', name:'成品输出', description:'下料机械臂将成品从随行托盘转移至成品料箱。' }
  ];
  const deviceById = Object.fromEntries(devices.map(device => [device.id, device]));
  const phases = [
    { name:'上料', device:'feed', duration:2.8 },
    { name:'输送定位', device:'fixture', duration:2 },
    { name:'取装配件', device:'robot', duration:1.3 },
    { name:'转移与装配', device:'robot', duration:2.1 },
    { name:'视觉检测', device:'vision', duration:2.8 },
    { name:'输送成品', device:'output', duration:1.8 },
    { name:'下料', device:'output', duration:2.8 }
  ];
  const beltZ = 0.7;
  const beltTop = 1.04;
  const palletY = 1.15;
  const feedX = -6.0;
  const visionX = 3.35;
  const outX = 6.15;
  let libraries;

  function loadLibraries() {
    libraries ||= Promise.all([
      import('https://esm.sh/three@0.170.0'),
      import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js')
    ]);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('3D 组件加载超时')), 8000);
      libraries.then(resolve, reject).finally(() => clearTimeout(timeout));
    });
  }

  function createLine(THREE, preview) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1726');
    scene.fog = new THREE.FogExp2('#0b1726', .022);

    scene.add(new THREE.HemisphereLight('#dcecff', '#52677c', 2.7));
    const key = new THREE.DirectionalLight('#fff2e5', 2.85);
    key.position.set(-5, 12, 8);
    const rim = new THREE.DirectionalLight('#83c7ff', 1.4);
    rim.position.set(5, 5, -8);
    scene.add(key, rim);

    const mat = (color, properties = {}) => new THREE.MeshStandardMaterial({color, roughness:.55, ...properties});
    const frame = mat('#a9b7c5', {metalness:.66, roughness:.33});
    const steel = mat('#76899d', {metalness:.65, roughness:.37});
    const dark = mat('#253244', {metalness:.27});
    const rubber = mat('#171f2a', {roughness:.85});
    const enamel = mat('#eef1ef', {roughness:.29, metalness:.11});
    const glass = mat('#8bbbd7', {transparent:true, opacity:.115, depthWrite:false, side:THREE.DoubleSide});
    const oak = mat('#b98a50', {roughness:.82});
    const amber = mat('#e9b64f', {emissive:'#9c4d0a', emissiveIntensity:.17});
    const red = mat('#da453e', {emissive:'#9b1812', emissiveIntensity:.4});
    const green = mat('#36d19b', {emissive:'#087557', emissiveIntensity:.45});
    const blue = mat('#68d6ff', {emissive:'#2187b9', emissiveIntensity:.75});
    const quiet = mat('#283e54');
    const screen = mat('#193b50', {emissive:'#173548', emissiveIntensity:.65});
    const beam = mat('#7edcff', {transparent:true, opacity:.17, depthWrite:false, side:THREE.DoubleSide});
    const floorMat = mat('#283b4d', {metalness:.26, roughness:.8});
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 64;
    const shadowContext = shadowCanvas.getContext('2d');
    const gradient = shadowContext.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(1,8,16,.72)');
    gradient.addColorStop(.48,'rgba(1,8,16,.44)');
    gradient.addColorStop(1,'rgba(1,8,16,0)');
    shadowContext.fillStyle=gradient;
    shadowContext.fillRect(0,0,64,64);
    const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
    const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});
    const shadowPlane=new THREE.PlaneGeometry(1,1);

    const cube = new THREE.BoxGeometry(1, 1, 1);
    const tube = new THREE.CylinderGeometry(1, 1, 1, preview ? 12 : 20);
    const sphere = new THREE.SphereGeometry(1, preview ? 12 : 20, 12);
    const meshes = new Set([cube, tube, sphere]);
    const materials = new Set([frame, steel, dark, rubber, enamel, glass, oak, amber, red, green, blue, quiet, screen, beam, floorMat]);
    const equipment = {};
    const named = {};

    function group(parent, x=0, y=0, z=0) {
      const item = new THREE.Group();
      item.position.set(x, y, z);
      parent.add(item);
      return item;
    }

    function mesh(parent, geometry, material, size, position, axis) {
      const item = new THREE.Mesh(geometry, material);
      item.scale.set(...size);
      item.position.set(...position);
      if (axis === 'x') item.rotation.z = Math.PI / 2;
      if (axis === 'z') item.rotation.x = Math.PI / 2;
      parent.add(item);
      return item;
    }

    const box = (parent, size, position, material) => mesh(parent, cube, material, size, position);
    const cylinder = (parent, radius, height, position, material, axis) =>
      mesh(parent, tube, material, [radius,height,radius], position, axis);
    const cap = (parent, size, position, material) => mesh(parent, sphere, material, size, position);

    for (const device of devices) {
      equipment[device.id] = group(scene);
      equipment[device.id].userData.device = device.id;
    }

    box(scene, [25,.26,11.8], [0,-.2,0], floorMat);
    box(scene, [25,.1,11.8], [0,-.35,0], dark);
    for (const x of [-6.15,-.2,5.9]) {
      const shadow=mesh(scene,shadowPlane,shadowMaterial,[7.2,5.1,1],[x,-.064,.15]);
      shadow.rotation.x=-Math.PI/2;
    }
    for (const z of [-4.55,3.95]) {
      box(scene, [23,.008,.036], [0,-.065,z], amber);
      for (let x=-10.5; x<=10.5; x+=1.5) box(scene,[.56,.008,.06],[x,-.064,z+.16],steel);
    }
    for (const x of [-10.5,10.5]) box(scene,[.035,.008,8.5],[x,-.064,-.3],amber);

    function bench(parent, x, width) {
      box(parent,[width,.18,1.5],[x,.82,beltZ],steel);
      box(parent,[width-.06,.12,1.22],[x,.98,beltZ],rubber);
      for (const z of [beltZ-.69,beltZ+.69]) {
        box(parent,[width,.18,.095],[x,1.03,z],frame);
        box(parent,[width,.026,.101],[x,1.045,z],dark);
        box(parent,[width,.018,.01],[x,.99,z+Math.sign(z-beltZ)*.05],dark);
        for (const dx of [-width/2+.22,width/2-.22]) {
          box(parent,[.09,.83,.09],[x+dx,.42,z],frame);
          box(parent,[.19,.075,.19],[x+dx,.04,z],dark);
        }
      }
      box(parent,[width*.67,.15,.84],[x,.2,beltZ],dark);
      for (const dx of [-width/2+.21,width/2-.21]) cylinder(parent,.09,1.24,[x+dx,.998,beltZ],steel,'z');
    }

    bench(equipment.feed,-6.67,4.75);
    bench(equipment.fixture,-2.15,4.25);
    bench(equipment.vision,2.05,3.95);
    bench(equipment.output,6.53,4.9);

    function tote(parent, x, z, filled) {
      box(parent,[1.15,.15,.9],[x,1,z],dark);
      for (const side of [-1,1]) {
        box(parent,[1.15,.21,.075],[x,1.17,z+side*.42],rubber);
        box(parent,[.075,.21,.84],[x+side*.54,1.17,z],rubber);
      }
      if (filled) for (const dx of [-.33,0,.33]) {
        for (const dz of [-.2,.2]) cylinder(parent,.11,.1,[x+dx,1.13,z+dz],steel);
      }
    }

    function enclosure(parent, x, width, doorOnFront) {
      const back = -2.75;
      const front = 2.04;
      const y = 3.18;
      const left = x-width/2;
      const right = x+width/2;
      for (const edge of [left,right]) {
        for (const z of [back,front]) {
          box(parent,[.108,y,.108],[edge,y/2,z],frame);
          box(parent,[.24,.09,.24],[edge,.045,z],dark);
          box(parent,[.013,y-.16,.013],[edge+.04,y/2,z+.052],steel);
        }
        for (const h of [.31,y]) box(parent,[.108,.108,front-back],[edge,h,(front+back)/2],frame);
        box(parent,[.035,2.65,front-back-.15],[edge,1.7,(front+back)/2],glass).userData.skipPick=true;
      }
      for (const z of [back,front]) box(parent,[width,.108,.108],[x,y,z],frame);
      box(parent,[width,.108,.108],[x,.31,back],frame);
      box(parent,[width-.1,2.65,.035],[x,1.7,back],glass).userData.skipPick=true;
      if (!doorOnFront) {
        box(parent,[width,.108,.108],[x,.31,front],frame);
        box(parent,[width-.1,2.65,.03],[x,1.7,front],glass).userData.skipPick=true;
        return;
      }
      const door = group(parent,left,0,front);
      for (const h of [.35,y-.09]) box(door,[width-.08,.07,.07],[width/2,h,0],frame);
      box(door,[.075,y-.4,.075],[width-.1,y/2+.12,0],frame);
      box(door,[width-.17,y-.5,.025],[width/2,y/2+.09,0],glass).userData.skipPick=true;
      box(door,[.072,.39,.105],[width-.31,1.48,.07],rubber);
      box(parent,[.16,.19,.16],[right,1.68,front],amber);
      return door;
    }

    enclosure(equipment.safety,-5.98,3.8,false);
    const door = enclosure(equipment.safety,-.45,4.15,true);
    enclosure(equipment.safety,5.05,4.5,false);

    const stackLights = [];
    function operatorPanel(parent,x,z) {
      box(parent,[.1,2.3,.13],[x,1.15,z],frame);
      box(parent,[.8,.52,.13],[x,1.99,z+.12],dark);
      box(parent,[.35,.21,.33],[x,1.76,z-.05],steel);
      box(parent,[.69,.41,.02],[x,2,z+.197],screen);
      box(parent,[.56,.026,.018],[x,2.12,z+.21],blue);
      for (let row=0;row<3;row++) {
        box(parent,[.31-row*.044,.024,.018],[x-.112,2.04-row*.07,z+.21],steel);
        box(parent,[.1,.024,.018],[x+.193,2.04-row*.07,z+.21],row ? green : blue);
      }
      cylinder(parent,.079,.057,[x+.31,1.74,z+.19],red,'z');
      const stack = group(parent,x-.55,2.31,z);
      cylinder(stack,.036,.39,[0,.13,0],steel);
      const bulbs = [green,amber,red].map((material,i) =>
        cylinder(stack,.073,.105,[0,.36+i*.115,0],material));
      cylinder(stack,.08,.065,[0,.66,0],dark);
      stackLights.push(bulbs);
    }
    operatorPanel(equipment.feed,-6.9,2.32);
    operatorPanel(equipment.fixture,-.38,2.28);
    operatorPanel(equipment.output,6.4,2.27);
    box(equipment.safety,[.26,.4,.22],[1.65,1.43,2.18],amber);
    cylinder(equipment.safety,.088,.09,[1.65,1.47,2.33],red,'z');

    tote(equipment.feed,-6.72,1.92,true);
    tote(equipment.robot,.53,1.65,true);
    tote(equipment.output,7.04,1.97,false);

    function robot(parent,x,z) {
      const base = group(parent,x,0,z);
      box(base,[.84,.65,.84],[0,.38,0],steel);
      cylinder(base,.42,.18,[0,.76,0],dark);
      const yaw = group(base,0,.85,0);
      cylinder(yaw,.34,.22,[0,.1,0],enamel);
      const shoulder = group(yaw,0,.34,0);
      const upperLength = 1.45;
      const lowerLength = 1.32;
      cylinder(shoulder,.28,.66,[0,0,0],dark,'x');
      cap(shoulder,[.36,.36,.3],[0,0,0],enamel);
      cap(shoulder,[.26,.82,.25],[0,.64,0],enamel);
      box(shoulder,[.11,1.03,.055],[.13,.72,-.24],rubber);
      const elbow = group(shoulder,0,upperLength,0);
      cylinder(elbow,.22,.49,[0,0,0],dark,'x');
      cap(elbow,[.3,.31,.25],[0,0,0],enamel);
      cap(elbow,[.21,.76,.21],[0,.58,0],enamel);
      box(elbow,[.08,.86,.05],[.094,.49,-.193],rubber);
      const wrist = group(elbow,0,lowerLength,0);
      cap(wrist,[.23,.24,.2],[0,0,0],enamel);
      const tool = group(wrist,0,.08,0);
      const toolParts = [];
      const addPart = (object, name, offset) => toolParts.push({object,name,offset:new THREE.Vector3(...offset),home:object.position.clone()});
      addPart(cylinder(tool,.16,.085,[0,.045,0],dark),'连接法兰',[-.28,-.02,0]);
      addPart(cylinder(tool,.13,.08,[0,.115,0],steel),'快换连接机构',[.36,.04,0]);
      addPart(box(tool,[.37,.15,.26],[0,.23,0],dark),'夹爪主体',[.05,.28,0]);
      addPart(box(tool,[.06,.2,.08],[-.165,.375,0],steel),'左夹指',[-.37,.47,0]);
      addPart(box(tool,[.06,.2,.08],[.165,.375,0],steel),'右夹指',[.34,.52,0]);
      const aim = new THREE.Vector3();
      function pose(target, gripping=false) {
        aim.copy(target);
        const side = aim.x-x;
        const forward = aim.z-z;
        const r = Math.hypot(side,forward);
        const dy = aim.y + .52 - 1.19;
        const d = THREE.MathUtils.clamp(Math.hypot(r,dy),.18,upperLength+lowerLength-.01);
        const jointAngle = Math.acos(THREE.MathUtils.clamp((d*d-upperLength*upperLength-lowerLength*lowerLength)/(2*upperLength*lowerLength),-1,1));
        yaw.rotation.y = Math.atan2(side,forward);
        shoulder.rotation.x = Math.atan2(r,dy)-Math.atan2(lowerLength*Math.sin(jointAngle),upperLength+lowerLength*Math.cos(jointAngle));
        elbow.rotation.x = jointAngle;
        wrist.rotation.x = Math.PI-shoulder.rotation.x-jointAngle;
        toolParts[3].home.x = gripping ? -.104 : -.165;
        toolParts[4].home.x = gripping ? .104 : .165;
      }
      const idle = new THREE.Vector3(x+.42,1.72,z+1.3);
      pose(idle);
      return { base,tool,toolParts,pose,idle };
    }
    const arms = [
      robot(equipment.feed,-6.25,-.07),
      robot(equipment.robot,0,-.6),
      robot(equipment.output,6.58,-.13)
    ];
    named.robot = arms[1].base;
    named.feed = arms[0].base;
    named.output = arms[2].base;

    const fixture = group(equipment.fixture,0,0,beltZ);
    named.fixture = fixture;
    const fixtureParts = [];
    function fixturePart(object,name,offset) {
      fixtureParts.push({object,name,offset:new THREE.Vector3(...offset),home:object.position.clone()});
    }
    fixturePart(box(fixture,[1.47,.115,1.36],[0,1.08,0],steel),'夹具底座',[0,.43,-.55]);
    for (const side of [-1,1]) {
      fixturePart(box(fixture,[.22,.2,.55],[side*.55,1.22,0],dark),side<0?'左夹紧机构':'右夹紧机构',[side*.61,.64,0]);
      fixturePart(cylinder(fixture,.055,.25,[side*.42,1.23,-.38],steel),side<0?'左定位销':'右定位销',[side*.26,.75,-.31]);
    }

    const sensor = group(equipment.vision,visionX,0,beltZ);
    named.vision = sensor;
    for (const z of [-.82,.82]) box(sensor,[.095,2.8,.095],[0,1.4,z],frame);
    box(sensor,[.1,.1,1.7],[0,2.77,0],frame);
    box(sensor,[.39,.31,.47],[0,2.57,0],dark);
    cylinder(sensor,.112,.16,[0,2.34,0],blue);
    for (const dx of [-.55,.55]) {
      box(sensor,[.19,.13,.8],[dx,2.41,0],steel);
      box(sensor,[.145,.026,.73],[dx,2.33,0],blue);
    }
    const coneGeometry = new THREE.ConeGeometry(.55,1.05,4,1,true);
    meshes.add(coneGeometry);
    const scan = mesh(sensor,coneGeometry,beam,[1,1,1],[0,1.74,0]);
    scan.userData.skipPick = true;
    scan.visible = false;
    named.safety = door;

    const pallet = group(scene,feedX,beltTop,beltZ);
    box(pallet,[.87,.08,.71],[0,.08,0],oak);
    for (const z of [-.25,0,.25]) box(pallet,[.89,.055,.105],[0,.027,z],oak);
    const parts = group(scene);
    const base = group(parts);
    const productA = group(base);
    box(productA,[.55,.12,.44],[0,.072,0],steel);
    for (const dx of [-.17,.17]) box(productA,[.106,.13,.43],[dx,.155,0],dark);
    for (const dx of [-.18,.18]) for (const dz of [-.15,.15]) cylinder(productA,.032,.04,[dx,.231,dz],frame);
    const productB = group(base);
    cylinder(productB,.23,.13,[0,.075,0],steel);
    cylinder(productB,.14,.1,[0,.187,0],dark);
    for (const dx of [-.14,.14]) box(productB,[.11,.085,.12],[dx,.184,0],green);
    const insert = group(parts);
    const insertA = box(insert,[.26,.12,.26],[0,.073,0],enamel);
    const insertB = cylinder(insert,.095,.16,[0,.09,0],enamel);

    const selection = new THREE.BoxHelper(arms[1].base,'#77dcff');
    selection.material.transparent = true;
    selection.material.opacity = .54;
    selection.visible = false;
    scene.add(selection);
    meshes.add(selection.geometry);
    materials.add(selection.material);

    return {scene,equipment,named,arms,fixtureParts,door,pallet,base,productA,productB,insert,insertA,insertB,scan,selection,stackLights,quiet,
      highlight(id) {
        selection.visible = Boolean(id);
        if (id) selection.setFromObject(named[id] || equipment[id]);
      },
      dispose() {
        shadowPlane.dispose();
        shadowTexture.dispose();
        shadowMaterial.dispose();
        for (const geometry of meshes) geometry.dispose();
        for (const material of materials) material.dispose();
      }
    };
  }


  async function createViewer(host, { preview=false } = {}) {
    const [THREE,{OrbitControls}] = await loadLibraries();
    const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:preview?'low-power':'default'});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1,preview ? 1 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.append(renderer.domElement);

    const line = createLine(THREE,preview);
    const camera = new THREE.PerspectiveCamera(38,1,.1,100);
    const controls = new OrbitControls(camera,renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotateSpeed = .62;
    controls.enablePan = !preview;
    controls.enableZoom = !preview;
    controls.minDistance = 3.2;
    controls.maxDistance = 68;
    controls.minPolarAngle = .44;
    controls.maxPolarAngle = 1.45;
    controls.autoRotate = preview && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desiredPosition = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const homeDirection = new THREE.Vector3(9,10.5,24).normalize();
    const temp = new THREE.Vector3();
    const observers = new AbortController();
    const listen = {signal:observers.signal};

    let homeDistance = 29;
    let overview = true;
    let focusMoving = false;
    let visible = false;
    let stopped = false;
    let frame = 0;
    let previousTime = 0;
    let draw = true;
    let update = () => {};
    let overlay = () => {};

    function home(immediate=false) {
      overview = true;
      desiredTarget.set(0,1.14,0);
      desiredPosition.copy(homeDirection).multiplyScalar(homeDistance).add(desiredTarget);
      focusMoving = !immediate;
      if (immediate) {
        camera.position.copy(desiredPosition);
        controls.target.copy(desiredTarget);
        controls.update();
      }
      draw = true;
    }

    function focus(id,part,mode='device') {
      overview = false;
      const object = part || line.named[id];
      new THREE.Box3().setFromObject(object).getCenter(desiredTarget);
      const direction = temp.set(2.7,2.1,5.8).normalize();
      const distance = mode === 'part' ? 5.15 : 7.7;
      desiredPosition.copy(direction).multiplyScalar(distance * Math.max(1,.92/camera.aspect)).add(desiredTarget);
      focusMoving = true;
    }

    function resize() {
      const {clientWidth:width,clientHeight:height} = host;
      if (stopped || !width || !height) return;
      camera.aspect = width/height;
      camera.updateProjectionMatrix();
      renderer.setSize(width,height,false);
      const fit = 10.6 / (Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect);
      homeDistance = Math.min(64,Math.max(24,fit));
      if (overview) home(true);
      draw = true;
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    controls.addEventListener('start', () => {focusMoving=false;overview=false;});
    controls.addEventListener('change', () => { draw=true; });
    function tick(time) {
      frame = 0;
      if (stopped || !visible || document.hidden) return;
      const dt = previousTime ? Math.min((time-previousTime)/1000,.15) : 0;
      previousTime = time;
      const animated = update(dt);
      if (focusMoving) {
        const blend = 1-Math.exp(-dt*6.5);
        camera.position.lerp(desiredPosition,blend);
        controls.target.lerp(desiredTarget,blend);
        if (camera.position.distanceTo(desiredPosition)<.018 && controls.target.distanceTo(desiredTarget)<.018) focusMoving=false;
        draw=true;
      }
      controls.update(dt);
      if (animated || draw) {
        renderer.render(line.scene,camera);
        overlay(camera);
        draw=false;
      }
      frame=requestAnimationFrame(tick);
    }
    function stopFrame() {
      if (frame) cancelAnimationFrame(frame);
      frame=0;
      previousTime=0;
    }
    function schedule() {
      stopFrame();
      if (!stopped && visible && !document.hidden) {
        draw=true;
        frame=requestAnimationFrame(tick);
      }
    }
    function setVisible(value) {
      if (stopped || value===visible) return;
      visible=value;
      if (visible) resize();
      schedule();
    }

    function destroy() {
      if (stopped) return;
      stopped=true;
      stopFrame();
      observers.abort();
      observer.disconnect();
      controls.dispose();
      line.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }

    document.addEventListener('visibilitychange',schedule,listen);
    home(true);
    resize();
    return {THREE, line, camera, controls, element:renderer.domElement, home, focus, setVisible, resize, destroy,
      invalidate() {draw=true;},
      setUpdate(callback,renderOverlay) {update=callback; overlay=renderOverlay;}
    };
  }

  function updateAssembly(viewer, stage, progress, model) {
    const {THREE,line} = viewer;
    const {arms,base,insert,pallet,fixtureParts,scan} = line;
    const input = [-6.72,1.13,1.92];
    const stock = [.53,1.26,1.65];
    const output = [7.04,1.13,1.97];
    const pace = (a,b) => THREE.MathUtils.smoothstep(progress,a,b);
    const mix = (from,to,t) => THREE.MathUtils.lerp(from,to,t);
    const points = [[feedX,feedX],[feedX,0],[0,0],[0,0],[0,visionX],[visionX,outX],[outX,outX]];
    const interval = points[stage] || [feedX,feedX];
    const trayX = mix(interval[0],interval[1],stage === 4 ? pace(0,.68) : pace(0,1));
    const partOnTray = [trayX,palletY,beltZ];
    const assembly = [trayX,palletY+(model==='A' ? .135 : .22),beltZ];
    pallet.position.x=trayX;
    base.position.set(...partOnTray);
    insert.position.set(...(stage > 3 ? assembly : stock));
    scan.visible=stage===4 && progress>.56;
    for (const arm of arms) arm.pose(arm.idle);

    function transfer(object, arm, source, destination, fraction, lift) {
      const point = object.position;
      point.set(mix(source[0],destination[0],fraction),mix(source[1],destination[1],fraction)+Math.sin(Math.PI*fraction)*lift,mix(source[2],destination[2],fraction));
      arm.pose(point, fraction>0 && fraction<1);
    }
    if (stage === -1) {
      base.position.set(...input);
    } else if (stage === 0) {
      transfer(base,arms[0],input,partOnTray,pace(.08,.92),.62);
    } else if (stage === 2) {
      transfer(insert,arms[1],stock,[stock[0],1.88,stock[2]],pace(.12,.94),0);
    } else if (stage === 3) {
      transfer(insert,arms[1],[stock[0],1.88,stock[2]],assembly,pace(.03,.94),.27);
    } else if (stage === 6) {
      transfer(base,arms[2],partOnTray,output,pace(.07,.93),.65);
      insert.position.copy(base.position);
      insert.position.y+=model==='A' ? .135 : .22;
    }
    for (const item of fixtureParts.filter(part => part.name.includes('夹紧'))) {
      const baseOffset=model==='A' ? .55 : .44;
      const closing=stage===3 ? .095*pace(.45,.88) : 0;
      item.home.x=Math.sign(item.home.x)*(baseOffset-closing);
    }
  }

  function addFallback(container, message) {
    const fallback = container.querySelector('.robot-station-error');
    fallback.textContent = message;
    fallback.hidden = false;
  }

  function chooseDevice(buttons, callback, id) {
    const device = deviceById[id];
    if (!device) return;
    for (const button of buttons.querySelectorAll('[data-device]')) {
      button.setAttribute('aria-pressed',String(button.dataset.device===id));
    }
    callback?.({...device});
  }

  async function mount(container,{onSelect,details}={}) {
    container.innerHTML = '<div class="robot-station">'+
      '<div class="robot-station-head"><p id="robotSimulationState" class="robot-station-state" role="status">正在加载 3D 场景…</p><p class="robot-station-stage" aria-live="polite">工序 · 待机</p><p class="robot-station-tag">方案示意 · 模拟运行</p></div>'+
      '<div class="robot-station-layout">'+
      '<details class="robot-station-devices" open><summary>工作站设备</summary><div class="robot-station-device-buttons"></div></details>'+
      '<div class="robot-station-viewport"><div class="robot-station-canvas"></div><span class="robot-station-selection" hidden></span><div class="robot-station-hint">拖动旋转 · 滚轮缩放</div><div class="robot-station-error" role="status" hidden></div></div>'+
      '<details class="robot-station-detail" open><summary>设备与项目</summary></details></div>'+
      '<div class="robot-station-actions">'+
      '<fieldset><legend>运行</legend><button type="button" data-action="play">开始生产</button><button type="button" data-action="pause">暂停</button><button type="button" data-action="stop">停止并复位</button><button type="button" data-action="model">工件 A</button><button type="button" data-action="door">打开安全门</button><button type="button" data-action="emergency" class="robot-emergency">急停</button></fieldset>'+
      '<fieldset><legend>拆解</legend><button type="button" data-action="tool">末端执行器</button><button type="button" data-action="fixture">柔性夹具</button><button type="button" data-action="assemble">重新组装</button></fieldset>'+
      '<fieldset><legend>视角</legend><button type="button" data-action="reset">整线总览</button><button type="button" data-action="rotate" aria-pressed="false">自动环视</button></fieldset>'+
      '</div></div>';
    const ui=container.querySelector('.robot-station');
    if (details) ui.querySelector('.robot-station-detail').append(details);
    const desktop=matchMedia('(min-width: 960px)');
    function syncPanels() {
      for (const panel of ui.querySelectorAll('.robot-station-layout > details')) panel.open=desktop.matches;
    }
    syncPanels();
    const events=new AbortController();
    const listener={signal:events.signal};
    desktop.addEventListener('change',syncPanels,listener);
    const refs={
      viewport:ui.querySelector('.robot-station-viewport'),
      sceneHost:ui.querySelector('.robot-station-canvas'),
      status:ui.querySelector('.robot-station-state'),
      stage:ui.querySelector('.robot-station-stage'),
      deviceButtons:ui.querySelector('.robot-station-device-buttons'),
      label:ui.querySelector('.robot-station-selection')
    };
    const actions=Object.fromEntries([...ui.querySelectorAll('[data-action]')].map(button=>[button.dataset.action,button]));
    refs.deviceButtons.innerHTML=devices.map(device=>'<button type="button" data-device="'+device.id+'">'+device.name+'</button>').join('');
    refs.deviceButtons.addEventListener('click',event=>{
      const button=event.target.closest('[data-device]');
      if(button) select(button.dataset.device);
    },listener);

    let viewer;
    let select=(id)=>chooseDevice(refs.deviceButtons,onSelect,id);
    select('feed');
    try {
      viewer=await createViewer(refs.sceneHost);
    } catch (error) {
      refs.status.textContent='3D 场景暂不可用';
      addFallback(ui,'可使用设备列表查看关联记录。');
      for (const action of Object.values(actions)) action.disabled=true;
      return {select,resize(){},setVisible(){},destroy(){events.abort();ui.remove();}};
    }

    const {THREE,line}=viewer;
    const overlay=document.createElement('div');
    overlay.className='robot-station-part-labels';
    refs.viewport.append(overlay);
    const partGroups={tool:line.arms[1].toolParts,fixture:line.fixtureParts};
    for (const part of [...partGroups.tool,...partGroups.fixture]) {
      part.label=document.createElement('span');
      part.label.hidden=true;
      part.label.textContent=part.name;
      overlay.append(part.label);
    }
    const target=new THREE.Vector3();
    let selected=null;
    let explosion=null;
    let running=false;
    let paused=false;
    let doorOpen=false;
    let emergency=false;
    let model='A';
    let phaseIndex=-1;
    let timeInPhase=0;
    let simulationMessage='工序 · 待机';

    select=(id,moveCamera=true,announcement=deviceById[id]?.name)=>{
      if(!deviceById[id]) return;
      selected=id;
      chooseDevice(refs.deviceButtons,onSelect,id);
      line.highlight(id);
      refs.label.hidden=false;
      refs.label.textContent=announcement;
      if (moveCamera) {
        viewer.controls.autoRotate=false;
        viewer.focus(id);
      }
      viewer.invalidate();
      syncControls();
    };

    function syncControls() {
      actions.pause.textContent=paused?'继续':'暂停';
      actions.pause.disabled=!running;
      actions.model.textContent='切换工件 · '+model;
      actions.door.textContent=doorOpen?'关闭安全门':'打开安全门';
      actions.emergency.textContent=emergency?'解除急停':'急停';
      actions.emergency.classList.toggle('active',emergency);
      actions.rotate.setAttribute('aria-pressed',String(viewer.controls.autoRotate));
      refs.status.textContent=emergency?'急停已触发':doorOpen?'安全门已打开':running?(paused?'模拟已暂停':'模拟运行中'):'待机';
      refs.stage.textContent=simulationMessage;
      const signal=emergency?2:doorOpen || paused?1:0;
      for (const lights of line.stackLights) for (const [i,bulb] of lights.entries()) {
        bulb.material = i===signal ? bulb.userData.lit : line.quiet;
      }
      viewer.invalidate();
    }

    for (const lights of line.stackLights) for (const bulb of lights) bulb.userData.lit=bulb.material;
    function activatePhase(index) {
      phaseIndex=index;
      const phase=phases[index];
      simulationMessage='工序 · '+phase.name+' · 工件 '+model;
      if (selected!==phase.device) select(phase.device,false,phase.name);
      else refs.label.textContent=phase.name;
      syncControls();
    }

    function ready() {
      if (emergency) simulationMessage='请先解除急停。';
      else if (doorOpen) simulationMessage='请先关闭安全门。';
      else if (explosion) simulationMessage='请先重新组装设备。';
      else return true;
      syncControls();
      return false;
    }
    function resetPose() {
      updateAssembly(viewer,-1,0,model);
      viewer.invalidate();
    }

    function stop() {
      running=false;
      paused=false;
      explosion=null;
      phaseIndex=-1;
      timeInPhase=0;
      simulationMessage='工序 · 待机';
      resetPose();
      viewer.controls.autoRotate=false;
      viewer.home();
    }

    ui.querySelector('.robot-station-actions').addEventListener('click',event=>{
      const action=event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      switch(action) {
        case 'play':
          if (!ready()) return;
          if (!running) {
            timeInPhase=0;
            resetPose();
            running=true;
            activatePhase(0);
          }
          paused=false;
          simulationMessage='工序 · '+phases[phaseIndex].name+' · 工件 '+model;
          break;
        case 'pause':
          if (!running || (paused && !ready())) return;
          paused=!paused;
          simulationMessage=(paused?'模拟已暂停 · ':'工序 · ')+phases[phaseIndex].name+' · 工件 '+model;
          break;
        case 'stop': stop(); break;
        case 'model':
          if (running) {
            simulationMessage='停止后可切换工件型号。';
            break;
          }
          model=model==='A'?'B':'A';
          line.productA.visible=line.insertA.visible=model==='A';
          line.productB.visible=line.insertB.visible=model==='B';
          resetPose();
          simulationMessage='已切换工件 '+model+'，夹紧位置已调整。';
          break;
        case 'tool':
        case 'fixture': {
          if (running) {
            simulationMessage='停止生产模拟后可拆解设备。';
            break;
          }
          explosion=action;
          const id=action==='tool'?'robot':'fixture';
          const part=action==='tool'?line.arms[1].tool:line.named.fixture;
          select(id,false);
          viewer.controls.autoRotate=false;
          viewer.focus(id,part,'part');
          simulationMessage=action==='tool'?'末端执行器拆解 · 快换机构与夹爪':'柔性夹具拆解 · 底座、夹紧机构与定位销';
          break;
        }
        case 'assemble': explosion=null; simulationMessage='设备已重新组装。'; break;
        case 'door':
          doorOpen=!doorOpen;
          if (doorOpen && running) paused=true;
          simulationMessage=doorOpen?'安全门已打开 · 生产联锁':'安全门已关闭。';
          break;
        case 'emergency':
          emergency=!emergency;
          if (emergency && running) paused=true;
          simulationMessage=emergency?'急停已触发 · 动作停止':'急停已解除。';
          break;
        case 'reset':
          viewer.controls.autoRotate=false;
          viewer.home();
          line.highlight(null);
          refs.label.hidden=true;
          break;
        case 'rotate': viewer.controls.autoRotate=!viewer.controls.autoRotate; break;
      }
      syncControls();
    },listener);

    const pointer=new THREE.Vector2();
    const raycaster=new THREE.Raycaster();
    let pointerStart;
    viewer.element.addEventListener('pointerdown',event=>{
      pointerStart=event.button===0?[event.clientX,event.clientY]:null;
    },listener);
    viewer.element.addEventListener('pointerup',event=>{
      if(!pointerStart) return;
      const distance=Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1]);
      pointerStart=null;
      if(distance>5) return;
      const rect=viewer.element.getBoundingClientRect();
      pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
      raycaster.setFromCamera(pointer,viewer.camera);
      const hit=raycaster.intersectObjects(Object.values(line.equipment),true).find(item=>!item.object.userData.skipPick);
      if (!hit) return;
      let device=hit.object;
      while (device && !device.userData.device) device=device.parent;
      if (device) select(device.userData.device);
    },listener);

    viewer.setUpdate(dt=>{
      let changed=false;
      if (running && !paused) {
        timeInPhase+=dt;
        const duration=phases[phaseIndex].duration;
        if (timeInPhase>=duration) {
          updateAssembly(viewer,phaseIndex,1,model);
          if (phaseIndex===phases.length-1) {
            running=false;
            simulationMessage='装配完成 · 工件 '+model+' · 模拟运行';
            syncControls();
          } else {
            timeInPhase-=duration;
            activatePhase(phaseIndex+1);
          }
        }
        if (running) updateAssembly(viewer,phaseIndex,timeInPhase/phases[phaseIndex].duration,model);
        changed=true;
      }
      const blend=1-Math.exp(-dt*10);
      for (const arm of line.arms) {
        for (const part of arm.toolParts) {
          target.copy(part.home);
          if (arm===line.arms[1] && explosion==='tool') target.add(part.offset);
          if (part.object.position.distanceToSquared(target)>1e-6) {
            part.object.position.lerp(target,blend);
            changed=true;
          }
        }
      }
      for (const part of line.fixtureParts) {
        target.copy(part.home);
        if (explosion==='fixture') target.add(part.offset);
        if (part.object.position.distanceToSquared(target)>1e-6) {
          part.object.position.lerp(target,blend);
          changed=true;
        }
      }
      const angle=doorOpen?Math.PI*.46:0;
      if (Math.abs(line.door.rotation.y-angle)>.001) {
        line.door.rotation.y=THREE.MathUtils.lerp(line.door.rotation.y,angle,blend);
        changed=true;
      }
      if (changed && line.selection.visible && selected) line.highlight(selected);
      return changed;
    }, camera=>{
      for (const [kind,parts] of Object.entries(partGroups)) for (const part of parts) {
        part.label.hidden=kind!==explosion;
        if (part.label.hidden) continue;
        part.object.getWorldPosition(target).project(camera);
        part.label.hidden=target.z>1 || Math.abs(target.x)>1 || Math.abs(target.y)>1;
        part.label.style.left=(target.x+1)*50+'%';
        part.label.style.top=(1-target.y)*50+'%';
      }
    });

    viewer.element.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      refs.status.textContent='3D 场景暂不可用';
      addFallback(ui,'可使用设备列表查看关联记录。');
      for (const action of Object.values(actions)) action.disabled=true;
      select=id=>chooseDevice(refs.deviceButtons,onSelect,id);
      viewer.destroy();
    },listener);

    resetPose();
    line.productB.visible=line.insertB.visible=false;
    syncControls();
    viewer.setVisible(true);
    return {select(id){select(id);},resize:viewer.resize,setVisible:viewer.setVisible,destroy(){events.abort();viewer.destroy();ui.remove();}};
  }

  async function mountPreview(container) {
    const ui=document.createElement('div');
    ui.className='robot-preview';
    ui.innerHTML='<div class="robot-preview-canvas"></div><div class="robot-preview-controls" hidden>'+
      '<button class="secondary" type="button" data-preview-action="orbit">暂停环视</button>'+
      '<button class="secondary" type="button" data-preview-action="reset">复位视角</button></div>';
    container.append(ui);
    let viewer;
    try {
      viewer=await createViewer(ui.querySelector('.robot-preview-canvas'),{preview:true});
    } catch (error) {
      ui.remove();
      throw error;
    }
    const bar=ui.querySelector('.robot-preview-controls');
    const orbit=bar.querySelector('[data-preview-action=orbit]');
    const reset=bar.querySelector('[data-preview-action=reset]');
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const events=new AbortController();
    const options={signal:events.signal};
    const {line}=viewer;
    updateAssembly(viewer,-1,0,'A');
    line.productB.visible=line.insertB.visible=false;
    for (const lights of line.stackLights) for (const bulb of lights.slice(1)) bulb.material=line.quiet;
    function setOrbit(value) {
      viewer.controls.autoRotate=value;
      orbit.textContent=value?'暂停环视':'继续环视';
      orbit.setAttribute('aria-pressed',String(value));
      viewer.invalidate();
    }
    setOrbit(!motion.matches);
    motion.addEventListener('change',e=>{ if(e.matches) setOrbit(false); },options);
    viewer.controls.addEventListener('start',()=>setOrbit(false));
    orbit.addEventListener('click',()=>setOrbit(!viewer.controls.autoRotate),options);
    reset.addEventListener('click',()=>viewer.home(),options);
    viewer.element.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      viewer.destroy();
      ui.remove();
    },options);
    bar.hidden=false;
    viewer.setVisible(true);
    return {setVisible:viewer.setVisible,destroy(){events.abort();viewer.destroy();ui.remove();}};
  }

  window.RobotWorkstation={mount,mountPreview,devices:devices.map(device=>({...device}))};
})();
