(() => {
  const {url, key} = window.workspaceCloudConfig;
  const sessionKey = 'ecut-cloud-session:' + url;
  let session;
  try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
  let refreshing;

  function remember(value) {
    session = value;
    try {
      if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
      else sessionStorage.removeItem(sessionKey);
    } catch {}
  }

  async function auth(grant, credentials) {
    const response = await fetch(url + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: {apikey: key, 'Content-Type': 'application/json'},
      body: JSON.stringify(credentials)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in};
  }

  async function token() {
    if (!session) return null;
    if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
    refreshing ||= auth('refresh_token', {refresh_token: session.refresh_token})
      .then(remember).finally(() => { refreshing = null; });
    await refreshing;
    return session?.access_token;
  }

  function callWorkspace(path, options, accessToken) {
    const routes = {'/api/state': 'state', '/api/sync': 'sync', '/api/task-action': 'task-action',
      '/api/members': options.method === 'POST' ? 'member-write' : 'members'};
    return fetch(url + '/rest/v1/rpc/workspace_api', {
      method: 'POST',
      headers: {apikey: key, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
      body: JSON.stringify({route: routes[path], payload: options.body ? JSON.parse(options.body) : {}})
    });
  }

  function revoke(accessToken) {
    return fetch(url + '/auth/v1/logout?scope=local', {
      method: 'POST', headers: {apikey: key, Authorization: 'Bearer ' + accessToken}
    });
  }

  window.workspaceCloud = {
    async signIn(email, password) {
      const result = await auth('password', {email, password});
      if (!result) return false;
      remember(result);
      return true;
    },
    async switchAccount(email, password) {
      const next = await auth('password', {email, password});
      if (!next) return {status: 401};
      const response = await callWorkspace('/api/state', {}, next.access_token);
      if (!response.ok) return {status: response.status};
      const result = await response.json();
      if (!result.state || !result.actor || !result.role) return {status: result.status || 403};

      const previous = session;
      remember(next);
      if (previous?.access_token && previous.access_token !== next.access_token) {
        void revoke(previous.access_token).catch(() => {});
      }
      return result;
    },
    async signOut() {
      const accessToken = session?.access_token;
      remember(null);
      if (accessToken) await revoke(accessToken);
    },
    async request(path, options = {}) {
      const accessToken = await token();
      if (!accessToken) return new Response(null, {status: 401});
      const response = await callWorkspace(path, options, accessToken);
      if (!response.ok) {
        if (response.status === 401) remember(null);
        return response;
      }
      const result = await response.json();
      return new Response(JSON.stringify(result), {status: result.status || 200});
    }
  };
})();

