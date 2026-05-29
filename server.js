require('dotenv').config();
const express = require('express');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Razorpay = require('razorpay');

// ── WHATSAPP ──────────────────────────────────────────
function sendWhatsApp(order) {
  const SID  = process.env.TWILIO_SID;
  const TOK  = process.env.TWILIO_TOKEN;
  const FROM = process.env.TWILIO_WA_FROM;
  const TO   = process.env.OWNER_WHATSAPP;
  if (!SID || !TOK || !FROM || !TO) return;
  const msg =
    `🛒 *New Moringai Order!*\n──────────────────\n` +
    `Order ID : ${order.id}\nCustomer : ${order.customer}\n` +
    `Phone    : ${order.phone}\nCity     : ${order.city}\n` +
    `Address  : ${order.address}\n` +
    `Items    : ${order.items.map(i=>i.name+' x'+i.qty).join(', ')}\n` +
    `Total    : ₹${order.total}\n──────────────────`;
  _sendTwilio(SID, TOK, FROM, TO, msg);
}
function sendCustomerWhatsApp(order) {
  const SID  = process.env.TWILIO_SID;
  const TOK  = process.env.TWILIO_TOKEN;
  const FROM = process.env.TWILIO_WA_FROM;
  if (!SID || !TOK || !FROM) return;
  const to = 'whatsapp:+91' + order.phone.replace(/\D/g,'').slice(-10);
  const msg =
    `✅ *Order Confirmed — Moringai*\n──────────────────\n` +
    `Hi ${order.customer.split(' ')[0]}! Your order is confirmed.\n` +
    `Order ID : ${order.id}\nTotal    : ₹${order.total}\n` +
    `We will ship within 2 business days. 🌿`;
  _sendTwilio(SID, TOK, FROM, to, msg);
}
function _sendTwilio(SID, TOK, FROM, TO, body) {
  const bd = new URLSearchParams({ From: FROM, To: TO, Body: body }).toString();
  const auth = Buffer.from(`${SID}:${TOK}`).toString('base64');
  const opts = {
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${SID}/Messages.json`,
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded', 'Authorization':'Basic '+auth, 'Content-Length': Buffer.byteLength(bd) }
  };
  const req = https.request(opts, res => {
    let d='';
    res.on('data', c=>d+=c);
    res.on('end', ()=>{ const p=JSON.parse(d); if(p.sid) console.log('[WA] sent',p.sid); else console.error('[WA]',p.message); });
  });
  req.on('error', e=>console.error('[WA] error',e.message));
  req.write(bd); req.end();
}

const app = express();
const DB  = path.join(__dirname, 'data', 'db.json');

const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

// ── MIDDLEWARE ────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DB HELPERS ────────────────────────────────────────
function readDB()  { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
function writeDB(d){ fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }

// ── PUBLIC API ────────────────────────────────────────
app.get('/api/product',  (_,res) => res.json(readDB().product));
app.get('/api/settings', (_,res) => res.json(readDB().settings));

// ── EMAIL VALIDATION HELPER ───────────────────────────
function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/orders
app.post('/api/orders', (req, res) => {
  const { customer, email, phone, city, address, items, payment } = req.body;
  if (!customer || !phone || !city || !address || !items?.length)
    return res.status(400).json({ error: 'Missing required fields' });
  if (email && !isValidEmail(email))
    return res.status(400).json({ error: 'Invalid email address' });
  const db    = readDB();
  const price = Number(db.product.price);
  // FIX: Total is always calculated server-side from db price (prevents frontend price tampering)
  const total = items.reduce((a,b)=> a + (b.qty * price), 0);
  // FIX: Use uuid for order ID to prevent collision when orders are deleted
  const order = {
    id: 'ORD-' + uuid().slice(0,8).toUpperCase(),
    customer, email, phone, city, address,
    items: items.map(it=>({ name: db.product.name, qty: it.qty, price })),
    total,
    payment: payment || { method: 'cod' },
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(order);
  writeDB(db);
  sendWhatsApp(order);
  sendCustomerWhatsApp(order);
  res.status(201).json({ success: true, order });
});

// ── RAZORPAY ─────────────────────────────────────────
app.post('/api/payments/create-order', async (req, res) => {
  try {
    if (!razorpay) return res.status(500).json({ error: 'Razorpay not configured' });
    // FIX: Always recalculate amount server-side from db price; never trust client-sent amount
    const db    = readDB();
    const price = Number(db.product.price);
    const items = req.body.items;
    if (!items || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'Items are required to calculate amount' });
    const amt = items.reduce((a, b) => a + (b.qty * price), 0);
    if (!amt || amt < 1) return res.status(400).json({ error: 'Invalid amount' });
    // FIX: Replaced deprecated payment_capture:1 with payment: { capture: 'automatic' }
    const order = await razorpay.orders.create({
      amount: Math.round(amt * 100),
      currency: 'INR',
      receipt: 'rcpt_' + Date.now(),
      payment: { capture: 'automatic' }
    });
    res.json({ success: true, order });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/payments/verify', (req, res) => {
  // FIX: crypto is now required at top of file, not inside route handler
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  const expected = crypto.createHmac('sha256', secret).update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
  if (expected === razorpay_signature) return res.json({ success: true, verified: true });
  res.status(400).json({ success: false, verified: false });
});

// ── ADMIN AUTH ───────────────────────────────────────
// FIX: JWT_SECRET is now REQUIRED. Server will throw at startup if not set, preventing insecure fallback.
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('❌  FATAL: JWT_SECRET is not set in environment variables. Server will not start.');
  process.exit(1);
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ','');
  try { req.admin = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD)
    return res.json({ token: jwt.sign({ username }, SECRET, { expiresIn: '24h' }) });
  res.status(401).json({ error: 'Invalid credentials' });
});

// ── ADMIN ROUTES ─────────────────────────────────────
app.get('/api/admin/orders',          auth, (_,res) => res.json(readDB().orders));
app.get('/api/admin/stats',           auth, (_,res) => {
  const db = readDB();
  res.json({ totalOrders: db.orders.length, totalRevenue: db.orders.reduce((a,b)=>a+b.total,0), pending: db.orders.filter(o=>o.status==='pending').length, shipped: db.orders.filter(o=>o.status==='shipped').length });
});
app.patch('/api/admin/orders/:id',    auth, (req,res) => {
  const db = readDB();
  const order = db.orders.find(o=>o.id===req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { status } = req.body;
  order.status = status;
  writeDB(db);
  if (status === 'shipped') {
    const SID=process.env.TWILIO_SID, TOK=process.env.TWILIO_TOKEN, FROM=process.env.TWILIO_WA_FROM;
    if(SID&&TOK&&FROM){
      const to='whatsapp:+91'+order.phone.replace(/\D/g,'').slice(-10);
      _sendTwilio(SID,TOK,FROM,to,`📦 Your Moringai order ${order.id} is shipped! You will receive it in 2-4 days. Thank you 🌿`);
    }
  }
  res.json({ success: true, order });
});
app.delete('/api/admin/orders/:id',   auth, (req,res) => {
  const db = readDB();
  db.orders = db.orders.filter(o=>o.id!==req.params.id);
  writeDB(db);
  res.json({ success: true });
});
app.put('/api/admin/product',         auth, (req,res) => {
  const db = readDB(); db.product = { ...db.product, ...req.body }; writeDB(db);
  res.json({ success: true, product: db.product });
});
app.put('/api/admin/settings',        auth, (req,res) => {
  const db = readDB(); db.settings = { ...db.settings, ...req.body }; writeDB(db);
  res.json({ success: true, settings: db.settings });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Moringai backend running → http://localhost:${PORT}`);
  console.log(`📦  Admin panel           → http://localhost:${PORT}/admin`);
});
