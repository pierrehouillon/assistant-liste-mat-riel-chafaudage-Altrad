// api/ping.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, ts: Date.now() });
  }
  return res.status(405).json({ error: "Méthode non autorisée" });
}
