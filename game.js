/* ── snAIke ──────────────────────────────────────────────────
   Lokal-Modus:  BgAnimation + SnakeAI + SnakeGame
   Online-Modus: OnlineClient (Server führt Logik aus, Client rendert)
──────────────────────────────────────────────────────────── */

// ── WebSocket-URL (nach Deploy anpassen) ─────────────────────
const WS_URL = (() => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'ws://localhost:3001';
  return 'wss://snaike-production.up.railway.app';
})();

const COLS = 28, ROWS = 24, CELL = 22;
const W = COLS * CELL, H = ROWS * CELL;

const wrap = (v, max) => ((v % max) + max) % max;
const key  = (x, y)  => `${x},${y}`;
const dirs = [{ x:1,y:0 },{ x:-1,y:0 },{ x:0,y:1 },{ x:0,y:-1 }];

// ── BG ANIMATION ─────────────────────────────────────────────
class BgAnimation {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.snakes = [];
    this.raf    = null;
    this.resize();
    this.spawnSnakes(6);
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  spawnSnakes(n) {
    this.snakes = [];
    for (let i = 0; i < n; i++) {
      this.snakes.push({
        x: Math.floor(Math.random() * Math.floor(window.innerWidth  / 20)),
        y: Math.floor(Math.random() * Math.floor(window.innerHeight / 20)),
        dir: dirs[Math.floor(Math.random() * 4)],
        body: [],
        len: 6 + Math.floor(Math.random() * 8),
        color: i % 2 === 1 ? '#ff3a3a' : '#39ff14',
        timer: 0,
        interval: 80 + Math.floor(Math.random() * 80),
      });
    }
  }

  tick = () => {
    const { ctx, canvas } = this;
    const cw = canvas.width, ch = canvas.height;
    const cw20 = Math.floor(cw / 20), ch20 = Math.floor(ch / 20);
    ctx.clearRect(0, 0, cw, ch);
    const now = performance.now();
    for (const s of this.snakes) {
      if (now - s.timer > s.interval) {
        s.timer = now;
        s.body.unshift({ x: s.x, y: s.y });
        if (s.body.length > s.len) s.body.pop();
        if (Math.random() < 0.2) s.dir = dirs[Math.floor(Math.random() * 4)];
        s.x = ((s.x + s.dir.x) % cw20 + cw20) % cw20;
        s.y = ((s.y + s.dir.y) % ch20 + ch20) % ch20;
      }
      for (let i = 0; i < s.body.length; i++) {
        ctx.fillStyle   = s.color;
        ctx.globalAlpha = (1 - i / s.body.length) * 0.6;
        const size = i === 0 ? 14 : 10;
        ctx.beginPath();
        ctx.roundRect(s.body[i].x * 20 + 2, s.body[i].y * 20 + 2, size, size, 3);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.tick);
  };

  start() { if (!this.raf) this.tick(); }
  stop()  { cancelAnimationFrame(this.raf); this.raf = null; }
}

// ── LOKALE KI ────────────────────────────────────────────────
class SnakeAI {
  constructor(game) { this.game = game; }

  floodFill(pos, blocked, freeTail = null) {
    const vis = new Set([key(pos.x, pos.y)]);
    const q   = [pos];
    while (q.length) {
      const { x, y } = q.shift();
      for (const d of dirs) {
        const nx = wrap(x+d.x,COLS), ny = wrap(y+d.y,ROWS), k = key(nx,ny);
        if (!vis.has(k) && !(blocked.has(k) && !(freeTail && freeTail.has(k)))) {
          vis.add(k); q.push({ x:nx, y:ny });
        }
      }
    }
    return vis.size;
  }

  bfs(start, goal, blocked) {
    const q    = [{ pos:start, path:[] }];
    const seen = new Set([key(start.x, start.y)]);
    while (q.length) {
      const { pos, path } = q.shift();
      for (const d of dirs) {
        const nx = wrap(pos.x+d.x,COLS), ny = wrap(pos.y+d.y,ROWS), k = key(nx,ny);
        if (k === key(goal.x,goal.y)) return [...path,d];
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
    const g = this.game, blocked = new Set();
    for (const s of g.playerSnake) blocked.add(key(s.x,s.y));
    for (const s of g.aiSnake.slice(0,-1)) blocked.add(key(s.x,s.y));
    for (const o of g.obstacles) blocked.add(key(o.x,o.y));
    return blocked;
  }

  buildFreeTail() {
    const body = this.game.aiSnake;
    const n    = Math.max(1, Math.floor(body.length * 0.3));
    const free = new Set();
    for (let i = body.length - n; i < body.length; i++) free.add(key(body[i].x, body[i].y));
    return free;
  }

  getNextDir() {
    const g = this.game, level = g.aiLevel;
    const head = g.aiSnake[0], pHead = g.playerSnake[0], food = g.food;
    const blocked = this.buildBlocked(), freeTail = this.buildFreeTail();
    const rev    = { x:-g.aiDir.x, y:-g.aiDir.y };
    const aiTail = g.aiSnake[g.aiSnake.length-1];

    const allMoves = [];
    for (const d of dirs) {
      if (d.x===rev.x && d.y===rev.y) continue;
      const nx = wrap(head.x+d.x,COLS), ny = wrap(head.y+d.y,ROWS), k = key(nx,ny);
      if (blocked.has(k) && !freeTail.has(k)) continue;
      const space = this.floodFill({x:nx,y:ny}, blocked, freeTail);
      const canReachTail = !!this.bfs({x:nx,y:ny}, aiTail, blocked);
      allMoves.push({ d, nx, ny, space, canReachTail });
    }

    const safe  = allMoves.filter(m => m.canReachTail);
    const moves = safe.length ? safe : allMoves;
    if (!moves.length) return g.aiDir;

    if (level === 1) {
      const path = this.bfs(head, food, blocked);
      if (path?.length) return path[0];
      return moves.sort((a,b) => b.space-a.space)[0].d;
    }
    if (level === 2) {
      const path = this.bfs(head, food, blocked);
      if (path?.length) {
        const mv = moves.find(m => m.d.x===path[0].x && m.d.y===path[0].y);
        if (mv && mv.space > g.aiSnake.length * 1.5) return path[0];
      }
      return moves.sort((a,b) => b.space-a.space)[0].d;
    }

    const aggression = level >= 4 ? 2.5 : 1.5;
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      const sim = new Set(blocked); sim.add(key(m.nx,m.ny));
      const pSpace = this.floodFill(pHead, sim, freeTail);
      const distP  = this.dist({x:m.nx,y:m.ny}, pHead);
      const distF  = this.dist({x:m.nx,y:m.ny}, food);
      const interceptBonus = level >= 4 ? (20-distP)*3 : 0;
      const foodBonus      = level <= 3 ? (20-distF)*2 : (20-distF);
      const score = m.space - aggression*pSpace + interceptBonus + foodBonus;
      if (score > bestScore) { bestScore=score; best=m.d; }
    }

    if (level === 5) {
      const total  = COLS*ROWS - blocked.size;
      const pSpace = this.floodFill(pHead, blocked, freeTail);
      if (pSpace > total*0.3) {
        const path = this.bfs(head, food, blocked);
        if (path?.length) {
          const mv = moves.find(m => m.d.x===path[0].x && m.d.y===path[0].y);
          if (mv && mv.space > g.aiSnake.length) return path[0];
        }
      }
    }

    return best || moves.sort((a,b) => b.space-a.space)[0].d;
  }
}

// ── RENDERER (geteilt von Lokal + Online) ────────────────────
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.canvas.width  = W;
    this.canvas.height = H;
    this.particles = [];
  }

  draw(state) {
    // state: { p1, p2, ai, food, obstacles, myId? }
    // p1/p2/ai: { body: [{x,y},...], alive, score }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Gitter
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth   = 0.5;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,H); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(W,y*CELL); ctx.stroke(); }

    // Hindernisse
    if (state.obstacles) {
      for (const obs of state.obstacles) {
        if (obs.alpha !== undefined && obs.alpha < 1) obs.alpha = Math.min(1, obs.alpha + 0.06);
        ctx.globalAlpha = obs.alpha ?? 1;
        ctx.fillStyle = '#2a2a45';
        this.roundRect(obs.x*CELL+1, obs.y*CELL+1, CELL-2, CELL-2, 4); ctx.fill();
        ctx.strokeStyle = '#4a4a8a'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#3a3a65';
        this.roundRect(obs.x*CELL+4, obs.y*CELL+4, CELL-8, CELL-8, 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Essen
    if (state.food) this.drawFood(state.food);

    // KI-Schlange (rot, im Hintergrund)
    if (state.ai?.body?.length) this.drawSnake(state.ai.body, '#ff3a3a', '#7a0000');

    // Spieler 2 (online: cyan, lokal: nicht vorhanden)
    if (state.p2?.body?.length) {
      const alpha = state.p2.alive ? 1 : 0.35;
      ctx.globalAlpha = alpha;
      this.drawSnake(state.p2.body, '#00d4ff', '#006080');
      ctx.globalAlpha = 1;
    }

    // Spieler 1 / Du (grün, im Vordergrund)
    if (state.p1?.body?.length) {
      const alpha = state.p1.alive ? 1 : 0.35;
      ctx.globalAlpha = alpha;
      this.drawSnake(state.p1.body, '#39ff14', '#1a7a00');
      ctx.globalAlpha = 1;
    }

    // Partikel
    this.drawParticles();
  }

  drawFood(food) {
    const ctx = this.ctx;
    const cx = food.x*CELL + CELL/2, cy = food.y*CELL + CELL/2;
    const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 250);
    const grd = ctx.createRadialGradient(cx,cy,0, cx,cy, CELL*0.8*pulse);
    grd.addColorStop(0, 'rgba(255,215,0,0.35)');
    grd.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx,cy, CELL*0.8, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(cx,cy, CELL*0.28*pulse, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,200,0.6)';
    ctx.beginPath(); ctx.arc(cx-2,cy-2, CELL*0.1, 0, Math.PI*2); ctx.fill();
  }

  drawSnake(snake, colorHead, colorTail) {
    const ctx = this.ctx;
    for (let i = snake.length-1; i >= 0; i--) {
      const { x, y } = snake[i];
      const t = i / snake.length;
      const lerp = (a, b) => Math.round(parseInt(a,16) + (parseInt(b,16)-parseInt(a,16))*t);
      const r = lerp(colorHead.slice(1,3), colorTail.slice(1,3));
      const g = lerp(colorHead.slice(3,5), colorTail.slice(3,5));
      const b = lerp(colorHead.slice(5,7), colorTail.slice(5,7));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const pad = i===0?1:2, size = CELL-pad*2;
      this.roundRect(x*CELL+pad, y*CELL+pad, size, size, i===0?5:4);
      ctx.fill();
      if (i===0) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        this.roundRect(x*CELL+pad+2, y*CELL+pad+2, size/2, size/3, 2);
        ctx.fill();
      }
    }
  }

  spawnParticles(pos, color) {
    const cx = pos.x*CELL+CELL/2, cy = pos.y*CELL+CELL/2;
    for (let i = 0; i < 14; i++) {
      const angle = (i/14)*Math.PI*2, speed = 1.5+Math.random()*2;
      this.particles.push({ x:cx, y:cy, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, life:1, color, size:3+Math.random()*3 });
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    for (let i = this.particles.length-1; i >= 0; i--) {
      const p = this.particles[i];
      p.x+=p.vx; p.y+=p.vy; p.vx*=0.92; p.vy*=0.92; p.life-=0.04;
      if (p.life <= 0) { this.particles.splice(i,1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size*p.life, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  roundRect(x,y,w,h,r) { this.ctx.beginPath(); this.ctx.roundRect(x,y,w,h,r); }
}

// ── LOKALES SPIEL ────────────────────────────────────────────
class SnakeGame {
  constructor(renderer) {
    this.renderer    = renderer;
    this.ai          = new SnakeAI(this);
    this.playerSnake = [];
    this.aiSnake     = [];
    this.playerDir   = { x:1, y:0 };
    this.aiDir       = { x:-1, y:0 };
    this.nextDir     = null;
    this.food        = { x:14, y:12 };
    this.obstacles   = [];
    this.playerScore = 0;
    this.aiScore     = 0;
    this.aiLevel     = 1;
    this.maxAiLevel  = 1;
    this.running     = false;
    this.paused      = false;
    this.speed       = 90;
    this.startTime   = 0;
    this.elapsed     = 0;
    this.lastTick    = 0;
    this._raf        = null;
    this.bindKeys();
  }

  bindKeys() {
    document.addEventListener('keydown', e => {
      if (!this.running) return;
      const map = {
        'ArrowUp':'up','w':'up','W':'up',
        'ArrowDown':'dn','s':'dn','S':'dn',
        'ArrowLeft':'lt','a':'lt','A':'lt',
        'ArrowRight':'rt','d':'rt','D':'rt',
      };
      const action = map[e.key];
      if (action) {
        e.preventDefault();
        const nd = action==='up'?{x:0,y:-1}:action==='dn'?{x:0,y:1}:action==='lt'?{x:-1,y:0}:{x:1,y:0};
        if (nd.x!==-this.playerDir.x || nd.y!==-this.playerDir.y) this.nextDir = nd;
      }
      if (e.key==='p'||e.key==='P') this.togglePause();
      if (e.key==='Escape') this.quit();
    });
  }

  init(speed) {
    this.speed = speed;
    this.playerSnake = [{x:6,y:12},{x:5,y:12},{x:4,y:12}];
    this.aiSnake     = [{x:21,y:12},{x:22,y:12},{x:23,y:12}];
    this.playerDir   = {x:1,y:0}; this.aiDir={x:-1,y:0}; this.nextDir=null;
    this.obstacles   = [];
    this.playerScore = 0; this.aiScore=0; this.aiLevel=1; this.maxAiLevel=1;
    this.elapsed=0; this.paused=false;
    this.renderer.particles = [];
    this.placeFood();
    this.updateHUD();
  }

  placeFood() {
    const occ = new Set();
    for (const s of this.playerSnake) occ.add(key(s.x,s.y));
    for (const s of this.aiSnake)     occ.add(key(s.x,s.y));
    for (const o of this.obstacles)   occ.add(key(o.x,o.y));
    let x, y;
    do { x=Math.floor(Math.random()*COLS); y=Math.floor(Math.random()*ROWS); } while (occ.has(key(x,y)));
    this.food = { x, y };
  }

  addObstacle() {
    const occ = new Set();
    for (const s of this.playerSnake) occ.add(key(s.x,s.y));
    for (const s of this.aiSnake)     occ.add(key(s.x,s.y));
    for (const o of this.obstacles)   occ.add(key(o.x,o.y));
    occ.add(key(this.food.x,this.food.y));
    const pH = this.playerSnake[0], aH = this.aiSnake[0];
    for (let i=0;i<100;i++) {
      const x=Math.floor(Math.random()*COLS), y=Math.floor(Math.random()*ROWS);
      if (occ.has(key(x,y))) continue;
      if (Math.abs(x-pH.x)+Math.abs(y-pH.y)<3) continue;
      if (Math.abs(x-aH.x)+Math.abs(y-aH.y)<3) continue;
      this.obstacles.push({x,y,alpha:0}); break;
    }
  }

  updateAILevel() {
    const l = this.aiSnake.length;
    this.aiLevel = l>=20?5:l>=15?4:l>=10?3:l>=6?2:1;
    this.maxAiLevel = Math.max(this.maxAiLevel, this.aiLevel);
  }

  tick() {
    if (this.nextDir) { this.playerDir=this.nextDir; this.nextDir=null; }
    this.aiDir = this.ai.getNextDir();

    const pH = { x:wrap(this.playerSnake[0].x+this.playerDir.x,COLS), y:wrap(this.playerSnake[0].y+this.playerDir.y,ROWS) };
    const aH = { x:wrap(this.aiSnake[0].x+this.aiDir.x,COLS),     y:wrap(this.aiSnake[0].y+this.aiDir.y,ROWS) };

    const pOcc = new Set(this.playerSnake.map(s=>key(s.x,s.y)));
    const aOcc = new Set(this.aiSnake.map(s=>key(s.x,s.y)));
    const obs  = new Set(this.obstacles.map(o=>key(o.x,o.y)));
    let pDead = pOcc.has(key(pH.x,pH.y)) || aOcc.has(key(pH.x,pH.y)) || obs.has(key(pH.x,pH.y));
    let aDead = aOcc.has(key(aH.x,aH.y)) || pOcc.has(key(aH.x,aH.y)) || obs.has(key(aH.x,aH.y));
    if (key(pH.x,pH.y)===key(aH.x,aH.y)) { pDead=true; aDead=true; }

    if (pDead || aDead) { this.endGame(pDead,aDead); return; }

    this.playerSnake.unshift(pH);
    this.aiSnake.unshift(aH);

    const fk = key(this.food.x,this.food.y);
    const pAte = key(pH.x,pH.y)===fk, aAte = key(aH.x,aH.y)===fk;
    if (pAte) { this.playerScore++; this.renderer.spawnParticles(this.food,'#ffd700'); }
    else this.playerSnake.pop();
    if (aAte) { this.aiScore++; this.renderer.spawnParticles(this.food,'#ff3a3a'); }
    else this.aiSnake.pop();
    if (pAte||aAte) { this.placeFood(); if (this.obstacles.length<20) this.addObstacle(); }

    this.updateAILevel();
    this.updateHUD();
    this.renderer.draw({ p1:{body:this.playerSnake,alive:true,score:this.playerScore}, ai:{body:this.aiSnake}, food:this.food, obstacles:this.obstacles });
  }

  updateHUD() {
    document.getElementById('player-score').textContent = this.playerScore;
    document.getElementById('p2-score').textContent     = this.aiScore;
    const maxLen = Math.max(this.playerSnake.length, this.aiSnake.length, 3);
    document.getElementById('player-bar').style.width = `${(this.playerSnake.length/maxLen)*100}%`;
    document.getElementById('p2-bar').style.width     = `${(this.aiSnake.length/maxLen)*100}%`;
    const badge = document.getElementById('ai-level-badge');
    const labels = ['','Stufe 1 – Anfänger','Stufe 2 – Lernend','Stufe 3 – Gefährlich','Stufe 4 – Aggressiv','Stufe 5 – TÖDLICH'];
    badge.textContent = labels[this.aiLevel]||`Stufe ${this.aiLevel}`;
    badge.classList.toggle('danger', this.aiLevel>=4);
    const secs=Math.floor(this.elapsed/1000), mins=Math.floor(secs/60);
    document.getElementById('timer').textContent = `${mins}:${String(secs%60).padStart(2,'0')}`;
  }

  togglePause() {
    if (!this.running || this.gameOver) return;
    this.paused = !this.paused;
    document.getElementById('pause-overlay').classList.toggle('hidden',!this.paused);
    if (!this.paused) this.loop(performance.now());
  }

  quit() { this.running=false; cancelAnimationFrame(this._raf); showScreen('start'); bgAnim.start(); }

  loop = (now) => {
    if (!this.running || this.paused) return;
    this.elapsed = now - this.startTime;
    if (now - this.lastTick >= this.speed) { this.lastTick=now; this.tick(); }
    else { this.renderer.draw({ p1:{body:this.playerSnake,alive:true}, ai:{body:this.aiSnake}, food:this.food, obstacles:this.obstacles }); }
    if (this.running) this._raf = requestAnimationFrame(this.loop);
  };

  start(speed) {
    this.init(speed);
    this.renderer.draw({ p1:{body:this.playerSnake,alive:true}, ai:{body:this.aiSnake}, food:this.food, obstacles:[] });
  }

  startLoop() {
    this.running=true;
    this.startTime=performance.now();
    this.lastTick=this.startTime;
    this._raf = requestAnimationFrame(this.loop);
  }

  endGame(pDead, aDead) {
    this.running=false; cancelAnimationFrame(this._raf);
    const secs=Math.floor(this.elapsed/1000), mins=Math.floor(secs/60);
    const trophy = pDead&&aDead?'🤝':pDead?'🤖':'🏆';
    const title  = pDead&&aDead?'Unentschieden!':pDead?'KI gewinnt!':'Du gewinnst!';
    const sub    = pDead&&aDead?'Gleichzeitig kollidiert.':pDead?'Die KI hatte dich im Griff.':'Stark! Die KI hatte keine Chance.';
    document.getElementById('end-trophy').textContent    = trophy;
    document.getElementById('end-title').textContent     = title;
    document.getElementById('end-subtitle').textContent  = sub;
    document.getElementById('stat-player-score').textContent = this.playerScore;
    document.getElementById('stat-ai-score').textContent     = this.aiScore;
    document.getElementById('stat-time').textContent         = `${mins}:${String(secs%60).padStart(2,'0')}`;
    document.getElementById('stat-ai-level').textContent     = this.maxAiLevel;
    document.getElementById('stat-p1-lbl').textContent       = 'Deine Punkte';
    document.getElementById('stat-p2-lbl').textContent       = 'KI Punkte';
    document.getElementById('stat-p2-block').style.display   = '';
    document.getElementById('rematch-status').classList.add('hidden');
    document.getElementById('play-again-btn').onclick = () => startCountdown(this.speed);
    setTimeout(() => showScreen('end'), 600);
  }
}

// ── ONLINE CLIENT ────────────────────────────────────────────
class OnlineClient {
  constructor(renderer) {
    this.renderer  = renderer;
    this.ws        = null;
    this.myId      = null;
    this.roomCode  = null;
    this.lastState = null;
    this.speed     = 90;
    this.foodAnim  = null;
  }

  connect(onOpen) {
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen  = onOpen;
    this.ws.onmessage = e => this.handleMessage(JSON.parse(e.data));
    this.ws.onerror = () => showError('Verbindung fehlgeschlagen. Ist der Server gestartet?');
    this.ws.onclose = () => {
      if (this.myId) showError('Verbindung getrennt.');
    };
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  handleMessage(msg) {
    switch (msg.type) {

      case 'created':
        this.myId     = 1;
        this.roomCode = msg.code;
        document.getElementById('display-code').textContent = msg.code;
        showScreen('waiting');
        break;

      case 'opponentJoined':
        document.querySelector('.waiting-title').textContent = 'Mitspieler verbunden! Starte…';
        break;

      case 'joined':
        this.myId = 2;
        showScreen('game');
        this.setupGameHUD(true);
        break;

      case 'countdown': {
        showScreen('game');
        this.setupGameHUD(true);
        const el = document.getElementById('countdown');
        el.classList.remove('hidden');
        el.textContent = msg.count;
        el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
        if (msg.count === 0) el.classList.add('hidden');
        break;
      }

      case 'state':
        this.lastState = msg;
        this.renderState(msg);
        this.updateOnlineHUD(msg);
        break;

      case 'gameover':
        this.showOnlineEnd(msg);
        break;

      case 'opponentLeft':
        showError('Dein Mitspieler hat das Spiel verlassen.');
        this.disconnect();
        break;

      case 'rematchRequested':
        document.getElementById('rematch-status').textContent = 'Mitspieler möchte nochmal spielen…';
        document.getElementById('rematch-status').classList.remove('hidden');
        break;

      case 'waitingForRematch':
        document.getElementById('rematch-status').textContent = 'Warte auf Mitspieler…';
        document.getElementById('rematch-status').classList.remove('hidden');
        break;

      case 'error':
        showError(msg.msg);
        break;
    }
  }

  renderState(state) {
    // Vom Server kommt state.p1 und state.p2 — "ich" bin myId
    this.renderer.draw(state);
    // Dead overlay für eigene Schlange
    const me = this.myId === 1 ? state.p1 : state.p2;
    const dead = document.getElementById('dead-overlay');
    if (me && !me.alive) { dead.classList.remove('hidden'); }
    else                 { dead.classList.add('hidden'); }
  }

  updateOnlineHUD(state) {
    const p1 = state.p1, p2 = state.p2;
    document.getElementById('player-score').textContent = p1?.score ?? 0;
    document.getElementById('p2-score').textContent     = p2?.score ?? 0;
    const maxLen = Math.max(p1?.body?.length??3, p2?.body?.length??3, 3);
    document.getElementById('player-bar').style.width = `${((p1?.body?.length??3)/maxLen)*100}%`;
    document.getElementById('p2-bar').style.width     = `${((p2?.body?.length??3)/maxLen)*100}%`;
    const badge = document.getElementById('ai-level-badge');
    const labels = ['','Stufe 1','Stufe 2','Stufe 3 – Gefährlich','Stufe 4 – Aggressiv','Stufe 5 – TÖDLICH'];
    badge.textContent = labels[state.aiLevel]||`Stufe ${state.aiLevel}`;
    badge.classList.toggle('danger', state.aiLevel>=4);
    const secs=Math.floor((state.elapsed||0)/1000), mins=Math.floor(secs/60);
    document.getElementById('timer').textContent = `${mins}:${String(secs%60).padStart(2,'0')}`;
  }

  setupGameHUD(isOnline) {
    const p2Score = document.getElementById('p2-score');
    const p2Bar   = document.getElementById('p2-bar');
    const p1Name  = document.getElementById('hud-p1-name');
    const p2Name  = document.getElementById('hud-p2-name');
    if (isOnline) {
      p2Score.classList.add('online');
      p2Bar.classList.add('online');
      p1Name.textContent = this.myId===1 ? 'Du 🟢' : 'Spieler 1';
      p2Name.textContent = this.myId===2 ? 'Du 🔵' : 'Spieler 2';
    } else {
      p2Score.classList.remove('online');
      p2Bar.classList.remove('online');
      p1Name.textContent = 'Du';
      p2Name.textContent = 'KI';
    }
    document.getElementById('dead-overlay').classList.add('hidden');
    document.getElementById('pause-overlay').classList.add('hidden');
    document.getElementById('countdown').classList.add('hidden');
  }

  showOnlineEnd(result) {
    const isP1 = this.myId === 1;
    const myScore    = isP1 ? result.p1Score : result.p2Score;
    const theirScore = isP1 ? result.p2Score : result.p1Score;

    let trophy, title, sub;
    if (result.winner === 'draw') {
      trophy='🤝'; title='Unentschieden!'; sub='Punktegleichstand — ihr seid gleich gut!';
    } else if ((result.winner==='player1'&&isP1)||(result.winner==='player2'&&!isP1)) {
      trophy='🏆'; title='Du gewinnst!'; sub='Glückwunsch — dein Gegner hatte keine Chance!';
    } else {
      trophy='💀'; title='Verloren!'; sub='Dein Gegner war diesmal besser. Revanche?';
    }

    document.getElementById('end-trophy').textContent    = trophy;
    document.getElementById('end-title').textContent     = title;
    document.getElementById('end-subtitle').textContent  = sub;
    document.getElementById('stat-player-score').textContent = myScore;
    document.getElementById('stat-ai-score').textContent     = theirScore;
    const secs=Math.floor((result.elapsed||0)/1000), mins=Math.floor(secs/60);
    document.getElementById('stat-time').textContent     = `${mins}:${String(secs%60).padStart(2,'0')}`;
    document.getElementById('stat-ai-level').textContent = result.maxAiLevel;
    document.getElementById('stat-p1-lbl').textContent   = 'Deine Punkte';
    document.getElementById('stat-p2-lbl').textContent   = 'Gegner Punkte';
    document.getElementById('rematch-status').classList.add('hidden');

    document.getElementById('play-again-btn').onclick = () => {
      this.send({ type:'rematch' });
      document.getElementById('rematch-status').textContent = 'Anfrage gesendet…';
      document.getElementById('rematch-status').classList.remove('hidden');
    };

    setTimeout(() => showScreen('end'), 600);
  }

  bindKeys() {
    const dirMap = {
      'ArrowUp':'up','w':'up','W':'up',
      'ArrowDown':'dn','s':'dn','S':'dn',
      'ArrowLeft':'lt','a':'lt','A':'lt',
      'ArrowRight':'rt','d':'rt','D':'rt',
    };
    document.addEventListener('keydown', e => {
      if (!document.getElementById('game-screen').classList.contains('active')) return;
      const action = dirMap[e.key];
      if (action) {
        e.preventDefault();
        const d = action==='up'?{x:0,y:-1}:action==='dn'?{x:0,y:1}:action==='lt'?{x:-1,y:0}:{x:1,y:0};
        this.send({ type:'dir', dir:d });
      }
      if (e.key==='Escape') { this.disconnect(); showScreen('start'); bgAnim.start(); }
    });
  }

  disconnect() {
    this.myId=null; this.roomCode=null;
    if (this.ws) { this.ws.onclose=null; this.ws.close(); this.ws=null; }
  }
}

// ── UI HELPERS ───────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`${name}-screen`).classList.add('active');
}

function showError(msg) {
  const el = document.getElementById('online-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  showScreen('online');
}

// ── GLOBALE VARIABLEN ────────────────────────────────────────
let bgAnim   = null;
let renderer = null;
let localGame = null;
let onlineClient = null;
let selSpeed = 90;

function startCountdown(speed) {
  localGame.start(speed);
  document.getElementById('hud-p1-name').textContent = 'Du';
  document.getElementById('hud-p2-name').textContent = 'KI';
  document.getElementById('p2-score').classList.remove('online');
  document.getElementById('p2-bar').classList.remove('online');
  document.getElementById('dead-overlay').classList.add('hidden');
  showScreen('game');
  const el = document.getElementById('countdown');
  el.classList.remove('hidden');
  let count = 3;
  el.textContent = count;
  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      el.textContent = count;
      el.style.animation='none'; void el.offsetWidth; el.style.animation='';
    } else {
      clearInterval(iv);
      el.classList.add('hidden');
      localGame.startLoop();
    }
  }, 800);
}

// ── INIT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  bgAnim   = new BgAnimation(document.getElementById('bg-canvas'));
  renderer = new Renderer(document.getElementById('game-canvas'));
  localGame = new SnakeGame(renderer);
  onlineClient = new OnlineClient(renderer);
  onlineClient.bindKeys();

  bgAnim.start();
  window.addEventListener('resize', () => bgAnim.resize());

  // Schwierigkeit
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selSpeed = parseInt(btn.dataset.speed);
    });
  });

  // Einzelspieler
  document.getElementById('start-btn').addEventListener('click', () => {
    bgAnim.stop();
    startCountdown(selSpeed);
  });

  // Online-Button → Lobby
  document.getElementById('online-btn').addEventListener('click', () => {
    bgAnim.stop();
    document.getElementById('online-error').classList.add('hidden');
    showScreen('online');
  });

  // Zurück aus Lobby
  document.getElementById('online-back-btn').addEventListener('click', () => {
    onlineClient.disconnect();
    showScreen('start');
    bgAnim.start();
  });

  // Raum erstellen
  document.getElementById('create-room-btn').addEventListener('click', () => {
    document.getElementById('online-error').classList.add('hidden');
    onlineClient.disconnect();
    onlineClient = new OnlineClient(renderer);
    onlineClient.bindKeys();
    onlineClient.speed = selSpeed;
    onlineClient.connect(() => onlineClient.send({ type:'create', speed:selSpeed }));
  });

  // Raum beitreten
  document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('code-input').value.trim().toUpperCase();
    if (code.length < 4) { showError('Bitte einen 4-stelligen Code eingeben.'); return; }
    document.getElementById('online-error').classList.add('hidden');
    onlineClient.disconnect();
    onlineClient = new OnlineClient(renderer);
    onlineClient.bindKeys();
    onlineClient.connect(() => onlineClient.send({ type:'join', code }));
  });

  document.getElementById('code-input').addEventListener('keydown', e => {
    if (e.key==='Enter') document.getElementById('join-room-btn').click();
  });

  // Warten abbrechen
  document.getElementById('waiting-cancel-btn').addEventListener('click', () => {
    onlineClient.disconnect();
    showScreen('online');
  });

  // Pause (nur Einzelspieler)
  document.getElementById('resume-btn').addEventListener('click', () => localGame.togglePause());
  document.getElementById('quit-btn').addEventListener('click', () => {
    localGame.quit(); bgAnim.start();
  });

  // End-Screen
  document.getElementById('menu-btn').addEventListener('click', () => {
    onlineClient.disconnect();
    showScreen('start');
    bgAnim.start();
  });

  showScreen('start');
});
