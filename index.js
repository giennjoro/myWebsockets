const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now, refine this in production
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// In a real application, these would come from environment variables or a secure config.
// For demonstration, we'll use a simple map of tenant IDs to their secret tokens.
const TENANT_SECRETS = {
  'tenant1': 'supersecretkey1',
  'tenant2': 'anothersecretkey2',
  'tenant3': 'yetanothersecretkey3'
};

const BROADCAST_API_KEY = process.env.BROADCAST_API_KEY || 'my_super_secret_broadcast_api_key';

// Middleware to parse JSON request bodies
app.use(express.json());

// Basic route for health check
app.get('/', (req, res) => {
  res.send('WebSocket server is running!');
});

// Broadcast endpoint for Laravel applications to send messages
app.post('/broadcast', (req, res) => {
  const { tenantId, message, apiKey } = req.body;

  if (!tenantId || !message || !apiKey) {
    return res.status(400).json({ error: 'Missing tenantId, message, or apiKey' });
  }

  if (apiKey !== BROADCAST_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  const namespace = io.of(`/${tenantId}`);

  // Check if there are any clients connected to this namespace
  if (namespace.sockets.size === 0) {
    console.log(`No clients connected to namespace /${tenantId}. Message not broadcast.`);
    return res.status(200).json({ message: `No clients connected to /${tenantId}. Message not broadcast.` });
  }

  namespace.emit('chat message', message);
  console.log(`Broadcasted message to /${tenantId}: ${message}`);
  res.status(200).json({ message: 'Message broadcasted successfully' });
});

// Implement multi-tenancy using namespaces with authentication
io.of(/.*/).use((socket, next) => {
  const tenantId = socket.nsp.name.substring(1); // Remove the leading '/'
  const token = socket.handshake.query.token;

  if (TENANT_SECRETS[tenantId] && TENANT_SECRETS[tenantId] === token) {
    console.log(`Authentication successful for namespace: /${tenantId}`);
    return next();
  } else {
    console.log(`Authentication failed for namespace: /${tenantId}. Invalid token or tenant ID.`);
    return next(new Error('Authentication error'));
  }
});

io.of(/.*/).on('connection', (socket) => {
  const namespace = socket.nsp; // The Namespace that this socket belongs to

  console.log(`User connected to namespace: ${namespace.name} with ID: ${socket.id}`);

  socket.on('chat message', (msg) => {
    console.log(`Message received in namespace ${namespace.name}: ${msg}`);
    namespace.emit('chat message', msg); // Emit to all clients in this namespace
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected from namespace: ${namespace.name} with ID: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});