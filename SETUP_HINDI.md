# मोबाइल सेटअप गाइड (हिंदी)

यह ऐप एक Node.js सर्वर है, इसलिए इसे किसी HTTPS वाले सर्वर पर चलाना होगा। फिर आप अपने फ़ोन के ब्राउज़र से खोलेंगे और "Add to Home screen" कर लेंगे।

## चरण 1 — होस्टिंग चुनें
- **आसान:** Docker/Node चलाने वाली कोई होस्टिंग (Render, Railway, Fly.io या छोटा VPS)। Dockerfile शामिल है।
- ज़रूरी: `uploads/` और `data.db` के लिए **persistent disk/volume**, और **सिर्फ़ एक** instance।
- प्लान और कीमत आप होस्टिंग की साइट पर खुद जांच लें।

## चरण 2 — secret बनाएं
```bash
npm install
npm run setup
```
यह `.env` बनाता है और `JWT_SECRET` / `ENCRYPTION_KEY` अपने-आप भर देता है।

## चरण 3 — `.env` भरें
- `BASE_URL` = आपका HTTPS पता
- `OWNER_EMAIL` = आपका ईमेल (ताकि पहला रजिस्ट्रेशन कोई और न कर सके)
- Google और Instagram की कीज़ (चरण 5 और 6)

## चरण 4 — चलाएं और जांचें
```bash
npm run check
npm start
```
ब्राउज़र में `BASE_URL/healthz` खोलें; `{"ok":true}` दिखना चाहिए। फिर `BASE_URL` खोलकर रजिस्टर करें और `.env` में `ALLOW_REGISTRATION=false` रखें।

## चरण 5 — YouTube
Google Cloud में YouTube Data API v3 चालू करें, Web OAuth Client बनाएं, Redirect URI: `BASE_URL/api/auth/youtube/callback`

## चरण 6 — Instagram
Professional (Creator/Business) अकाउंट चाहिए। Meta App में Instagram Login चालू करें, Redirect URI: `BASE_URL/api/auth/instagram/callback`

## चरण 7 — फ़ोन पर
Chrome में पता खोलें → ⋮ मेनू → "Add to Home screen"।

## सुरक्षा नियम (कोड में लागू)
- हर वीडियो `PENDING_APPROVAL` से शुरू होता है।
- "Approve & Publish" दबाने और पुष्टि-बॉक्स में हाँ कहने के बाद ही पब्लिश होता है।
- शेड्यूलर सिर्फ़ वही वीडियो चलाता है जिन्हें आपने भविष्य के समय के लिए मंज़ूर किया हो।
- पहले YouTube पर Private से टेस्ट करें।
