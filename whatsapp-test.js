// Test your WhatsApp setup without placing a real order
// Run: node whatsapp-test.js
require('dotenv').config();
const https = require('https');
const SID = process.env.TWILIO_SID;
const TOK = process.env.TWILIO_TOKEN;
const FROM = process.env.TWILIO_WA_FROM;
const TO = process.env.OWNER_WHATSAPP;
if (!SID || SID.startsWith('ACxx')) { console.error('Fill in your Twilio credentials in .env first.'); process.exit(1); }
const body = new URLSearchParams({ From: FROM, To: TO, Body: '🧪 Moringai WhatsApp test — notifications are working! 🎉' }).toString();
const auth = Buffer.from(`${SID}:${TOK}`).toString('base64');
const opts = { hostname:'api.twilio.com', path:`/2010-04-01/Accounts/${SID}/Messages.json`, method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+auth,'Content-Length':Buffer.byteLength(body)} };
const req = https.request(opts, res=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ const p=JSON.parse(d); if(p.sid) console.log('✅ Test sent! SID:',p.sid); else console.error('❌',p.message); }); });
req.on('error',e=>console.error('❌',e.message));
req.write(body); req.end();
