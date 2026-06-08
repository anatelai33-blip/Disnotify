import express from 'express';
import session from 'express-session';
import { PrismaClient } from '@prisma/client';
import logger from '../logger/winston.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.DASHBOARD_SECRET || 'default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.sendFile(path.join(__dirname, 'login.html'));
  }
}

app.get('/login.html', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Disnotify Pro - Login</title>
    <style>
      body { font-family: Arial; background: #1a1a2e; display: flex; justify-content: center; align-items: center; height: 100vh; }
      .login-box { background: #16213e; padding: 40px; border-radius: 10px; width: 300px; }
      h2 { color: #e94560; text-align: center; }
      input { width: 100%; padding: 10px; margin: 10px 0; border: none; border-radius: 5px; }
      button { width: 100%; padding: 10px; background: #e94560; color: white; border: none; border-radius: 5px; cursor: pointer; }
    </style>
    </head>
    <body>
      <div class="login-box">
        <h2>Disnotify Pro</h2>
        <form method="POST" action="/login">
          <input type="password" name="password" placeholder="Dashboard Password" required>
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  if (req.body.password === process.env.DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/dashboard');
  } else {
    res.send('<h3>Invalid password</h3><a href="/login.html">Try again</a>');
  }
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const recentJoins = await prisma.joinEvent.findMany({
    orderBy: { joinedAt: 'desc' },
    take: 50
  });
  
  const stats = {
    totalJoins: await prisma.joinEvent.count(),
    todayJoins: await prisma.joinEvent.count({
      where: { joinedAt: { gte: new Date(new Date().setHours(0,0,0)) } }
    })
  };
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Disnotify Pro - Dashboard</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial; background: #0f0f1a; color: #eee; padding: 20px; }
      .container { max-width: 1200px; margin: 0 auto; }
      h1 { color: #e94560; }
      .stats { display: grid; grid-template-columns: repeat(2,1fr); gap: 20px; margin: 20px 0; }
      .stat-card { background: #1a1a2e; padding: 20px; border-radius: 10px; text-align: center; }
      .stat-number { font-size: 2.5em; font-weight: bold; color: #e94560; }
      table { width: 100%; background: #1a1a2e; border-radius: 10px; overflow: hidden; }
      th, td { padding: 12px; text-align: left; border-bottom: 1px solid #2a2a3e; }
      th { background: #16213e; color: #e94560; }
      .logout { float: right; background: #e94560; padding: 5px 15px; border-radius: 5px; text-decoration: none; color: white; }
    </style>
    </head>
    <body>
      <div class="container">
        <a href="/logout" class="logout">Logout</a>
        <h1>🔔 Disnotify Pro Dashboard</h1>
        <div class="stats">
          <div class="stat-card"><div class="stat-number">${stats.totalJoins}</div><div class="stat-label">Total Join Events</div></div>
          <div class="stat-card"><div class="stat-number">${stats.todayJoins}</div><div class="stat-label">Today's Joins</div></div>
        </div>
        <h3>📋 Recent Join Activity</h3>
        <table>
          <tr><th>Username</th><th>Server</th><th>Joined At</th><th>Notified</th></tr>
          ${recentJoins.map(join => `
            <tr><td>${join.username}</td><td>${join.serverName}</td><td>${new Date(join.joinedAt).toLocaleString()}</td><td>${join.notified ? '✅' : '❌'}</td></tr>
          `).join('')}
        </table>
      </div>
    </body>
    </html>
  `);
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.listen(PORT, () => {
  logger.info(\`📊 Dashboard running at http://localhost:\${PORT}\`);
});

export default app;
