require('dotenv').config();
const express = require('express');
const pino = require('pino');
const { 
    default: makeWASocket, 
    fetchLatestWaWebVersion, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        bot: '9Bot Instance',
        deployed: true 
    });
});

app.listen(PORT, () => {
    console.log(`🚀 9Bot instance running on port ${PORT}`);
});

// Session import function
function importBase64Session(sessionName, base64Session) {
    const fs = require('fs');
    const path = require('path');
    
    try {
        const sessionDir = path.join(__dirname, 'sessions', sessionName);
        
        // Create session directory
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        // Decode base64 session
        const sessionData = JSON.parse(Buffer.from(base64Session, 'base64').toString());
        
        // Write creds.json
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), JSON.stringify(sessionData, null, 2));
        
        console.log('✅ Session imported from environment');
        return true;
    } catch (error) {
        console.error('❌ Session import failed:', error.message);
        return false;
    }
}

// Command handler
const commands = {
    test: {
        handler: async (client, message) => {
            const jid = message.key.remoteJid;
            await client.sendMessage(jid, { 
                text: `✅ 9Bot is working!\n\nThis is your personal bot instance.\n\nTry !menu for more commands.` 
            }, { quoted: message });
        }
    },
    
    menu: {
        handler: async (client, message) => {
            const jid = message.key.remoteJid;
            const menuText = `
*🤖 9BOT COMMANDS*

!test - Test if bot is working
!menu - Show this menu
!info - Bot information

*🎯 FREE TIER*
• 5 uses per command
• Reset daily

💎 Upgrade: https://9bot.com.br

🤖 Powered by 9Bot`;

            await client.sendMessage(jid, { text: menuText }, { quoted: message });
        }
    },
    
    info: {
        handler: async (client, message) => {
            const jid = message.key.remoteJid;
            await client.sendMessage(jid, { 
                text: `*🤖 9BOT INFORMATION*\n\n• Tier: FREE\n• Commands: 5 uses each\n• Status: Active\n\n💎 Upgrade for unlimited commands at:\nhttps://9bot.com.br` 
            }, { quoted: message });
        }
    }
};

// Track command usage (simple in-memory for free tier)
const commandUsage = new Map();
const FREE_LIMIT = 5;

function canUseCommand(userJid, command) {
    const key = `${userJid}-${command}`;
    const today = new Date().toDateString();
    const usageKey = `${key}-${today}`;
    
    const usage = commandUsage.get(usageKey) || 0;
    
    if (usage >= FREE_LIMIT) {
        return { canUse: false, remaining: 0 };
    }
    
    commandUsage.set(usageKey, usage + 1);
    return { canUse: true, remaining: FREE_LIMIT - (usage + 1) };
}

// Initialize bot
let isBotRunning = false;

(async () => {
    if (isBotRunning) return;
    isBotRunning = true;

    const logger = pino({ level: 'silent' });
    const SESSION_NAME = '9bot-session';
    const BASE64_SESSION = process.env.BASE64_SESSION;

    console.log('🚀 Starting 9Bot Instance...');
    console.log('📦 Using template: https://github.com/xhclintohn/9bot-template');

    // Import session from environment
    if (BASE64_SESSION) {
        console.log('📥 Importing session...');
        importBase64Session(SESSION_NAME, BASE64_SESSION);
    } else {
        console.log('❌ No session found in environment');
        return;
    }

    let client;

    async function initializeBot() {
        try {
            const { version } = await fetchLatestWaWebVersion();
            const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${SESSION_NAME}`);

            client = makeWASocket({
                printQRInTerminal: false, // No QR needed - we use session
                syncFullHistory: false,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                version,
                logger,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                }
            });

            client.ev.on('creds.update', saveCreds);

            client.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'close') {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                    console.log(`🔌 Connection closed, reconnecting: ${shouldReconnect}`);

                    if (shouldReconnect) {
                        setTimeout(initializeBot, 5000);
                    }
                } else if (connection === 'open') {
                    console.log('✅ WhatsApp connected successfully!');
                    
                    // Send welcome message to user
                    setTimeout(async () => {
                        try {
                            await client.sendMessage(client.user.id, {
                                text: `🎉 Your 9Bot is ready!\n\nSend !menu to see all commands.\n\n🤖 Free tier: 5 uses per command\n💎 Upgrade: https://9bot.com.br`
                            });
                        } catch (error) {
                            console.log('Welcome message sent');
                        }
                    }, 2000);
                }
            });

            client.ev.on('messages.upsert', async (m) => {
                const message = m.messages[0];

                if (!message.message || message.key.fromMe) return;

                const jid = message.key.remoteJid;
                const text = (message.message?.conversation || '').trim();

                if (!text || !text.startsWith('!')) return;

                const command = text.substring(1).toLowerCase().split(' ')[0];
                
                if (commands[command]) {
                    console.log(`⚡ Command: !${command} from ${jid}`);
                    
                    // Check usage limits
                    const usageCheck = canUseCommand(jid, command);
                    
                    if (!usageCheck.canUse) {
                        await client.sendMessage(jid, {
                            text: `❌ Free limit reached!\n\nYou've used all 5 free uses of !${command} today.\n\n💎 Upgrade for unlimited commands:\nhttps://9bot.com.br\n\n🕒 Limits reset daily.`
                        }, { quoted: message });
                        return;
                    }

                    // Execute command
                    try {
                        await commands[command].handler(client, message);
                    } catch (error) {
                        console.error(`Command error:`, error);
                        await client.sendMessage(jid, {
                            text: `❌ Error: ${error.message}`
                        }, { quoted: message });
                    }
                }
            });

        } catch (error) {
            console.error('❌ Bot init error:', error);
            setTimeout(initializeBot, 10000);
        }
    }

    await initializeBot();
})();