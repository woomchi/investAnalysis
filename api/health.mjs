import { handleApi } from '../server.mjs';

export default async function handler(req, res) {
  return handleApi(req, res, new URL('/api/health', `https://${req.headers.host || 'localhost'}`));
}
