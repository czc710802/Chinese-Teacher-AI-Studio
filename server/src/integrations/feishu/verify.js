import { loadFeishuConfig } from './config.js';

export function verifyFeishuEvent({ body, env = process.env, config: inputConfig = null } = {}) {
  if (!body || typeof body !== 'object') {
    return {
      statusCode: 400,
      body: { message: 'invalid request body' }
    };
  }

  if (body.type === 'url_verification' || body.challenge) {
    const config = inputConfig || loadFeishuConfig(env);
    if (config.verificationToken && body.token && body.token !== config.verificationToken) {
      return {
        statusCode: 401,
        body: { message: 'verification token mismatch' }
      };
    }

    return {
      statusCode: 200,
      body: { challenge: body.challenge }
    };
  }

  return null;
}
