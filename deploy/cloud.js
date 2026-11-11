(() => {
  const {url, key} = window.workspaceCloudConfig;
  const sessionKey = 'ecut-cloud-session:' + url;
  const verifierKey = sessionKey + ':github-pkce';

  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  function githubCallbackError(error, code, description) {
    const detail = (description || '').toLowerCase();
    if (code === 'signup_disabled') return '当前工作区暂停了新账号注册，请联系所有者。';
    if (code === 'provider_email_needs_verification' || detail.includes('getting user email') ||
        detail.includes('email is not verified') || detail.includes('no verified email')) {
      return 'Supabase 未能取得已验证的 GitHub 邮箱。请在 GitHub 的 Settings → Emails 检查邮箱验证状态后重试。';
    }
    if (detail.includes('unable to exchange external code') || detail.includes('incorrect_client_credentials')) {
      return 'Supabase 无法用 GitHub 授权码换取登录凭据。请让所有者查看 Supabase Auth 日志，核对 GitHub OAuth App 的 Client ID 和 Client Secret。';
    }
    if (code === 'bad_oauth_state' || code === 'bad_oauth_callback' || code === 'flow_state_expired') {
      return 'GitHub 授权状态无效或已过期。请在同一个浏览器标签页重新点击「注册」并完成授权。';
    }
    if (error === 'access_denied') return 'GitHub 授权未完成，请重新点击「注册」并在 GitHub 同意授权。';
    const reason = code || error || '';
    const reference = /^[a-z][a-z0-9_]{1,60}$/.test(reason) ? '（错误代码 ' + reason + '）' : '';
    return 'GitHub 授权未返回登录凭据' + reference + '。请让所有者查看 Supabase Auth 日志中同一时间的回调错误。';
  }

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
    async githubEnabled() {
      const response = await fetch(url + '/auth/v1/settings', {headers: {apikey: key}});
      return response.ok && (await response.json()).external?.github === true;
    },
    async startGithubSignIn() {
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      sessionStorage.setItem(verifierKey, verifier);
      const target = new URL(url + '/auth/v1/authorize');
      target.search = new URLSearchParams({
        provider: 'github',
        redirect_to: new URL('./', location.href).href,
        code_challenge: base64url(new Uint8Array(hash)),
        code_challenge_method: 's256'
      });
      location.assign(target);
    },
    async completeGithubSignIn() {
      const callback = new URL(location.href);
      const verifier = sessionStorage.getItem(verifierKey);
      const code = callback.searchParams.get('code');
      const fragment = new URLSearchParams(callback.hash.slice(1));
      const error = callback.searchParams.get('error') || fragment.get('error');
      const errorCode = callback.searchParams.get('error_code') || fragment.get('error_code');
      const description = callback.searchParams.get('error_description') || fragment.get('error_description');
      if (!code && !error && !errorCode) return false;

      sessionStorage.removeItem(verifierKey);
      for (const name of ['code', 'error', 'error_code', 'error_description']) callback.searchParams.delete(name);
      if (fragment.has('error') || fragment.has('error_code')) callback.hash = '';
      history.replaceState(null, '', callback);
      if (!code) throw new Error(githubCallbackError(error, errorCode, description));
      if (!verifier) throw new Error('当前标签页找不到 GitHub 登录验证信息。请在 Chrome 或 Edge 的同一标签页重新注册并完成授权。');
      const next = await auth('pkce', {auth_code: code, code_verifier: verifier});
      if (!next) throw new Error('GitHub 登录验证未成功，请在同一标签页重新注册并完成授权。');
      const previous = session;
      remember(next);
      if (previous?.access_token && previous.access_token !== next.access_token) {
        void revoke(previous.access_token).catch(() => {});
      }
      return true;
    },
    async join(action, fields = {}) {
      const accessToken = await token();
      if (!accessToken) return {status: 401};
      const response = await fetch(url + '/rest/v1/rpc/workspace_join', {
        method: 'POST',
        headers: {apikey: key, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
        body: JSON.stringify({action, ...fields})
      });
      return response.ok ? response.json() : {status: response.status};
    },
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

