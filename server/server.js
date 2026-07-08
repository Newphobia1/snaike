const WebSocket = require('ws');

const COLS = 28, ROWS = 24;
const wrap = (v, max) => ((v % max) + max) % max;
const ck   = (x, y)  => `${x},${y}`;
const DIRS = [{ x:1,y:0 },{ x:-1,y:0 },{ x:0,y:1 },{ x:0,y:-1 }];

// ── KI ───────────────────────────────────────────────────────
class AI {
  constructor(room) { this.room = room; }

  floodFill(pos, blocked, freeTail = null) {
    const vis = new Set([ck(pos.x, pos.y)]);
    const q = [pos];
    while (q.length) {
      const { x, y } = q.shift();
      for (const d of DIRS) {
        const nx = wrap(x + d.x, COLS), ny = wrap(y + d.y, ROWS), k = ck(nx, ny);
        if (!vis.has(k) && !(blocked.has(k) && !(freeTail && freeTail.has(k)))) {
          vis.add(k); q.push({ x: nx, y: ny });
        }
      }
    }
    return vis.size;
  }

  bfs(start, goal, blocked) {
    const q = [{ pos: start, path: [] }];
    const seen = new Set([ck(start.x, start.y)]);
    while (q.length) {
      const { pos, path } = q.shift();
      for (const d of DIRS) {
        const nx = wrap(pos.x + d.x, COLS), ny = wrap(pos.y + d.y, ROWS), k = ck(nx, ny);
        if (k === ck(goal.x, goal.y)) return [...path, d];
        if (!seen.has(k) && !blocked.has(k)) { seen.add(k); q.push({ pos:{x:nx,y:ny}, path:[...path,d] }); }
      }
    }
    return null;
  }

  dist(a, b) {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return Math.min(dx, COLS-dx) + Math.min(dy, ROWS-dy);
  }

  buildBlocked() {
    const r = this.room, blocked = new Set();
    for (const p of r.players) if (p.alive) for (const s of p.snake.slice(0,-1)) blocked.add(ck(s.x,s.y));
    for (const s of r.aiSnake.slice(0,-1)) blocked.add(ck(s.x,s.y));
    for (const o of r.obstacles) blocked.add(ck(o.x,o.y));
    return blocked;
  }

  buildFreeTail() {
    const body = this.room.aiSnake;
    const n = Math.max(1, Math.floor(body.length * 0.3));
    const free = new Set();
    for (let i = body.length - n; i < body.length; i++) free.add(ck(body[i].x, body[i].y));
    return free;
  }

  getNextDir() {
    const r = this.room, level = r.aiLevel;
    const head = r.aiSnake[0];
    const target = r.players.find(p => p.alive) || r.players[0];
    const pHead = target ? target.snake[0] : { x: 14, y: 12 };
    const food = r.food;
    const blocked = this.buildBlocked(), freeTail = this.buildFreeTail();
    const rev = { x: -r.aiDir.x, y: -r.aiDir.y };
    const aiTail = r.aiSnake[r.aiSnake.length - 1];

    const allMoves = [];
    for (const d of DIRS) {
      if (d.x === rev.x && d.y === rev.y) continue;
      const nx = wrap(head.x+d.x, COLS), ny = wrap(head.y+d.y, ROWS), k = ck(nx,ny);
      if (blocked.has(k) && !freeTail.has(k)) continue;
      const space = this.floodFill({x:nx,y:ny}, blocked, freeTail);
      const canReachTail = !!this.bfs({x:nx,y:ny}, aiTail, blocked);
      allMoves.push({ d, nx, ny, space, canReachTail });
    }

    const safe = allMoves.filter(m => m.canReachTail);
    const moves = safe.length ? safe : allMoves;
    if (!moves.length) return r.aiDir;

    if (level === 1) {
      const path = this.bfs(head, food, blocked);
      if (path?.length) return path[0];
      return moves.sort((a,b) => b.space-a.space)[0].d;
    }
    if (level === 2) {
      const path = this.bfs(head, food, blocked);
      if (path?.length) {
        const mv = moves.find(m => m.d.x===path[0].x && m.d.y===path[0].y);
        if (mv && mv.space > r.aiSnake.length * 1.5) return path[0];
      }
      return moves.sort((a,b) => b.space-a.space)[0].d;
    }

    const aggression = level >= 4 ? 2.5 : 1.5;
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      const sim = new Set(blocked); sim.add(ck(m.nx,m.ny));
      const pSpace = this.floodFill(pHead, sim, freeTail);
      const distP = this.dist({x:m.nx,y:m.ny}, pHead);
      const distF = this.dist({x:m.nx,y:m.ny}, food);
      const interceptBonus = level >= 4 ? (20-distP)*3 : 0;
      const foodBonus = level <= 3 ? (20-distF)*2 : (20-distF);
      const score = m.space - aggression*pSpace + interceptBonus + foodBonus;
      if (score > bestScore) { bestScore = score; best = m.d; }
    }

    if (level === 5) {
      const total = COLS*ROWS - blocked.size;
      const pSpace = this.floodFill(pHead, blocked, freeTail);
      if (pSpace > total*0.3) {
        const path = this.bfs(head, food, blocked);
        if (path?.length) {
          const mv = moves.find(m => m.d.x===path[0].x && m.d.y===path[0].y);
          if (mv && mv.space > r.aiSnake.length) return path[0];
        }
      }
    }

    return best || moves.sort((a,b) => b.space-a.space)[0].d;
  }
}

// ── Hilfsfunktionen ──────────────────────────────────────────
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

// ── Raum ─────────────────────────────────────────────────────
class Room {
  constructor(code, speed) {
    this.code      = code;
    this.speed     = speed;
    this.players   = [];
    this.aiSnake   = [];
    this.aiDir     = { x:0, y:-1 };
    this.aiLevel   = 1;
    this.food      = { x:14, y:12 };
    this.obstacles = [];
    this.startTime = null;
    this.interval  = null;
    this.started   = false;
    this.ai        = new AI(this);
  }

  addPlayer(ws) {
    const id = this.players.length + 1;
    const player = {
      ws, id,
      snake: id === 1
        ? [{x:5,y:12},{x:4,y:12},{x:3,y:12}]
        : [{x:22,y:12},{x:23,y:12},{x:24,y:12}],
      dir:     id === 1 ? {x:1,y:0} : {x:-1,y:0},
      nextDir: null,
      score:   0,
      alive:   true,
      wantsRematch: false,
    };
    this.players.push(player);
    return player;
  }

  isFull()  { return this.players.length >= 2; }
  isEmpty() { return this.players.every(p => p.ws.readyState !== WebSocket.OPEN); }

  placeFood() {
    const occ = new Set();
    for (const p of this.players) for (const s of p.snake) occ.add(ck(s.x,s.y));
    for (const s of this.aiSnake)  occ.add(ck(s.x,s.y));
    for (const o of this.obstacles) occ.add(ck(o.x,o.y));
    let x, y;
    do { x = Math.floor(Math.random()*COLS); y = Math.floor(Math.random()*ROWS); }
    while (occ.has(ck(x,y)));
    this.food = { x, y };
  }

  addObstacle() {
    const occ = new Set();
    for (const p of this.players) for (const s of p.snake) occ.add(ck(s.x,s.y));
    for (const s of this.aiSnake) occ.add(ck(s.x,s.y));
    for (const o of this.obstacles) occ.add(ck(o.x,o.y));
    occ.add(ck(this.food.x, this.food.y));
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(Math.random()*COLS), y = Math.floor(Math.random()*ROWS);
      if (occ.has(ck(x,y))) continue;
      let tooClose = false;
      for (const p of this.players) {
        if (Math.abs(x-p.snake[0].x)+Math.abs(y-p.snake[0].y) < 3) { tooClose=true; break; }
      }
      if (tooClose) continue;
      if (Math.abs(x-this.aiSnake[0].x)+Math.abs(y-this.aiSnake[0].y) < 3) continue;
      this.obstacles.push({ x, y });
      break;
    }
  }

  updateAILevel() {
    const l = this.aiSnake.length;
    this.aiLevel = l>=20?5 : l>=15?4 : l>=10?3 : l>=6?2 : 1;
  }

  tick() {
    // Richtungen anwenden
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.nextDir) { p.dir = p.nextDir; p.nextDir = null; }
    }
    this.aiDir = this.ai.getNextDir();

    // Neue Köpfe berechnen
    const newHeads = {};
    for (const p of this.players) {
      if (!p.alive) continue;
      newHeads[p.id] = { x: wrap(p.snake[0].x+p.dir.x,COLS), y: wrap(p.snake[0].y+p.dir.y,ROWS) };
    }
    const aiHead = { x: wrap(this.aiSnake[0].x+this.aiDir.x,COLS), y: wrap(this.aiSnake[0].y+this.aiDir.y,ROWS) };

    // Belegtes Spielfeld (Schwanz bewegt sich weg → slice 0,-1)
    const occupied = new Set();
    for (const p of this.players) if (p.alive) for (const s of p.snake.slice(0,-1)) occupied.add(ck(s.x,s.y));
    for (const s of this.aiSnake.slice(0,-1)) occupied.add(ck(s.x,s.y));
    for (const o of this.obstacles) occupied.add(ck(o.x,o.y));

    // Kollisionen Spieler
    const deaths = new Set();
    for (const p of this.players) {
      if (!p.alive) continue;
      if (occupied.has(ck(newHeads[p.id].x, newHeads[p.id].y))) deaths.add(p.id);
    }
    // Kopf-an-Kopf zwischen Spielern
    if (this.players.length===2 && this.players[0].alive && this.players[1].alive) {
      if (ck(newHeads[1].x,newHeads[1].y) === ck(newHeads[2].x,newHeads[2].y)) {
        deaths.add(1); deaths.add(2);
      }
    }
    // KI-Kollision
    let aiDead = occupied.has(ck(aiHead.x,aiHead.y));
    for (const p of this.players) {
      if (p.alive && newHeads[p.id] && ck(newHeads[p.id].x,newHeads[p.id].y)===ck(aiHead.x,aiHead.y)) aiDead=true;
    }

    // Schlangen bewegen
    for (const p of this.players) {
      if (!p.alive) continue;
      if (deaths.has(p.id)) { p.alive=false; continue; }
      p.snake.unshift(newHeads[p.id]);
    }
    if (!aiDead) this.aiSnake.unshift(aiHead);

    // Essen
    const foodKey = ck(this.food.x,this.food.y);
    let ate = false;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (ck(p.snake[0].x,p.snake[0].y)===foodKey) { p.score++; ate=true; }
      else p.snake.pop();
    }
    if (!aiDead) {
      if (ck(this.aiSnake[0].x,this.aiSnake[0].y)===foodKey) ate=true;
      else this.aiSnake.pop();
    }
    if (ate) { this.placeFood(); if (this.obstacles.length<20) this.addObstacle(); }

    this.updateAILevel();
    this.broadcast();

    // Spielende: alle Spieler tot
    if (this.players.every(p => !p.alive)) {
      clearInterval(this.interval); this.started=false;
      this.sendGameOver();
    }
  }

  broadcast() {
    const state = {
      type: 'state',
      p1: this.players[0] ? { body:this.players[0].snake, score:this.players[0].score, alive:this.players[0].alive } : null,
      p2: this.players[1] ? { body:this.players[1].snake, score:this.players[1].score, alive:this.players[1].alive } : null,
      ai:   { body: this.aiSnake },
      food: this.food,
      obstacles: this.obstacles,
      aiLevel: this.aiLevel,
      elapsed: Date.now() - this.startTime,
    };
    const msg = JSON.stringify(state);
    for (const p of this.players) if (p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
  }

  sendGameOver() {
    const alive = this.players.filter(p => p.alive);
    let winner = alive.length===1 ? `player${alive[0].id}`
                : this.players[0]?.score > this.players[1]?.score ? 'player1'
                : this.players[1]?.score > this.players[0]?.score ? 'player2'
                : 'draw';
    const msg = JSON.stringify({
      type: 'gameover', winner,
      p1Score: this.players[0]?.score ?? 0,
      p2Score: this.players[1]?.score ?? 0,
      elapsed: Date.now()-this.startTime,
      maxAiLevel: this.aiLevel,
    });
    for (const p of this.players) if (p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
  }

  init() {
    for (const p of this.players) {
      p.snake = p.id===1 ? [{x:5,y:12},{x:4,y:12},{x:3,y:12}] : [{x:22,y:12},{x:23,y:12},{x:24,y:12}];
      p.dir = p.id===1 ? {x:1,y:0} : {x:-1,y:0};
      p.nextDir=null; p.score=0; p.alive=true; p.wantsRematch=false;
    }
    this.aiSnake = [{x:14,y:6},{x:14,y:7},{x:14,y:8}];
    this.aiDir = {x:0,y:-1};
    this.aiLevel = 1;
    this.obstacles = [];
    this.placeFood();
    this.startTime = Date.now();
  }

  startWithCountdown() {
    if (this.interval) clearInterval(this.interval);
    this.init();
    this.broadcast();
    let count = 3;
    const send = () => {
      const msg = JSON.stringify({ type:'countdown', count });
      for (const p of this.players) if (p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
    };
    send();
    const iv = setInterval(() => {
      count--;
      if (count > 0) { send(); }
      else {
        clearInterval(iv);
        this.started=true;
        this.interval = setInterval(() => this.tick(), this.speed);
      }
    }, 1000);
  }

  notifyOpponentLeft(leavingId) {
    if (this.interval) { clearInterval(this.interval); this.started=false; }
    const other = this.players.find(p => p.id!==leavingId);
    if (other?.ws.readyState===WebSocket.OPEN) {
      other.ws.send(JSON.stringify({ type:'opponentLeft' }));
    }
  }
}

// ── WebSocket Server ─────────────────────────────────────────
const rooms = new Map();
const clientRoom = new Map(); // ws → { room, player }

const PORT = process.env.PORT || 3001;
const wss = new WebSocket.Server({ port: PORT });
console.log(`snAIke server läuft auf Port ${PORT}`);

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      let code; do { code=randomCode(); } while (rooms.has(code));
      const room = new Room(code, msg.speed||90);
      rooms.set(code, room);
      const player = room.addPlayer(ws);
      clientRoom.set(ws, { room, player });
      ws.send(JSON.stringify({ type:'created', code, playerId:1 }));
    }

    else if (msg.type === 'join') {
      const code = (msg.code||'').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room)         return ws.send(JSON.stringify({ type:'error', msg:'Raum nicht gefunden.' }));
      if (room.isFull()) return ws.send(JSON.stringify({ type:'error', msg:'Raum ist bereits voll.' }));
      if (room.started)  return ws.send(JSON.stringify({ type:'error', msg:'Spiel läuft bereits.' }));
      const player = room.addPlayer(ws);
      clientRoom.set(ws, { room, player });
      // Spieler 1 informieren
      const p1 = room.players[0];
      if (p1.ws.readyState===WebSocket.OPEN) p1.ws.send(JSON.stringify({ type:'opponentJoined' }));
      ws.send(JSON.stringify({ type:'joined', playerId:2 }));
      setTimeout(() => room.startWithCountdown(), 500);
    }

    else if (msg.type === 'dir') {
      const entry = clientRoom.get(ws); if (!entry) return;
      const { player } = entry;
      const d = msg.dir;
      if (!d || typeof d.x!=='number') return;
      if (d.x===-player.dir.x && d.y===-player.dir.y) return; // Umkehr verbieten
      player.nextDir = d;
    }

    else if (msg.type === 'rematch') {
      const entry = clientRoom.get(ws); if (!entry) return;
      const { room, player } = entry;
      player.wantsRematch = true;
      if (room.players.every(p => p.wantsRematch)) {
        setTimeout(() => room.startWithCountdown(), 300);
      } else {
        const other = room.players.find(p => p.ws!==ws);
        if (other?.ws.readyState===WebSocket.OPEN) other.ws.send(JSON.stringify({ type:'rematchRequested' }));
        ws.send(JSON.stringify({ type:'waitingForRematch' }));
      }
    }
  });

  ws.on('close', () => {
    const entry = clientRoom.get(ws);
    if (entry) {
      const { room, player } = entry;
      room.notifyOpponentLeft(player.id);
      clientRoom.delete(ws);
      // Raum nach 60s aufräumen falls leer
      setTimeout(() => { if (room.isEmpty()) rooms.delete(room.code); }, 60000);
    }
  });
});
