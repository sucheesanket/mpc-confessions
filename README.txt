MPC PARTY NIGHT — REFACTORED PROJECT

Folder structure
- server.js             Node.js HTTP server and API
- public/index.html     Page markup
- public/css/styles.css Original CSS, moved without visual redesign
- public/js/app.js      Original frontend JavaScript
- data.json             Empty local database (user data is not included)
- package.json          Start command and Node version

Run locally
1. Install Node.js 16 or newer (LTS recommended).
2. Open a terminal in this folder.
3. Run: npm start  (or: node server.js)
4. Visit http://localhost:3000

Configuration
- COLLEGE_CODE: student signup code (default: MPC2026)
- ADMIN_KEY: admin access key. Set a strong, unique value before hosting.
- PORT: optional server port (default: 3000)

Admin endpoints
- /admin/reports?key=YOUR_ADMIN_KEY
- /admin/remove?key=YOUR_ADMIN_KEY&id=USERID

Important before hosting publicly
- Set COLLEGE_CODE and ADMIN_KEY as environment variables. Never use the default admin key on a public deployment.
- This app stores photos, profile data, password hashes, sessions, messages and reports in data.json. Use persistent storage and HTTPS, restrict admin access, and establish clear consent, moderation, and deletion procedures before inviting real students.
- The built-in JSON-file database is intended for a small demo; it is not a robust multi-instance production database.
- data.json has been reset so the test account/photo from the supplied files is not carried over.

Design note
The existing HTML markup, CSS rules, and frontend JavaScript were moved into separate files. No intentional visual redesign was made.
