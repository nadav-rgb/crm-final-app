export const pick = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value[key]]));

export const hasCode = (expected) => (error) => error?.code === expected;

export const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function fakeReq({ method = 'GET', headers = {}, body, cookies = {} } = {}) {
  return {
    method,
    headers,
    body,
    cookies,
    socket: { remoteAddress: '192.0.2.10' },
  };
}

export function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
    end() {
      return this;
    },
  };
}

export async function call(handler, context, request) {
  const req = { ...fakeReq(request), testContext: context };
  const res = fakeRes();
  await handler(req, res);
  return res;
}
