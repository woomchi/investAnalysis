import { handleApi } from '../../server.mjs';

export default async function handler(req, res) {
  const ticker = Array.isArray(req.query?.ticker) ? req.query.ticker[0] : req.query?.ticker;
  const path = `/api/analysis/${encodeURIComponent(ticker || '')}`;
  return handleApi(req, res, new URL(path, `https://${req.headers.host || 'localhost'}`));
}
