# Future Tech Hindi — Approval-based Social Publishing

यह ZIP एक deployable Node.js backend और साधारण web dashboard starter है। Claude Artifact से अलग इसे HTTPS वाले Node hosting पर चलाना होगा। Claude Artifact इस backend को `BASE_URL` के जरिए call कर सकता है; Artifact को backend/server के रूप में इस्तेमाल नहीं किया जा सकता।

## इस starter में क्या है
- Email/password login
- MP4 upload और video preview
- YouTube OAuth connection और YouTube Data API upload
- Instagram Professional account OAuth connection और Reels publishing flow
- Platform-wise approval, immediate publishing और scheduled queue
- Publishing history
- SQLite database और encrypted OAuth token storage

## अभी क्या शामिल नहीं है
- AI से script/video/voiceover generation नहीं है। यह ऐप तैयार MP4 लेता है और publish workflow चलाता है।
- वास्तविक API publishing तब तक नहीं चलेगी जब तक Google/Meta credentials, account authorization, HTTPS deployment और आवश्यक app review/configuration पूरी न हो।
- यह production security audit का विकल्प नहीं है; public launch से पहले security review करें।

## Local setup
Node.js 18+ चाहिए। SQLite native dependency build support भी चाहिए।

```bash
npm install
cp .env.example .env
```

`.env` में कम-से-कम ये भरें:
- `BASE_URL`: आपका सार्वजनिक HTTPS domain
- `JWT_SECRET`: `openssl rand -hex 32` से बनाया मजबूत secret
- `ENCRYPTION_KEY`: `openssl rand -hex 32` से बनाया 64-character hex key
- Google और Meta OAuth credentials

फिर:

```bash
npm run check
npm start
```

पहले user को register करें। उसके बाद `.env` में `ALLOW_REGISTRATION=false` रखें। `uploads/` और `data.db` को persistent storage पर रखें। एक ही server instance चलाएं; यह starter SQLite और in-process scheduler उपयोग करता है।

## YouTube setup
1. Google Cloud project बनाएं और YouTube Data API v3 enable करें।
2. OAuth consent screen और Web OAuth Client configure करें।
3. Authorized redirect URI: `https://YOUR_DOMAIN/api/auth/youtube/callback`
4. `.env` में `GOOGLE_CLIENT_ID` और `GOOGLE_CLIENT_SECRET` रखें।
5. YouTube OAuth scopes इस ऐप में `youtube.upload` और `youtube.readonly` हैं।

YouTube upload endpoint `videos.insert` उपयोग करता है। API quota और project audit/restrictions Google Cloud Console में जांचें। नए/un-audited projects पर public visibility प्रतिबंध लागू हो सकते हैं।

## Instagram setup
1. Meta Developer App बनाएं और Instagram Login publishing product/permissions configure करें।
2. Instagram account Professional (Creator या Business) होना चाहिए।
3. Redirect URI: `https://YOUR_DOMAIN/api/auth/instagram/callback`
4. `.env` में `IG_APP_ID` और `IG_APP_SECRET` रखें।
5. अपने tester account पर Development mode में परीक्षण करें। अन्य accounts के लिए आवश्यक App Review/Advanced Access और business verification पूरा करें।

Instagram publishing को सार्वजनिक HTTPS video URL चाहिए। इस ऐप का `/media/:token` endpoint केवल Instagram approval के बाद वीडियो उपलब्ध कराता है। Meta की current docs के अनुसार API version, permissions और media constraints को deploy करने से पहले Meta Developer dashboard/docs में verify करें; पुराने hard-coded API version को current supported version से update करना पड़ सकता है।

## Claude Artifact से जोड़ना
Artifact में API requests को आपके deployed backend के HTTPS base URL पर भेजें। Backend पर CORS/allowed origins और authentication को आपके वास्तविक Artifact hosting origin के अनुरूप configure करें। Cookie-based login cross-site Artifact embedding में काम न भी करे; बेहतर production integration के लिए same-site hosted frontend या short-lived bearer session design और CSRF protections का security review करें। कभी भी Google/Meta client secret Artifact/frontend में न रखें।

## Approval flow
1. Dashboard में MP4 upload करें।
2. Title/description/tags जांचें।
3. चुने हुए platform के लिए `Approve & Publish` करें।
4. Immediate publish या future schedule चुनें।
5. History में वास्तविक platform response और post URL देखें।

पहले private/unlisted YouTube test करें। Instagram के लिए अपने authorized test Professional account पर परीक्षण करें।
