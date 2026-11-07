// `npm run setup` — .env बनाता है और मज़बूत secret अपने-आप भर देता है।
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..'),env=path.join(root,'.env');
if(fs.existsSync(env)){console.log('.env पहले से मौजूद है — कुछ नहीं बदला।');process.exit(0)}
let t=fs.readFileSync(path.join(root,'.env.example'),'utf8');
t=t.replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+crypto.randomBytes(32).toString('hex'))
   .replace(/^ENCRYPTION_KEY=.*$/m,'ENCRYPTION_KEY='+crypto.randomBytes(32).toString('hex'));
fs.writeFileSync(env,t,{mode:0o600});
console.log('✅ .env बन गई। अब उसमें BASE_URL, OWNER_EMAIL, Google/Instagram कीज़ भरें।');
console.log('⚠️  ENCRYPTION_KEY को सुरक्षित बैकअप में रखें; खो गई तो जुड़े अकाउंट दोबारा कनेक्ट करने होंगे।');
