const isDevPort = window.location.port === '5173';
const apiHost = window.location.hostname || 'localhost';
const isPrivateHost = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(apiHost);
const baseUrl = isDevPort && isPrivateHost ? `http://${apiHost}:4000/api` : '/api';

export function getSession() {
  return JSON.parse(localStorage.getItem('session') || 'null');
}

export function setSession(user) {
  localStorage.setItem('session', JSON.stringify(user));
}

export async function api(path, options = {}) {
  const session = getSession();
  const init = {
    method: options.method || 'GET',
    headers: { 'x-user-id': session?.id || '' }
  };
  if (options.formData) init.body = options.formData;
  else if (options.body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '请求失败');
  return data;
}
