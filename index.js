// In 9bot-template/index.js
require('dotenv').config();
const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason 
} = require('@whiskeysockets/baileys');

// Import session from environment
const BASE64_SESSION = process.env.BASE64_SESSION;
const PHONE_NUMBER = process.env.PHONE_NUMBER;

// Function to import session
function importSession() {
    const fs = require('fs');
    const path = require('path');
    
    try {
        const sessionDir = path.join(__dirname, 'sessions', 'bot-session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        const sessionData = JSON.parse(Buffer.from(BASE64_SESSION, 'base64').toString());
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), JSON.stringify(sessionData, null, 2));
        
        console.log('✅ Session imported successfully');
        return true;
    } catch (error) {
        console.error('❌ Session import failed:', error);
        return false;
    }
}

// Start bot
(async () => {
    if (BASE64_SESSION) {
        importSession();
    }
    
    // Your bot code here...
    console.log('🚀 9Bot instance starting...');
})();