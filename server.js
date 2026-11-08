require('dotenv').config();
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const cookieParser=require('cookie-parser'),rateLimit=require('express-rate-limit'),multer=require('multer'),{google}=require('googleapis');
const E=process.env,BASE=E.BASE_URL,KEY=Buffer.from(E.ENCRYPTION_KEY||'','hex'),PROD=E.NODE_ENV==='production';
if(KEY.length!==32||!E.JWT_SECRET||!BASE)throw new Error('ENCRYPTION_KEY(64 hex), JWT_SECRET, BASE_URL ज़रूरी हैं');
const UP=E.UPLOAD_DIR||path.join(__dirname,'uploads');fs.mkdirSync(UP,{recursive:true});
const db=new Database(E.DB_FILE||path.join(__dirname,'data.db'));db.pragma('journal_mode=WAL');db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
db.prepare("UPDATE publishing_jobs SET status='FAILED',error='सर्वर बीच में रुका; पहले प्लेटफ़ॉर्म पर जाँचें, फिर दोबारा कोशिश करें' WHERE status='RUNNING'").run();
const enc=t=>{if(!t)return null;const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',KEY,iv),b=Buffer.concat([c.update(t,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64')};
const dec=s=>{if(!s)return null;const b=Buffer.from(s,'base64'),d=crypto.createDecipheriv('aes-256-gcm',KEY,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')};
const audit=(req,uid,action,detail)=>db.prepare('INSERT INTO audit_logs(user_id,action,detail,ip) VALUES(?,?,?,?)').run(uid??null,action,String(detail??'').slice(0,500),req?.ip??null);
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}));app.use(cookieParser());
app.use((q,r,n)=>{r.set('X-Content-Type-Options','nosniff');n()});
app.use('/api',rateLimit({windowMs:6e4,limit:120}));const authLimit=rateLimit({windowMs:9e5,limit:20});
const ck={httpOnly:true,sameSite:'lax',secure:PROD};
const need=(req,res,next)=>{try{req.uid=jwt.verify(req.cookies.sid,E.JWT_SECRET).uid;next()}catch{res.status(401).json({error:'लॉगिन ज़रूरी है'})}};
const login=(res,uid)=>res.cookie('sid',jwt.sign({uid},E.JWT_SECRET,{expiresIn:'7d'}),{...ck,maxAge:7*864e5});
// ---- यूज़र ऑथ ----
app.post('/api/auth/register',authLimit,(req,res)=>{const{email,password}=req.body;
 if(!/^\S+@\S+$/.test(email||'')||String(password||'').length<10)return res.status(400).json({error:'सही ईमेल और 10+ अक्षर का पासवर्ड दें'});
 if(db.prepare('SELECT COUNT(*) c FROM users').get().c&&E.ALLOW_REGISTRATION!=='true')return res.status(403).json({error:'रजिस्ट्रेशन बंद है'});
 if(E.OWNER_EMAIL&&email.toLowerCase()!==E.OWNER_EMAIL.trim().toLowerCase())return res.status(403).json({error:'यह ईमेल रजिस्टर करने की अनुमति नहीं है'});
 try{const r=db.prepare('INSERT INTO users(email,password_hash) VALUES(?,?)').run(email.toLowerCase(),bcrypt.hashSync(password,12));login(res,r.lastInsertRowid);audit(req,r.lastInsertRowid,'register');res.json({ok:true})}catch{res.status(409).json({error:'ईमेल पहले से है'})}});
app.post('/api/auth/login',authLimit,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email||'').toLowerCase());
 if(!u||!bcrypt.compareSync(String(req.body.password||''),u.password_hash)){audit(req,u?.id,'login_fail');return res.status(401).json({error:'गलत ईमेल/पासवर्ड'})}
 login(res,u.id);audit(req,u.id,'login');res.json({ok:true})});
app.post('/api/auth/logout',(q,res)=>res.clearCookie('sid').json({ok:true}));
app.get('/api/me',need,(req,res)=>res.json({accounts:db.prepare('SELECT platform,display_name FROM connected_accounts WHERE user_id=?').all(req.uid)}));
// ---- OAuth सहायक ----
const startState=(res,p)=>{const s=crypto.randomBytes(24).toString('hex');res.cookie('os_'+p,s,{...ck,maxAge:6e5});return s};
const checkState=(req,res,p)=>{const ok=req.query.state&&req.query.state===req.cookies['os_'+p];res.clearCookie('os_'+p);return ok};
const saveAcct=(uid,p,ext,name,at,rt,exp,sc)=>db.prepare(`INSERT INTO connected_accounts(user_id,platform,external_id,display_name,access_token_enc,refresh_token_enc,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(user_id,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token_enc=excluded.access_token_enc,refresh_token_enc=COALESCE(excluded.refresh_token_enc,refresh_token_enc),expires_at=excluded.expires_at,scopes=excluded.scopes`).run(uid,p,ext,name,enc(at),enc(rt),exp,sc);
const done=(p,fn)=>async(q,r)=>{try{if(!checkState(q,r,p))throw new Error('OAuth state मेल नहीं खाया');await fn(q);audit(q,q.uid,'connect_'+p);r.redirect('/?connected='+p)}catch(e){audit(q,q.uid,'connect_fail_'+p,e.message);r.redirect('/?error='+encodeURIComponent(e.message))}};
// ---- YouTube OAuth ----
const yt=()=>new google.auth.OAuth2(E.GOOGLE_CLIENT_ID,E.GOOGLE_CLIENT_SECRET,BASE+'/api/auth/youtube/callback');
app.get('/api/auth/youtube',need,(req,res)=>res.redirect(yt().generateAuthUrl({access_type:'offline',prompt:'consent',scope:['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'],state:startState(res,'youtube')})));
app.get('/api/auth/youtube/callback',need,done('youtube',async req=>{const c=yt(),{tokens}=await c.getToken(String(req.query.code));c.setCredentials(tokens);
 const ch=(await google.youtube({version:'v3',auth:c}).channels.list({part:'snippet',mine:true})).data.items?.[0];if(!ch)throw new Error('इस Google खाते में YouTube चैनल नहीं मिला');
 saveAcct(req.uid,'youtube',ch.id,ch.snippet.title,tokens.access_token,tokens.refresh_token,tokens.expiry_date,tokens.scope)}));
const ytClient=uid=>{const a=db.prepare("SELECT * FROM connected_accounts WHERE user_id=? AND platform='youtube'").get(uid);if(!a)throw new Error('YouTube कनेक्ट नहीं है');
 const c=yt();c.setCredentials({access_token:dec(a.access_token_enc),refresh_token:dec(a.refresh_token_enc),expiry_date:a.expires_at});
 c.on('tokens',t=>db.prepare('UPDATE connected_accounts SET access_token_enc=?,expires_at=? WHERE id=?').run(enc(t.access_token),t.expiry_date,a.id));return c};
// ---- Instagram OAuth (Instagram Login) ----
const IG='https://graph.instagram.com/'+(E.IG_API_VERSION||'v21.0'),IGCB=BASE+'/api/auth/instagram/callback',jf=async(u,o)=>{const j=await(await fetch(u,o)).json();if(j.error||j.error_message)throw new Error(j.error?.message||j.error_message);return j};
app.get('/api/auth/instagram',need,(req,res)=>res.redirect('https://www.instagram.com/oauth/authorize?'+new URLSearchParams({client_id:E.IG_APP_ID,redirect_uri:IGCB,response_type:'code',scope:'instagram_business_basic,instagram_business_content_publish',state:startState(res,'instagram')})));
app.get('/api/auth/instagram/callback',need,done('instagram',async req=>{
 const s=await jf('https://api.instagram.com/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:E.IG_APP_ID,client_secret:E.IG_APP_SECRET,grant_type:'authorization_code',redirect_uri:IGCB,code:String(req.query.code)})});
 const l=await jf('https://graph.instagram.com/access_token?'+new URLSearchParams({grant_type:'ig_exchange_token',client_secret:E.IG_APP_SECRET,access_token:s.access_token}));
 const me=await jf(IG+'/me?fields=user_id,username&access_token='+l.access_token);
 saveAcct(req.uid,'instagram',String(me.user_id||s.user_id),me.username,l.access_token,null,Date.now()+l.expires_in*1e3,'instagram_business_basic,instagram_business_content_publish')}));
const igAcct=async uid=>{const a=db.prepare("SELECT * FROM connected_accounts WHERE user_id=? AND platform='instagram'").get(uid);if(!a)throw new Error('Instagram कनेक्ट नहीं है');
 let t=dec(a.access_token_enc);if(a.expires_at-Date.now()<7*864e5){try{const r=await jf('https://graph.instagram.com/refresh_access_token?'+new URLSearchParams({grant_type:'ig_refresh_token',access_token:t}));
 t=r.access_token;db.prepare('UPDATE connected_accounts SET access_token_enc=?,expires_at=? WHERE id=?').run(enc(t),Date.now()+r.expires_in*1e3,a.id)}catch{}}return{id:a.external_id,t}};
// ---- वीडियो ----
const getVideo=(id,uid)=>{const v=db.prepare('SELECT v.id,v.status,v.created_at,m.title,m.description,m.tags,m.hashtags FROM videos v JOIN video_metadata m ON m.video_id=v.id WHERE v.id=? AND v.user_id=?').get(id,uid);if(!v)return null;
 v.approvals=db.prepare('SELECT a.platform,a.status,a.visibility,a.scheduled_at,j.status job_status,j.error,h.post_url FROM approval_requests a LEFT JOIN publishing_jobs j ON j.video_id=a.video_id AND j.platform=a.platform LEFT JOIN publishing_history h ON h.video_id=a.video_id AND h.platform=a.platform WHERE a.video_id=?').all(v.id);return v};
const up=multer({storage:multer.diskStorage({destination:UP,filename:(q,f,cb)=>cb(null,crypto.randomBytes(16).toString('hex')+'.mp4')}),limits:{fileSize:(+E.MAX_MB||500)*1048576},fileFilter:(q,f,cb)=>cb(null,f.mimetype==='video/mp4')});
app.post('/api/videos',need,up.single('video'),(req,res)=>{if(!req.file)return res.status(400).json({error:'सिर्फ़ MP4 फ़ाइल दें'});const t=String(req.body.title||'').trim();
 if(!t||t.length>100){fs.unlinkSync(req.file.path);return res.status(400).json({error:'शीर्षक 1-100 अक्षर का हो'})}
 const id=db.transaction(()=>{const i=db.prepare('INSERT INTO videos(user_id,file_name,public_token) VALUES(?,?,?)').run(req.uid,req.file.filename,crypto.randomBytes(24).toString('hex')).lastInsertRowid;
  db.prepare('INSERT INTO video_metadata VALUES(?,?,?,?,?)').run(i,t,req.body.description||'',req.body.tags||'',req.body.hashtags||'');
  for(const p of['youtube','instagram'])db.prepare('INSERT INTO approval_requests(video_id,platform) VALUES(?,?)').run(i,p);return i})();
 audit(req,req.uid,'video_upload',id);res.status(201).json(getVideo(id,req.uid))});
app.get('/api/videos',need,(req,res)=>res.json(db.prepare('SELECT id FROM videos WHERE user_id=? ORDER BY id DESC').all(req.uid).map(r=>getVideo(r.id,req.uid))));
app.get('/api/videos/:id',need,(req,res)=>{const v=getVideo(req.params.id,req.uid);v?res.json(v):res.sendStatus(404)});
app.get('/api/videos/:id/stream',need,(req,res)=>{const v=db.prepare('SELECT file_name FROM videos WHERE id=? AND user_id=?').get(req.params.id,req.uid);v?res.sendFile(path.join(UP,v.file_name)):res.sendStatus(404)});
const resetPending=id=>{db.prepare("UPDATE approval_requests SET status='PENDING_APPROVAL',scheduled_at=NULL WHERE video_id=? AND platform NOT IN (SELECT platform FROM publishing_history WHERE video_id=?)").run(id,id);
 db.prepare("DELETE FROM publishing_jobs WHERE video_id=? AND status IN ('QUEUED','FAILED')").run(id)};
app.patch('/api/videos/:id',need,(req,res)=>{const v=getVideo(req.params.id,req.uid);if(!v)return res.sendStatus(404);const{title,description,tags,hashtags}=req.body;
 if(!title||title.length>100)return res.status(400).json({error:'शीर्षक 1-100 अक्षर का हो'});
 db.prepare('UPDATE video_metadata SET title=?,description=?,tags=?,hashtags=? WHERE video_id=?').run(title,description||'',tags||'',hashtags||'',v.id);
 resetPending(v.id);db.prepare("UPDATE videos SET status='PENDING_APPROVAL' WHERE id=?").run(v.id);audit(req,req.uid,'video_edit',v.id);res.json(getVideo(v.id,req.uid))});
app.post('/api/videos/:id/reject',need,(req,res)=>{const v=getVideo(req.params.id,req.uid);if(!v)return res.sendStatus(404);
 db.prepare("UPDATE approval_requests SET status='REJECTED',decided_at=CURRENT_TIMESTAMP WHERE video_id=? AND platform NOT IN (SELECT platform FROM publishing_history WHERE video_id=?)").run(v.id,v.id);
 db.prepare("DELETE FROM publishing_jobs WHERE video_id=? AND status IN ('QUEUED','FAILED')").run(v.id);db.prepare("UPDATE videos SET status='REJECTED' WHERE id=?").run(v.id);audit(req,req.uid,'video_reject',v.id);res.json({ok:true})});
// Instagram को यह URL तभी चलता है जब Instagram के लिए approval मिल चुका हो और पब्लिश जॉब चल रही हो
app.get('/media/:token',(req,res)=>{const v=db.prepare("SELECT v.file_name FROM videos v JOIN approval_requests a ON a.video_id=v.id AND a.platform='instagram' AND a.status='APPROVED' JOIN publishing_jobs j ON j.video_id=v.id AND j.platform='instagram' AND j.status='RUNNING' WHERE v.public_token=?").get(req.params.token);v?res.sendFile(path.join(UP,v.file_name)):res.sendStatus(404)});
// ---- अप्रूवल + पब्लिश ----
app.post('/api/publish/approve',need,(req,res)=>{const{videoId,platform,visibility='private',scheduledAt}=req.body;
 if(!['youtube','instagram'].includes(platform)||!['private','unlisted','public'].includes(visibility))return res.status(400).json({error:'अमान्य प्लेटफ़ॉर्म/visibility'});
 const v=getVideo(videoId,req.uid);if(!v)return res.sendStatus(404);
 if(db.prepare('SELECT 1 FROM publishing_history WHERE video_id=? AND platform=?').get(v.id,platform))return res.status(409).json({error:'यह वीडियो इस प्लेटफ़ॉर्म पर पहले ही प्रकाशित है'});
 if(!db.prepare('SELECT 1 FROM connected_accounts WHERE user_id=? AND platform=?').get(req.uid,platform))return res.status(400).json({error:'पहले अकाउंट कनेक्ट करें'});
 const at=scheduledAt?Date.parse(scheduledAt):Date.now();if(isNaN(at)||(scheduledAt&&at<Date.now()+6e4))return res.status(400).json({error:'शेड्यूल समय भविष्य का हो'});
 db.prepare("UPDATE approval_requests SET status='APPROVED',visibility=?,scheduled_at=?,decided_at=CURRENT_TIMESTAMP WHERE video_id=? AND platform=?").run(visibility,scheduledAt?at:null,v.id,platform);
 db.prepare("INSERT INTO publishing_jobs(video_id,platform,run_at) VALUES(?,?,?) ON CONFLICT(video_id,platform) DO UPDATE SET run_at=excluded.run_at,status='QUEUED',error=NULL WHERE status IN ('FAILED','QUEUED')").run(v.id,platform,at);
 db.prepare("UPDATE videos SET status='APPROVED' WHERE id=?").run(v.id);audit(req,req.uid,'approve_'+platform,v.id);res.json({ok:true,scheduled:!!scheduledAt})});
async function pubYT(v,ap){const tags=v.tags.split(',').map(s=>s.trim()).filter(Boolean);
 const r=await google.youtube({version:'v3',auth:ytClient(v.user_id)}).videos.insert({part:['snippet','status'],requestBody:{snippet:{title:v.title,description:[v.description,v.hashtags].filter(Boolean).join('\n\n'),tags},status:{privacyStatus:ap.visibility,selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(path.join(UP,v.file_name))}});
 if(!r.data.id)throw new Error('YouTube ने video ID नहीं लौटाया');return{id:r.data.id,url:'https://youtu.be/'+r.data.id}}
async function pubIG(v){const{id,t}=await igAcct(v.user_id);
 const c=await jf(`${IG}/${id}/media`,{method:'POST',body:new URLSearchParams({media_type:'REELS',video_url:`${BASE}/media/${v.public_token}`,caption:[v.title,v.description,v.hashtags].filter(Boolean).join('\n\n').slice(0,2200),access_token:t})});
 for(let i=0;;i++){const s=await jf(`${IG}/${c.id}?fields=status_code&access_token=${t}`);if(s.status_code==='FINISHED')break;
  if(['ERROR','EXPIRED'].includes(s.status_code))throw new Error('Instagram मीडिया प्रोसेसिंग फेल: '+s.status_code);if(i>=60)throw new Error('Instagram प्रोसेसिंग टाइमआउट');await new Promise(r=>setTimeout(r,5000))}
 const p=await jf(`${IG}/${id}/media_publish`,{method:'POST',body:new URLSearchParams({creation_id:c.id,access_token:t})});
 const m=await jf(`${IG}/${p.id}?fields=permalink&access_token=${t}`);if(!m.permalink)throw new Error('permalink नहीं मिला');return{id:p.id,url:m.permalink}}
async function runJob(id){if(db.prepare("UPDATE publishing_jobs SET status='RUNNING' WHERE id=? AND status IN ('QUEUED','FAILED')").run(id).changes!==1)return{ok:false,error:'जॉब पहले से चल रही या पूरी है'};
 const j=db.prepare('SELECT * FROM publishing_jobs WHERE id=?').get(id);
 try{const v=db.prepare('SELECT v.id,v.user_id,v.file_name,v.public_token,m.title,m.description,m.tags,m.hashtags FROM videos v JOIN video_metadata m ON m.video_id=v.id WHERE v.id=?').get(j.video_id);
  const ap=db.prepare('SELECT * FROM approval_requests WHERE video_id=? AND platform=?').get(j.video_id,j.platform);if(ap.status!=='APPROVED')throw new Error('approval नहीं है');
  const r=await(j.platform==='youtube'?pubYT:pubIG)(v,ap);
  db.prepare('INSERT INTO publishing_history(video_id,user_id,platform,post_id,post_url) VALUES(?,?,?,?,?)').run(v.id,v.user_id,j.platform,r.id,r.url);
  db.prepare("UPDATE publishing_jobs SET status='DONE' WHERE id=?").run(id);audit(null,v.user_id,'published_'+j.platform,r.url);return{ok:true,...r}}
 catch(e){db.prepare("UPDATE publishing_jobs SET status='FAILED',error=? WHERE id=?").run(String(e.message).slice(0,300),id);audit(null,null,'publish_fail_'+j.platform,e.message);return{ok:false,error:e.message}}}
const pubNow=p=>async(req,res)=>{const id=+req.body.videoId;if(!getVideo(id,req.uid))return res.sendStatus(404);
 const j=db.prepare("SELECT j.id,j.run_at FROM publishing_jobs j JOIN approval_requests a ON a.video_id=j.video_id AND a.platform=j.platform AND a.status='APPROVED' WHERE j.video_id=? AND j.platform=?").get(id,p);
 if(!j)return res.status(403).json({error:'स्पष्ट approval के बिना पब्लिश नहीं होगा'});if(j.run_at>Date.now()+3e4)return res.status(409).json({error:'यह शेड्यूल्ड है'});
 const r=await runJob(j.id);res.status(r.ok?200:502).json(r)};
app.post('/api/publish/youtube',need,pubNow('youtube'));app.post('/api/publish/instagram',need,pubNow('instagram'));
app.get('/api/publish/history',need,(req,res)=>res.json(db.prepare('SELECT h.platform,h.post_id,h.post_url,h.published_at,m.title FROM publishing_history h JOIN video_metadata m ON m.video_id=h.video_id WHERE h.user_id=? ORDER BY h.id DESC LIMIT 200').all(req.uid)));
setInterval(()=>{for(const j of db.prepare("SELECT j.id FROM publishing_jobs j JOIN approval_requests a ON a.video_id=j.video_id AND a.platform=j.platform AND a.status='APPROVED' AND a.scheduled_at IS NOT NULL WHERE j.status='QUEUED' AND j.run_at<=?").all(Date.now()))runJob(j.id)},3e4);
app.get('/healthz',(q,r)=>r.json({ok:true}));
app.use(express.static(path.join(__dirname,'public')));
app.use((e,req,res,next)=>{audit(req,req.uid,'error',e.message);res.status(e instanceof multer.MulterError?400:500).json({error:e instanceof multer.MulterError?'अपलोड त्रुटि: '+e.message:'सर्वर त्रुटि'})});
app.listen(E.PORT||3000,()=>console.log('Creator Studio चालू: '+BASE));
