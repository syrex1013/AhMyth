const io = require('socket.io-client');

const port = 1234; // Change this to the port your server is listening on
const numConnections = 5;

for (let i = 0; i < numConnections; i++) {
  const socket = io(`http://localhost:${port}`, {
    query: {
      id: `test-client-${i}`,
      manf: 'Test-Manf',
      model: 'Test-Model',
      release: '1.0'
    }
  });

  socket.on('connect', () => {
    console.log(`Client ${i} connected`);
  });

  socket.on('disconnect', () => {
    console.log(`Client ${i} disconnected`);
  });
}
