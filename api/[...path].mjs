// The root server entrypoint is also supported for zero-config deployments.
// Mark this import so it does not start a second HTTP listener inside the
// Vercel Function process.
process.env.VERCEL_API_FUNCTION = '1';
const { handleApi } = await import('../server.mjs');

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return handleApi(req, res, url);
}
