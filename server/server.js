const WebSocket = require('ws');

const COLS = 28, ROWS = 24;
const MAX_PLAYERS = 4;
const wrap = (v, max) => ((v % max) + max) % max;
const ck   = (x, y)  => `${x},${y}`;
const DIRS = [{ x:1,y:0 },{ x:-1,y:0 },{ x:0,y:1 },{ x:0,y:-1 }];

const STARTS = [
  { snake:[{x:4,y:12},{x:3,y:12},{x:2,y:12}],    dir:{x:1,y:0}  },
  { snake:[{x:23,y:12},{x:24,y:12},{x:25,y:12}],  dir:{x:-1,y:0} },
  { snake:[{x:14,y:3},{x:14,y:2},{x:14,y:1}],     dir:{x:0,y:1}  },
  { snake:[{x:14,y:20},{x:14,y:21},{x:14,y:22}],  dir:{x:0,y:-1} },
];

// ── KI ───────────────────────────────────────────────────────
class AI {
  constructor(room) { this.room = room; }

  floodFill(pos, blocked, freeTail = null) {
    const vis = new Set([ck(pos.x, pos.y)]);
    const q = [pos];
    while (q.length) {
      const { x, y } = q.shift();
      for (const d of DIRS) {
        const nx = wrap(x+d.x,COLS), ny = wrap(y+d.y,ROWS), k = ck(nx,ny);
        if (!vis.has(k) && !(blocked.has(k) && !(freeTail && freeTail.has(k)))) {
          vis.add(k); q.push({ x:nx, y:ny });
        }
      }
    }
    return vis.size;
  }

  bfs(start, goal, blocked) {
    const q = [{ pos:start, path:[] }];
    const seen = new Set([ck(start.x, start.y)]);
    while (q.length) {
      const { pos, path } = q.shift();
      for (const d of DIRS) {
        const nx = wrap(pos.x+d.x,COLS), ny = wrap(pos.y+d.y,ROWS), k = ck(nx,ny);
        if (k === ck(goal.x,goal.y)) return [...path, d];
        if (!seen.has(k) && !blocked.has(k)) { seen.add(k); q.push({ pos:{x:nx,y:ny}, path:[...path,d] }); }
      }
    }
    return null;
  }

  dist(a, b) {
    const dx = Math.abs(a.x-b.x), dy = Math.abs(a.y-b.y);
    return Math.min(dx,COLS-dx) + Math.min(dy,ROWS-dy);
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
    for (let i = body.length-n; i < body.length; i++) free.add(ck(body[i].x,body[i].y));
    return free;
  }

  getNextDir() {
    const r = this.room, level = r.aiLevel;
    const head = r.aiSnake[0];
    const target = r.players.find(p => p.alive) || r.players[0];
    const pHead = target ? target.snake[0] : { x:14, y:12 };
    const food = r.food;
    const blocked = this.buildBlocked(), freeTail = this.buildFreeTail();
    const rev = { x:-r.aiDir.x, y:-r.aiDir.y };
    const aiTail = r.aiSnake[r.aiSnake.length-1];

    const allMoves = [];
    for (const d of DIRS) {
      if (d.x===rev.x && d.y===rev.y) continue;
      const nx=wrap(head.x+d.x,COLS), ny=wrap(head.y+d.y,ROWS), k=ck(nx,ny);
      if (blocked.has(k) && !freeTail.has(k)) continue;
      const space = this.floodFill({x:nx,y:ny}, blocked, freeTail);
      const canReachTail = !!this.bfs({x:nx,y:ny}, aiTail, blocked);
      allMoves.push({ d, nx, ny, space, canReachTail });
    }
    const safe = allMoves.filter(m => m.canReachTail);
    const moves = safe.length ? safe : allMoves;
    if (!moves.length) return r.aiDir;

    if (level===1) {
      const path = this.bfs(head, food, blocked);
      if (path?.length) return path[0];
      return moves.sort((a,b)=>b.space-a.space)[0].d;
    }
    if (level===2) {
      const path = this.bfs(head, food, blocked);
      if (path?.length) {
        const mv = moves.find(m=>m.d.x===path[0].x&&m.d.y===path[0].y);
        if (mv && mv.space > r.aiSnake.length*1.5) return path[0];
      }
      return moves.sort((a,b)=>b.space-a.space)[0].d;
    }
    const aggression = level>=4 ? 2.5 : 1.5;
    let best=null, bestScore=-Infinity;
    for (const m of moves) {
      const sim = new Set(blocked); sim.add(ck(m.nx,m.ny));
      const pSpace = this.floodFill(pHead, sim, freeTail);
      const distP  = this.dist({x:m.nx,y:m.ny}, pHead);
      const distF  = this.dist({x:m.nx,y:m.ny}, food);
      const score  = m.space - aggression*pSpace + (level>=4?(20-distP)*3:0) + (level<=3?(20-distF)*2:(20-distF));
      if (score > bestScore) { bestScore=score; best=m.d; }
    }
    if (level===5) {
      const total=COLS*ROWS-blocked.size;
      if (this.floodFill(pHead,blocked,freeTail) > total*0.3) {
        const path = this.bfs(head,food,blocked);
        if (path?.length) {
          const mv = moves.find(m=>m.d.x===path[0].x&&m.d.y===path[0].y);
          if (mv && mv.space > r.aiSnake.length) return path[0];
        }
      }
    }
    return best || moves.sort((a,b)=>b.space-a.space)[0].d;
  }
}

// ── Hilfsfunktionen ──────────────────────────────────────────
function randomCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, ()=>c[Math.floor(Math.random()*c.length)]).join('');
}

function sanitizeName(name) {
  return (name||'Spieler').trim().slice(0,16) || 'Spieler';
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

  addPlayer(ws, name) {
    const id = this.players.length + 1;
    const start = STARTS[id-1];
    const player = {
      ws, id,
      name: sanitizeName(name),
      snake: start.snake.map(s=>({...s})),
      dir:   { ...start.dir },
      dirQueue: [],
      score: 0, alive: true, wantsRematch: false,
      isCreator: id === 1,
    };
    this.players.push(player);
    return player;
  }

  isFull()  { return this.players.length >= MAX_PLAYERS; }
  isEmpty() { return this.players.every(p=>p.ws.readyState!==WebSocket.OPEN); }

  sendLobbyUpdate() {
    const msg = JSON.stringify({
      type: 'lobby',
      players: this.players.map(p=>({ id:p.id, name:p.name, isCreator:p.isCreator })),
      canStart: this.players.length >= 2,
    });
    for (const p of this.players) if (p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
  }

  placeFood() {
    const occ = new Set();
    for (const p of this.players) for (const s of p.snake) occ.add(ck(s.x,s.y));
    for (const s of this.aiSnake) occ.add(ck(s.x,s.y));
    for (const o of this.obstacles) occ.add(ck(o.x,o.y));
    let x, y;
    do { x=Math.floor(Math.random()*COLS); y=Math.floor(Math.random()*ROWS); }
    while (occ.has(ck(x,y)));
    this.food = { x, y };
  }

  addObstacle() {
    const occ = new Set();
    for (const p of this.players) for (const s of p.snake) occ.add(ck(s.x,s.y));
    for (const s of this.aiSnake) occ.add(ck(s.x,s.y));
    for (const o of this.obstacles) occ.add(ck(o.x,o.y));
    occ.add(ck(this.food.x,this.food.y));
    for (let i=0;i<100;i++) {
      const x=Math.floor(Math.random()*COLS), y=Math.floor(Math.random()*ROWS);
      if (occ.has(ck(x,y))) continue;
      let near=false;
      for (const p of this.players) if (Math.abs(x-p.snake[0].x)+Math.abs(y-p.snake[0].y)<3) { near=true; break; }
      if (near) continue;
      if (Math.abs(x-this.aiSnake[0].x)+Math.abs(y-this.aiSnake[0].y)<3) continue;
      this.obstacles.push({x,y}); break;
    }
  }

  updateAILevel() {
    const l=this.aiSnake.length;
    this.aiLevel = l>=20?5:l>=15?4:l>=10?3:l>=6?2:1;
  }

  tick() {
    for (const p of this.players) { if (!p.alive) continue; if (p.dirQueue.length > 0) { p.dir = p.dirQueue.shift(); } }
    this.aiDir = this.ai.getNextDir();

    const newHeads = {};
    for (const p of this.players) {
      if (!p.alive) continue;
      newHeads[p.id] = { x:wrap(p.snake[0].x+p.dir.x,COLS), y:wrap(p.snake[0].y+p.dir.y,ROWS) };
    }
    const aiHead = { x:wrap(this.aiSnake[0].x+this.aiDir.x,COLS), y:wrap(this.aiSnake[0].y+this.aiDir.y,ROWS) };

    const occupied = new Set();
    for (const p of this.players) if (p.alive) for (const s of p.snake.slice(0,-1)) occupied.add(ck(s.x,s.y));
    for (const s of this.aiSnake.slice(0,-1)) occupied.add(ck(s.x,s.y));
    for (const o of this.obstacles) occupied.add(ck(o.x,o.y));

    const deaths = new Set();
    for (const p of this.players) {
      if (!p.alive) continue;
      if (occupied.has(ck(newHeads[p.id].x,newHeads[p.id].y))) deaths.add(p.id);
    }
    // Kopf-an-Kopf zwischen allen Spielern
    const aliveArr = this.players.filter(p=>p.alive);
    for (let i=0;i<aliveArr.length;i++) for (let j=i+1;j<aliveArr.length;j++) {
      const a=aliveArr[i], b=aliveArr[j];
      if (ck(newHeads[a.id].x,newHeads[a.id].y)===ck(newHeads[b.id].x,newHeads[b.id].y)) {
        deaths.add(a.id); deaths.add(b.id);
      }
    }

    let aiDead = occupied.has(ck(aiHead.x,aiHead.y));
    for (const p of this.players) {
      if (p.alive && newHeads[p.id] && ck(newHeads[p.id].x,newHeads[p.id].y)===ck(aiHead.x,aiHead.y)) aiDead=true;
    }

    for (const p of this.players) {
      if (!p.alive) continue;
      if (deaths.has(p.id)) { p.alive=false; continue; }
      p.snake.unshift(newHeads[p.id]);
    }
    if (!aiDead) this.aiSnake.unshift(aiHead);

    const foodKey = ck(this.food.x,this.food.y);
    let ate=false;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (ck(p.snake[0].x,p.snake[0].y)===foodKey) { p.score++; ate=true; } else p.snake.pop();
    }
    if (!aiDead) { if (ck(this.aiSnake[0].x,this.aiSnake[0].y)===foodKey) ate=true; else this.aiSnake.pop(); }
    if (ate) { this.placeFood(); if (this.obstacles.length<20) this.addObstacle(); }

    this.updateAILevel();
    this.broadcast();

    if (this.players.every(p=>!p.alive)) {
      clearInterval(this.interval); this.started=false;
      this.sendGameOver();
    }
  }

  broadcast() {
    const state = {
      type: 'state',
      players: this.players.map(p=>({ id:p.id, name:p.name, body:p.snake, score:p.score, alive:p.alive })),
      ai:   { body:this.aiSnake },
      food: this.food,
      obstacles: this.obstacles,
      aiLevel: this.aiLevel,
      elapsed: Date.now()-this.startTime,
    };
    const msg = JSON.stringify(state);
    for (const p of this.players) if (p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
  }

  sendGameOver() {
    const sorted = [...this.players].sort((a,b)=>b.score-a.score);
    const winner = sorted[0];
    const msg = JSON.stringify({
      type: 'gameover',
      winnerId: winner.id,
      winnerName: winner.name,
      players: this.players.map(p=>({ id:p.id, name:p.name, score:p.score })),
      elapsed: Date.now()-this.startTime,
      maxAiLevel: this.aiLevel,
    });
    for (const p of this.players) if (p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
  }

  init() {
    for (const p of this.players) {
      const start = STARTS[p.id-1];
      p.snake  = start.snake.map(s=>({...s}));
      p.dir    = {...start.dir};
      p.dirQueue=[]; p.score=0; p.alive=true; p.wantsRematch=false;
    }
    this.aiSnake = [{x:14,y:6},{x:14,y:7},{x:14,y:8}];
    this.aiDir   = {x:0,y:-1};
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
      if (count >= 0) {
        send(); // sendet auch count=0 → Client blendet Countdown aus
        if (count === 0) {
          clearInterval(iv);
          setTimeout(() => { this.started=true; this.interval=setInterval(()=>this.tick(), this.speed); }, 500);
        }
      }
    }, 1000);
  }

  notifyOpponentLeft(leavingId) {
    if (this.interval) { clearInterval(this.interval); this.started=false; }
    const msg = JSON.stringify({ type:'opponentLeft', name: this.players.find(p=>p.id===leavingId)?.name });
    for (const p of this.players) {
      if (p.id!==leavingId && p.ws.readyState===WebSocket.OPEN) p.ws.send(msg);
    }
  }
}

// ── WebSocket Server ─────────────────────────────────────────
const rooms = new Map();
const clientRoom = new Map();

const PORT = process.env.PORT || 3001;
const wss = new WebSocket.Server({ port: PORT });
console.log(`snAIke server läuft auf Port ${PORT}`);

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg=JSON.parse(raw); } catch { return; }

    if (msg.type==='create') {
      let code; do { code=randomCode(); } while (rooms.has(code));
      const room = new Room(code, msg.speed||90);
      rooms.set(code, room);
      const player = room.addPlayer(ws, msg.name);
      clientRoom.set(ws, { room, player });
      ws.send(JSON.stringify({ type:'created', code, playerId:1 }));
      room.sendLobbyUpdate();
    }

    else if (msg.type==='join') {
      const code = (msg.code||'').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room)         return ws.send(JSON.stringify({ type:'error', msg:'Raum nicht gefunden.' }));
      if (room.isFull()) return ws.send(JSON.stringify({ type:'error', msg:'Raum ist voll (max. 4 Spieler).' }));
      if (room.started)  return ws.send(JSON.stringify({ type:'error', msg:'Spiel läuft bereits.' }));
      const player = room.addPlayer(ws, msg.name);
      clientRoom.set(ws, { room, player });
      ws.send(JSON.stringify({ type:'joined', playerId:player.id }));
      room.sendLobbyUpdate();
    }

    else if (msg.type==='start') {
      const entry = clientRoom.get(ws); if (!entry) return;
      const { room, player } = entry;
      if (!player.isCreator) return;
      if (room.players.length < 2) return;
      if (room.started) return;
      room.startWithCountdown();
    }

    else if (msg.type==='dir') {
      const entry = clientRoom.get(ws); if (!entry) return;
      const { player } = entry;
      const d = msg.dir;
      if (!d || typeof d.x!=='number') return;
      // prüft gegen die zuletzt gequeute Richtung (nicht die aktuelle)
      const lastDir = player.dirQueue[player.dirQueue.length - 1] ?? player.dir;
      if (d.x === -lastDir.x && d.y === -lastDir.y) return;
      if (player.dirQueue.length < 2) player.dirQueue.push(d);
    }

    else if (msg.type==='rematch') {
      const entry = clientRoom.get(ws); if (!entry) return;
      const { room, player } = entry;
      player.wantsRematch = true;
      if (room.players.every(p=>p.wantsRematch)) {
        setTimeout(()=>room.startWithCountdown(), 300);
      } else {
        const msg2 = JSON.stringify({ type:'rematchRequested', name:player.name });
        for (const p of room.players) if (p.ws!==ws && p.ws.readyState===WebSocket.OPEN) p.ws.send(msg2);
        ws.send(JSON.stringify({ type:'waitingForRematch' }));
      }
    }
  });

  ws.on('close', () => {
    const entry = clientRoom.get(ws);
    if (entry) {
      const { room, player } = entry;
      room.notifyOpponentLeft(player.id);
      // Spieler aus Liste entfernen falls noch in Lobby
      if (!room.started) {
        room.players = room.players.filter(p=>p.ws!==ws);
        room.sendLobbyUpdate();
      }
      clientRoom.delete(ws);
      setTimeout(()=>{ if (room.isEmpty()) rooms.delete(room.code); }, 60000);
    }
  });
});
