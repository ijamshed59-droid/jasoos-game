import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 25000, pingTimeout: 20000 });
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Jasoos' }));

const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const wordSets = {
  'پاکستانی شہر': ['پشاور','اسلام آباد','لاہور','کراچی','کوئٹہ','مردان','سوات','ایبٹ آباد','ملتان','فیصل آباد','حیدرآباد','سکھر','چترال','بنوں','ڈیرہ اسماعیل خان','مانسہرہ','گوجرانوالہ','سیالکوٹ'],
  'کھانے': ['بریانی','چپلی کباب','نہاری','حلیم','پائے','کڑاہی','سموسہ','پکوڑے','گول گپے','سیخ کباب','حلوہ پوری','ساگ','مٹن قورمہ','جلیبی','لسی','نان'],
  'کرکٹرز': ['بابر اعظم','شاہد آفریدی','وسیم اکرم','انضمام الحق','شعیب اختر','محمد رضوان','شاہین آفریدی','سرفراز احمد','یونس خان','مصباح الحق','حسن علی','فخر زمان','شعیب ملک','محمد حفیظ'],
  'روزمرہ اشیا': ['موبائل','پنکھا','کتاب','چابی','کرسی','میز','گھڑی','چھتری','جوتا','تکیہ','چمچ','دروازہ','آئینہ','بیگ','قلم','ہیڈفون','لیپ ٹاپ','بوتل']
};
const safeName = v => String(v ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
const makeCode = () => { let c; do { c = Array.from({length:4}, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(c)); return c; };
const publicRoom = room => ({
  code: room.code, hostId: room.hostId, phase: room.phase, round: room.round,
  category: room.category, players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, connected:p.connected, score:p.score })),
  hints: room.hints.map(h => ({ playerId:h.playerId, name:room.players.get(h.playerId)?.name ?? 'کھلاڑی', text:h.text })),
  turnPlayerId: room.turnOrder[room.turnIndex] ?? null,
  votesSubmitted: room.votes.size,
  totalPlayers: [...room.players.values()].length,
  result: room.result,
  lastGuessCorrect: room.lastGuessCorrect,
  revealedWord: room.phase === 'result' ? room.word : null,
  message: room.message
});
const sendRoom = room => io.to(room.code).emit('room:update', publicRoom(room));
const sendPrivateRoles = room => {
  for (const p of room.players.values()) {
    const isSpy = p.id === room.spyId;
    io.to(p.socketId).emit('game:role', { isSpy, word: isSpy ? null : room.word, category: room.category, round: room.round });
  }
};
const roomFor = socket => { const code = socket.data.roomCode; return code ? rooms.get(code) : null; };
const fail = (socket, message) => socket.emit('app:error', message);
const joinedPlayer = (room, socket, name, token) => {
  const id = crypto.randomUUID();
  const p = { id, name, token: token || crypto.randomBytes(24).toString('hex'), socketId:socket.id, connected:true, score:0 };
  room.players.set(id, p); socket.data.roomCode = room.code; socket.data.playerId = id; socket.join(room.code);
  socket.emit('player:identity', { id, token:p.token, code:room.code });
  return p;
};

io.on('connection', socket => {
  socket.on('room:create', ({name} = {}) => {
    const clean = safeName(name); if (!clean) return fail(socket, 'اپنا نام لکھیں۔');
    const code = makeCode();
    const room = { code, hostId:null, phase:'lobby', round:0, players:new Map(), category:null, word:null, spyId:null, hints:[], turnOrder:[], turnIndex:0, votes:new Map(), result:null, lastGuessCorrect:null, message:'میزبان کھیل شروع کر سکتا ہے۔' };
    rooms.set(code, room); const p = joinedPlayer(room, socket, clean); room.hostId = p.id; sendRoom(room);
  });
  socket.on('room:join', ({code,name,token,playerId} = {}) => {
    const room = rooms.get(String(code ?? '').toUpperCase()); const clean = safeName(name);
    if (!room) return fail(socket, 'یہ کمرہ نہیں ملا۔ کوڈ دوبارہ چیک کریں۔');
    if (!clean) return fail(socket, 'اپنا نام لکھیں۔');
    if (room.phase !== 'lobby' && room.phase !== 'between' && room.phase !== 'result' && room.phase !== 'spyguess') {
      // Existing players can reconnect mid-round; new players cannot join a live round.
      const old = [...room.players.values()].find(p => p.token === token && p.id === playerId);
      if (!old) return fail(socket, 'راؤنڈ جاری ہے؛ نئے کھلاڑی اگلے راؤنڈ میں شامل ہو سکتے ہیں۔');
    }
    let p = [...room.players.values()].find(x => x.token === token && x.id === playerId);
    if (p) {
      if (p.socketId) { const previous = io.sockets.sockets.get(p.socketId); if (previous && previous.id !== socket.id) previous.leave(room.code); }
      p.socketId = socket.id; p.connected = true; p.name = clean || p.name; socket.data.roomCode = room.code; socket.data.playerId = p.id; socket.join(room.code);
      socket.emit('player:identity', { id:p.id, token:p.token, code:room.code });
      if (room.phase === 'hints' || room.phase === 'voting' || room.phase === 'spyguess') {
        const isSpy = p.id === room.spyId; socket.emit('game:role', {isSpy, word:isSpy ? null : room.word, category:room.category, round:room.round});
      }
    } else {
      if (room.players.size >= 8) return fail(socket, 'کمرہ بھر چکا ہے۔ زیادہ سے زیادہ ۸ کھلاڑی شامل ہو سکتے ہیں۔');
      if (!['lobby','between','result'].includes(room.phase)) return fail(socket, 'اگلے راؤنڈ سے پہلے شامل نہیں ہو سکتے۔');
      p = joinedPlayer(room, socket, clean);
    }
    room.message = `${p.name} کھیل میں واپس آ گئے۔`; sendRoom(room);
  });
  socket.on('game:start', () => {
    const room = roomFor(socket); if (!room) return;
    if (room.hostId !== socket.data.playerId) return fail(socket, 'صرف میزبان کھیل شروع کر سکتا ہے۔');
    if (!['lobby','between','result'].includes(room.phase)) return;
    if (room.players.size < 3) return fail(socket, 'کھیل شروع کرنے کے لیے کم از کم ۳ کھلاڑی چاہییں۔');
    if (room.players.size > 8) return fail(socket, 'زیادہ سے زیادہ ۸ کھلاڑی ہو سکتے ہیں۔');
    room.round++; room.category = Object.keys(wordSets)[crypto.randomInt(Object.keys(wordSets).length)];
    const words = wordSets[room.category]; room.word = words[crypto.randomInt(words.length)];
    const players = [...room.players.values()]; room.spyId = players[crypto.randomInt(players.length)].id;
    room.hints = []; room.turnOrder = players.map(p=>p.id); room.turnIndex = 0; room.votes = new Map(); room.result = null; room.lastGuessCorrect = null;
    room.phase = 'hints'; room.message = 'اپنی باری پر ایک لفظ کا اشارہ دیں۔'; sendPrivateRoles(room); sendRoom(room);
  });
  socket.on('hint:submit', ({text} = {}) => {
    const room = roomFor(socket); if (!room || room.phase !== 'hints') return;
    const pid = socket.data.playerId; if (room.turnOrder[room.turnIndex] !== pid) return fail(socket, 'ابھی آپ کی باری نہیں ہے۔');
    const hint = safeName(text).replace(/\s+/g,' '); if (!hint || hint.split(' ').length > 1) return fail(socket, 'صرف ایک لفظ کا اشارہ دیں۔');
    room.hints.push({playerId:pid, text:hint}); room.turnIndex++;
    if (room.turnIndex >= room.turnOrder.length) { room.phase = 'voting'; room.message = 'اب خفیہ ووٹ دیں کہ جاسوس کون ہے۔'; }
    else room.message = 'اشارہ محفوظ ہو گیا۔ اگلے کھلاڑی کی باری ہے۔';
    sendRoom(room);
  });
  socket.on('vote:submit', ({targetId} = {}) => {
    const room = roomFor(socket); if (!room || room.phase !== 'voting') return;
    const pid = socket.data.playerId;
    if (room.votes.has(pid)) return fail(socket, 'آپ اپنا ووٹ پہلے ہی دے چکے ہیں۔');
    if (!room.players.has(targetId) || targetId === pid) return fail(socket, 'کسی دوسرے کھلاڑی کو منتخب کریں۔');
    room.votes.set(pid, targetId); socket.emit('vote:accepted');
    if (room.votes.size >= room.players.size) {
      const counts = new Map(); for (const id of room.votes.values()) counts.set(id,(counts.get(id)||0)+1);
      const max = Math.max(...counts.values()); const leaders = [...counts].filter(([,n])=>n===max).map(([id])=>id);
      const caught = leaders.length === 1 && leaders[0] === room.spyId;
      room.result = { caught, spyId:room.spyId, spyName:room.players.get(room.spyId)?.name ?? 'جاسوس', votedPlayerId:leaders.length===1?leaders[0]:null, tie:leaders.length>1, voteCounts:[...counts].map(([id,count])=>({id,name:room.players.get(id)?.name??'کھلاڑی',count})) };
      if (caught) { room.phase='spyguess'; room.message='جاسوس پکڑا گیا! اب اسے خفیہ لفظ کا آخری اندازہ لگانا ہے۔'; }
      else { room.phase='result'; room.message=leaders.length>1?'ووٹ برابر ہو گئے؛ جاسوس جیت گیا۔':'جاسوس بچ نکلا؛ جاسوس جیت گیا۔'; room.players.get(room.spyId).score += 2; }
    } else room.message = 'ووٹ موصول ہو گیا۔ باقی کھلاڑیوں کا انتظار ہے۔';
    sendRoom(room);
  });
  socket.on('spy:guess', ({guess} = {}) => {
    const room = roomFor(socket); if (!room || room.phase !== 'spyguess') return;
    if (socket.data.playerId !== room.spyId) return fail(socket, 'صرف جاسوس آخری اندازہ لگا سکتا ہے۔');
    const normalized = String(guess ?? '').trim().toLocaleLowerCase('ur');
    const correct = normalized === room.word.toLocaleLowerCase('ur'); room.lastGuessCorrect = correct;
    if (correct) { room.players.get(room.spyId).score += 3; room.message='جاسوس نے لفظ بھی پہچان لیا! جاسوس جیت گیا۔'; }
    else { for (const p of room.players.values()) if (p.id !== room.spyId) p.score += 1; room.message='جاسوس لفظ نہ پہچان سکا۔ باقی کھلاڑی جیت گئے!'; }
    room.phase='result'; sendRoom(room);
  });
  socket.on('game:next', () => {
    const room = roomFor(socket); if (!room) return;
    if (room.hostId !== socket.data.playerId) return fail(socket, 'صرف میزبان اگلا راؤنڈ شروع کر سکتا ہے۔');
    if (room.phase !== 'result') return;
    room.phase='between'; room.message='اگلے راؤنڈ کے لیے تیار ہیں۔ میزبان شروع کرے۔'; sendRoom(room);
  });
  socket.on('room:leave', () => {
    const room = roomFor(socket); if (!room) return;
    const pid = socket.data.playerId; const leaving = room.players.get(pid);
    if (leaving) room.players.delete(pid);
    if (room.hostId === pid) { const nextHost = [...room.players.values()].find(p => p.connected); room.hostId = nextHost?.id ?? [...room.players.keys()][0] ?? null; }
    socket.leave(room.code); socket.data.roomCode = null; socket.data.playerId = null;
    if (room.players.size === 0) rooms.delete(room.code); else sendRoom(room);
  });
  socket.on('disconnect', () => {
    const room = roomFor(socket); if (!room) return;
    const p = room.players.get(socket.data.playerId); if (p && p.socketId === socket.id) { p.connected=false; p.socketId=null; room.message=`${p.name} کا رابطہ منقطع ہو گیا؛ وہ دوبارہ شامل ہو سکتے ہیں۔`; sendRoom(room); }
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Jasoos running on ${port}`));
