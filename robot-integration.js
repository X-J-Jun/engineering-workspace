/* Project data and navigation for the workstation demonstration. */
(() => {
  const labels = {feed:'上料与输送', robot:'工业机器人', fixture:'柔性夹具', vision:'视觉定位', safety:'安全防护', output:'成品输出'};
  const defaultTargets = {durationWeeks:12, budgetCny:750000, cycleSeconds:45, positionMm:0.8, interlockPercent:100, sourceDate:'2026-11-04'};
  const nav = document.createElement('a');
  nav.href = '#robotHeading';
  nav.textContent = '3D 工作站';
  nav.hidden = true;
  document.querySelector('a[href="#riskHeading"]').after(nav);

  const section = document.createElement('section');
  section.setAttribute('aria-labelledby', 'robotHeading');
  section.hidden = true;
  section.innerHTML = `
    <div class="robot-page-heading"><div><h2 id="robotHeading">柔性装配工作站</h2>
    <p>方案示意 · 装配过程和设备状态均为模拟演示</p></div>
    <button type="button" class="secondary" data-robot-action="targets">编辑项目目标</button></div>
    <div id="robotTargets" class="robot-targets"></div>
    <div id="robotScene" class="robot-scene"></div>
    <div id="robotDetails" class="robot-details" aria-live="polite"></div>`;
  document.querySelector('section[aria-labelledby="riskHeading"]').before(section);

  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form method="dialog" class="robot-editor">
    <h2>3D 工作站设置</h2><div id="robotEditorBody"></div>
    <p id="robotEditorError" role="alert"></p>
    <div class="actions"><button type="button" data-robot-save>保存</button>
    <button type="button" class="secondary" data-robot-cancel>取消</button></div>
  </form>`;
  document.body.append(dialog);

  let selected = 'robot';
  let scene = null;
  let pending = null;
  let sceneGeneration = 0;
  const sceneHost = document.querySelector('#robotScene');
  const details = document.querySelector('#robotDetails');
  const targets = document.querySelector('#robotTargets');
  const enabled = () => Boolean(getCurrentProject()?.robotWorkspace?.enabled);
  const manager = () => canManage();

  function normalizeRobotWorkspace(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const links = {};
    for (const key of Object.keys(labels)) {
      const item = value.links?.[key];
      if (!item || typeof item !== 'object') continue;
      links[key] = {
        taskIds: Array.isArray(item.taskIds) ? item.taskIds.filter(id => typeof id === 'string') : [],
        riskIds: Array.isArray(item.riskIds) ? item.riskIds.filter(id => typeof id === 'string') : []
      };
    }
    const saved = value.targets && typeof value.targets === 'object' ? value.targets : {};
    const target = {};
    for (const key of ['durationWeeks','budgetCny','cycleSeconds','positionMm','interlockPercent']) {
      const n = saved[key];
      target[key] = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    }
    target.sourceDate = typeof saved.sourceDate === 'string' ? saved.sourceDate.slice(0, 40) : '';
    return {enabled:value.enabled === true, targets:target, links};
  }
  window.normalizeRobotWorkspace = normalizeRobotWorkspace;

  function setupButtons() {
    document.querySelectorAll('.project-card').forEach((card, index) => {
      const project = data.projects[index];
      if (!project || !manager() || (!project.name.includes('工业机器人柔性装配工作站建设') && !project.robotWorkspace)) return;
      const actions = card.querySelector('.card-actions');
      if (!actions || actions.querySelector('[data-robot-enable]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small secondary';
      button.dataset.robotEnable = project.id;
      button.textContent = project.robotWorkspace?.enabled ? '关闭 3D 工作站' : '启用 3D 工作站';
      actions.append(button);
    });
  }
  function refresh() {
    nav.hidden = !enabled();
    section.querySelector('[data-robot-action="targets"]').hidden = !manager();
    setupButtons();
    if (!enabled()) {
      if (location.hash === '#robotHeading') location.hash = '#overviewHeading';
      scene?.setVisible(false);
      return;
    }
    const target = getCurrentProject().robotWorkspace.targets || {};
    const display = (key, suffix) => target[key] == null ? '待填写' : `${target[key]} ${suffix}`;
    targets.innerHTML = `<p>项目目标 · 数据来源 ${escapeHTML(target.sourceDate || '待填写')} · 待核对</p>
      <div class="robot-target-grid">
      <span>周期 <strong>${display('durationWeeks','周')}</strong></span>
      <span>预算 <strong>${display('budgetCny','元')}</strong></span>
      <span>单件节拍 ≤ <strong>${display('cycleSeconds','秒')}</strong></span>
      <span>重复定位精度 ≤ <strong>${display('positionMm','mm')}</strong></span>
      <span>安全互锁通过率 <strong>${display('interlockPercent','%')}</strong></span></div>`;
    renderDetails();
    updateVisible();
  }
  function renderDetails() {
    if (!enabled()) return;
    const project = getCurrentProject();
    const links = project.robotWorkspace.links?.[selected] || {taskIds:[],riskIds:[]};
    const tasks = links.taskIds.map(id => data.tasks.find(task => task.id === id && task.projectId === project.id));
    const risks = links.riskIds.map(id => data.risks.find(risk => risk.id === id && risk.projectId === project.id));
    const missing = tasks.filter(item => !item).length + risks.filter(item => !item).length;
    const records = [
      ...tasks.filter(Boolean).map(task => `<li><button class="small secondary" type="button" data-robot-task="${escapeHTML(task.id)}">${escapeHTML(task.code)} ${escapeHTML(task.title)}</button> <span>${escapeHTML(TASK_STATUS_LABELS[task.status])}${task.requiresAcceptance ? ' · ' + escapeHTML(deliveryStatus(task)) : ''}</span>${task.requiresAcceptance ? ` <button type="button" class="small secondary" data-robot-review="${escapeHTML(task.id)}">查看交付单</button>` : ''}</li>`),
      ...risks.filter(Boolean).map(risk => `<li><button class="small secondary" type="button" data-robot-risk="${escapeHTML(risk.id)}">${escapeHTML(risk.name)}</button> <span>${escapeHTML(RISK_STATUS_LABELS[risk.status])}</span></li>`)
    ];
    details.innerHTML = `<div class="robot-detail-head"><h3>${escapeHTML(labels[selected])} · 关联记录</h3>${manager() ? '<button type="button" class="small secondary" data-robot-action="links">管理关联</button>' : ''}</div>
      <p>当前可见记录</p>${records.length ? `<ul>${records.join('')}</ul>` : '<p>暂无可见关联记录。</p>'}
      ${missing && manager() ? `<p>有 ${missing} 条关联记录已失效，可在管理关联中清理。</p>` : ''}`;
  }
  async function updateVisible() {
    const visible = enabled() && location.hash === '#robotHeading';
    if (scene) { scene.setVisible(visible); return; }
    if (!visible || pending) return;
    if (!window.RobotWorkstation) {
      sceneHost.textContent = '3D 组件未加载，请检查网络后刷新页面。';
      return;
    }
    const generation = ++sceneGeneration;
    pending = window.RobotWorkstation.mount(sceneHost, {onSelect(device) {
      const id = typeof device === 'string' ? device : device?.id;
      if (labels[id]) { selected = id; renderDetails(); }
    }});
    try {
      const instance = await pending;
      if (generation !== sceneGeneration) { instance?.destroy(); return; }
      scene = instance;
      scene?.setVisible(enabled() && location.hash === '#robotHeading');
    } catch (error) {
      sceneHost.textContent = '3D 场景无法启动，请检查网络、浏览器或图形硬件后重试。';
      console.warn('3D workstation initialization failed', error);
    } finally { pending = null; }
  }

  function openEditor(type) {
    if (!manager() || !enabled()) return;
    dialog.dataset.type = type;
    dialog.dataset.project = getCurrentProject().id;
    dialog.dataset.device = selected;
    const body = dialog.querySelector('#robotEditorBody');
    const config = getCurrentProject().robotWorkspace;
    if (type === 'targets') {
      const fields = [['durationWeeks','建设周期（周）'],['budgetCny','预算（元）'],['cycleSeconds','单件节拍目标（秒）'],['positionMm','重复定位精度目标（mm）'],['interlockPercent','安全互锁通过率目标（%）']];
      body.innerHTML = fields.map(([key,label]) => `<label class="field">${label}<input name="${key}" type="number" min="0" ${key === 'interlockPercent' ? 'max="100"' : ''} step="any" value="${config.targets?.[key] ?? ''}"></label>`).join('') +
        `<label class="field">目标来源日期<input type="date" name="sourceDate" value="${escapeHTML(config.targets?.sourceDate || '')}"></label>`;
    } else {
      const links = config.links?.[selected] || {taskIds:[],riskIds:[]};
      const option = (item, name, ids) => `<label class="robot-check"><input type="checkbox" name="${name}" value="${escapeHTML(item.id)}" ${ids.includes(item.id) ? 'checked' : ''}> ${escapeHTML(name === 'task' ? item.code + ' ' + item.title : item.name)}</label>`;
      const tasks = currentTasks().map(task => option(task,'task',links.taskIds)).join('');
      const risks = currentRisks().map(risk => option(risk,'risk',links.riskIds)).join('');
      body.innerHTML = `<p>${escapeHTML(labels[selected])}</p><h3>关联任务</h3><div class="robot-checklist">${tasks || '暂无任务'}</div><h3>关联风险</h3><div class="robot-checklist">${risks || '暂无风险'}</div><p>保存时会移除已删除记录的关联。</p>`;
    }
    dialog.querySelector('#robotEditorError').textContent = '';
    showDialog(dialog);
  }
  document.addEventListener('click', event => {
    const enable = event.target.closest('[data-robot-enable]');
    if (enable) {
      const project = data.projects.find(item => item.id === enable.dataset.robotEnable);
      if (!project || !manager()) return;
      if (!project.robotWorkspace) project.robotWorkspace = {enabled:true, targets:{...defaultTargets}, links:{}};
      else project.robotWorkspace.enabled = !project.robotWorkspace.enabled;
      saveState();
      renderAll();
      return;
    }
    const action = event.target.closest('[data-robot-action]')?.dataset.robotAction;
    if (action) openEditor(action);
    const task = event.target.closest('[data-robot-task]')?.dataset.robotTask;
    if (task) jumpToTask(data.currentProjectId, task);
    const review = event.target.closest('[data-robot-review]')?.dataset.robotReview;
    if (review) openAcceptanceSettings(review);
    const risk = event.target.closest('[data-robot-risk]')?.dataset.robotRisk;
    if (risk) {
      riskFilter.value = riskQuery.value = '';
      renderRisks();
      location.hash = '#riskHeading';
      requestAnimationFrame(() => {
        const row = [...riskTableBody.rows].find(item => item.dataset.riskId === risk);
        row?.scrollIntoView({block:'center'});
        row?.focus({preventScroll:true});
      });
    }
  });
  dialog.querySelector('[data-robot-cancel]').addEventListener('click', () => closeDialog(dialog));
  dialog.querySelector('[data-robot-save]').addEventListener('click', () => {
    const project = getCurrentProject();
    if (!manager() || !project?.robotWorkspace?.enabled || project.id !== dialog.dataset.project) {
      closeDialog(dialog); return;
    }
    const form = dialog.querySelector('form');
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    if (dialog.dataset.type === 'targets') {
      const next = {};
      for (const key of ['durationWeeks','budgetCny','cycleSeconds','positionMm','interlockPercent']) {
        const value = fields.get(key);
        next[key] = value === '' ? null : Number(value);
      }
      next.sourceDate = String(fields.get('sourceDate') || '');
      project.robotWorkspace.targets = next;
    } else {
      project.robotWorkspace.links[dialog.dataset.device] = {taskIds:fields.getAll('task'), riskIds:fields.getAll('risk')};
    }
    saveState();
    closeDialog(dialog);
    renderAll();
    showMessage(sharedMode ? '设置已保存，等待同步。' : '设置已保存。');
  });

  const previousRenderAll = renderAll;
  renderAll = function() { previousRenderAll(); refresh(); };
  const previousMark = markActiveModule;
  markActiveModule = function() { previousMark(); updateVisible(); };
  window.addEventListener('hashchange', () => { markActiveModule(); });
  renderAll();
})();
