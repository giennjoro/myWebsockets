const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');

console.log('DEBUG: DASHBOARD_USERNAME:', process.env.DASHBOARD_USERNAME, 'DASHBOARD_PASSWORD:', process.env.DASHBOARD_PASSWORD);
console.log('DEBUG: App trying to listen on port:', process.env.PORT);
console.log('DEBUG: JWT_SECRET:', process.env.JWT_SECRET);
console.log('DEBUG: BROADCAST_API_KEY:', process.env.BROADCAST_API_KEY);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT;

if (!PORT) {
    console.error('Error: PORT environment variable is not set.');
    process.exit(1);
}

const BROADCAST_API_KEY = process.env.BROADCAST_API_KEY || 'my_super_secret_broadcast_api_key';
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || 'a_very_secret_key';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

if (DASHBOARD_USERNAME && DASHBOARD_PASSWORD) {
    console.log('Dashboard enabled with username/password auth.');

    app.post('/dashboard/login', (req, res) => {
        const { username, password } = req.body;
        if (username === DASHBOARD_USERNAME && password === DASHBOARD_PASSWORD) {
            const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
            res.cookie('dashboard_token', token, { httpOnly: true });
            res.redirect('/dashboard');
        } else {
            res.status(401).send('Invalid credentials');
        }
    });

    const protectDashboard = (req, res, next) => {
        const token = req.cookies.dashboard_token;
        if (!token) {
            return res.redirect('/');
        }
        try {
            jwt.verify(token, JWT_SECRET);
            next();
        } catch (err) {
            return res.redirect('/');
        }
    };

    app.get('/dashboard', protectDashboard, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    });

    app.get('/dashboard/logout', (req, res) => {
        res.clearCookie('dashboard_token');
        res.redirect('/');
    });

    const dashboard = io.of('/dashboard');

    dashboard.use((socket, next) => {
        const cookie = socket.handshake.headers.cookie;
        if (!cookie) return next(new Error('Authentication error'));
        const token = cookie.split('; ').find(row => row.startsWith('dashboard_token='))?.split('=')[1];
        if (!token) return next(new Error('Authentication error'));

        try {
            jwt.verify(token, JWT_SECRET);
            next();
        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    dashboard.on('connection', (socket) => {
        console.log('Dashboard connected');
        const interval = setInterval(async () => {
            console.log('SERVER: Calling getStats...');
            try {
                const stats = await getStats();
                console.log('SERVER: Emitting stats:', stats);
                socket.emit('stats', stats);
            } catch (error) {
                console.error('SERVER: Error in getStats:', error);
            }
        }, 5000);
        socket.on('disconnect', () => {
            console.log('Dashboard disconnected');
            clearInterval(interval);
        });
    });

    async function getStats() {
        const stats = {
            namespaces: [],
            rooms: {},
            clients: []
        };

        const uniqueNamespaces = new Set();
        const clientsByNamespace = new Map();
        const roomsByNamespace = new Map();

        // Iterate over all connected sockets across all namespaces
        console.log('SERVER: getStats - Total connected sockets:', io.sockets.sockets.size);
        for (const [socketId, socket] of io.sockets.sockets) {
            console.log(`SERVER: getStats - Processing socket ID: ${socketId}, Namespace: ${socket.nsp.name}`);
            console.log(`SERVER: getStats - Socket rooms:`, socket.rooms);
            const namespaceName = socket.nsp.name;

            if (namespaceName === '/dashboard') continue; // Skip dashboard clients

            uniqueNamespaces.add(namespaceName);

            if (!clientsByNamespace.has(namespaceName)) {
                clientsByNamespace.set(namespaceName, []);
            }
            clientsByNamespace.get(namespaceName).push(`${socketId} (${namespaceName})`);

            if (!roomsByNamespace.has(namespaceName)) {
                roomsByNamespace.set(namespaceName, new Set());
            }
            // Get rooms for the current socket
            const roomsSet = socket.rooms;
            for (const room of roomsSet) {
                // A room is not a socket ID if its name is different from the socketId
                // and it's not the namespace name itself
                if (room !== socketId && room !== namespaceName) {
                    roomsByNamespace.get(namespaceName).add(room);
                }
            }
        }

        stats.namespaces = Array.from(uniqueNamespaces).filter(name => name !== '/dashboard').sort();

        for (const nsName of stats.namespaces) {
            stats.rooms[nsName] = Array.from(roomsByNamespace.get(nsName) || []).sort();
            stats.clients = stats.clients.concat(clientsByNamespace.get(nsName) || []);
        }
        stats.clients.sort();

        return stats;
    }
} else {
    console.warn('Dashboard disabled: DASHBOARD_USERNAME or DASHBOARD_PASSWORD not set.');
    app.get('/dashboard', (req, res) => {
        res.status(403).send('Dashboard is disabled.');
    });
}
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (process.env.NODE_ENV === 'development') {
    res.status(500).json({ message: err.message, stack: err.stack });
  } else {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/broadcast', (req, res) => {
  const { tenantId, apiKey, message, room } = req.body;
  if (!tenantId || !message || !apiKey || !room) {
    return res.status(400).json({ error: 'Missing tenantId, message, room or apiKey' });
  }
  if (apiKey !== BROADCAST_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  const namespace = io.of(`/${tenantId}`);
  namespace.to(room).emit('chat message', message);
  console.log(`SERVER EMIT: Broadcasted message to /${tenantId} room ${room}: ${message}`);
  if (DASHBOARD_USERNAME && DASHBOARD_PASSWORD) {
    io.of('/dashboard').emit('message', { namespace: `/${tenantId}`, room, message: `(Broadcast) ${message}` });
  }
  res.status(200).json({ message: 'Message broadcasted successfully' });
});

const authenticateRoutes = require('./routes/authenticate')();
app.use(authenticateRoutes);

io.of(/.*/).use((socket, next) => {
  console.log(`SERVER: Authentication middleware hit for namespace: ${socket.nsp.name}`);
  if (socket.nsp.name === '/dashboard') return next();
  const tenantId = socket.nsp.name.substring(1);
  const token = socket.handshake.query.token;
  if (!token) {
    console.log(`SERVER: Auth error - No token provided for ${socket.nsp.name}`);
    return next(new Error('Authentication error: No token provided'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.tenantId !== tenantId) {
      console.log(`SERVER: Auth error - Tenant ID mismatch for ${socket.nsp.name}`);
      return next(new Error('Authentication error: Tenant ID mismatch'));
    }
    let room = decoded.userData.room;
    socket.join(room);
    console.log(`SERVER: Client ${socket.id} joined room ${room} in namespace ${socket.nsp.name}`);
    socket.on(room, (msg) => {
      const namespace = socket.nsp;
      socket.to(room).emit('chat message', msg);
      console.log(`SERVER EMIT: Client in ${namespace.name} room ${room} sent message: ${msg}`);
      if (DASHBOARD_USERNAME && DASHBOARD_PASSWORD) {
        io.of('/dashboard').emit('message', { namespace: namespace.name, room, message: msg });
      }
    });
    return next();
  } catch (err) {
    console.log(`SERVER: Auth error - Token verification failed for ${socket.nsp.name}: ${err.message}`);
    return next(new Error('Authentication error: Invalid or expired token'));
  }
});

io.of(/.*/).on('connection', (socket) => {
  if (socket.nsp.name === '/dashboard') return;
  const namespace = socket.nsp;
  console.log(`SERVER: Client connected to namespace: ${namespace.name} with ID: ${socket.id}`);
  console.log(`SERVER: Current total connected sockets (io.sockets.sockets.size): ${io.sockets.sockets.size}`);
  console.log(`SERVER: Sockets in default namespace (io.of('/').sockets.size): ${io.of('/').sockets.size}`);
  console.log(`SERVER: Sockets in tenant1 namespace (io.of('/tenant1').sockets.size): ${io.of('/tenant1').sockets.size}`);
  socket.on('chat message', (msg) => {
    namespace.emit('chat message', msg);
    console.log(`SERVER EMIT: Message received in namespace ${namespace.name} and emitted to all: ${msg}`);
    if (DASHBOARD_USERNAME && DASHBOARD_PASSWORD) {
        io.of('/dashboard').emit('message', { namespace: namespace.name, room: 'main', message: msg });
    }
  });
  socket.on('disconnect', () => {
    console.log(`User disconnected from namespace: ${namespace.name} with ID: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
  console.log(`Server PID: ${process.pid}`);
  console.log(`Server process.env.NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Server process.env.PORT: ${process.env.PORT}`);
});