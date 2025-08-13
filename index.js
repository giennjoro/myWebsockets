const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
require('dotenv').config();

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
  'tenant1': process.env.TENANT1_SECRET || 'supersecretkey1',
  'tenant2': process.env.TENANT2_SECRET || 'anothersecretkey2',
  'tenant3': process.env.TENANT3_SECRET || 'yetanothersecretkey3'
};

const BROADCAST_API_KEY = process.env.BROADCAST_API_KEY || 'my_super_secret_broadcast_api_key';

// Middleware to parse JSON request bodies
app.use(express.json());

// Basic route for health check
app.get('/', (req, res) => {
  res.send('WebSocket server is running!');
});

// Error-handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack); // Show full stack trace in console

  // Show full error details only in development
  if (process.env.NODE_ENV === 'development') {
    res.status(500).json({
      message: err.message,
      stack: err.stack
    });
  } else {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// For JSON bodies
app.use(express.json());

// For form-urlencoded bodies (optional, if you send data as form)
app.use(express.urlencoded({ extended: true }));

// Broadcast endpoint for Laravel applications to send messages
app.post('/broadcast', (req, res) => {
  console.log(req.body, 'here dump');
  
  const { tenantId, apiKey, message, room } = req.body;

  if (!tenantId || !message || !apiKey || !room) {
    return res.status(400).json({ error: 'Missing tenantId, message, room or apiKey' });
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

  // namespace.emit('chat message', message);
  let event_name = 'chat message';
  namespace.to(room).emit(event_name, message);
  console.log(`Broadcasted message to /${tenantId}: ${message}`);
  res.status(200).json({ message: 'Message broadcasted successfully' });
});

// Register routes
const authenticateRoutes = require('./routes/authenticate')();
app.use(authenticateRoutes);

// Implement multi-tenancy using namespaces with authentication
io.of(/.*/).use((socket, next) => {
  const tenantId = socket.nsp.name.substring(1); // Remove the leading '/'
  const token = socket.handshake.query.token;

  if (!token) {
    console.log(`Missing token for namespace: /${tenantId}`);
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.tenantId !== tenantId) {
      console.log(`Token tenantId mismatch for namespace: /${tenantId}`);
      return next(new Error('Authentication error: Tenant ID mismatch'));
    }

    let room = decoded.userData.room;
    socket.join(room);

    console.log(`Joined Room: ${room}`);

    socket.on(room, (msg) => {
      const namespace = socket.nsp;

      console.log(`Message sent by user in namespace ${namespace.name}: ${msg}, Room: ${room}`);

      let event_name = 'chat message';
      // namespace.to(room).emit(event_name, msg);
      socket.to(room).emit(event_name, msg);
    });

    return next();
  } catch (err) {
    console.log(`Token verification failed for namespace: /${tenantId} - ${err.message}`);
    return next(new Error('Authentication error: Invalid or expired token'));
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

