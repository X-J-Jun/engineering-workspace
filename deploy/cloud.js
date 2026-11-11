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

  window.workspaceCloud = {
    async signIn(email, password) {
      const result = await auth('password', {email, password});
      if (!result) return false;
      remember(result);
      return true;
    },
    async signOut() {
      const accessToken = session?.access_token;
      remember(null);
      if (accessToken) {
        await fetch(url + '/auth/v1/logout?scope=local', {
          method: 'POST', headers: {apikey: key, Authorization: 'Bearer ' + accessToken}
        });
      }
    },
    async request(path, options = {}) {
      const accessToken = await token();
      if (!accessToken) return new Response(null, {status: 401});
      const routes = {'/api/state': 'state', '/api/sync': 'sync', '/api/task-action': 'task-action',
        '/api/members': options.method === 'POST' ? 'member-write' : 'members'};
      const response = await fetch(url + '/rest/v1/rpc/workspace_api', {
        method: 'POST',
        headers: {apikey: key, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
        body: JSON.stringify({route: routes[path], payload: options.body ? JSON.parse(options.body) : {}})
      });
      if (!response.ok) {
        if (response.status === 401) remember(null);
        return response;
      }
      const result = await response.json();
      return new Response(JSON.stringify(result), {status: result.status || 200});
    }
  };
})();

