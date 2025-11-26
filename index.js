require('dotenv').config();
const { Pool } = require('pg');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Command usage tracking
class CommandManager {
  constructor(userId) {
    this.userId = userId;
    this.freeLimit = 5;
  }

  async canUseCommand(commandName) {
    const result = await pool.query(
      'SELECT usage_count FROM command_usage WHERE user_id = $1 AND command_name = $1',
      [this.userId, commandName]
    );

    if (result.rows.length === 0) {
      await pool.query(
        'INSERT INTO command_usage (user_id, command_name, usage_count) VALUES ($1, $2, $3)',
        [this.userId, commandName, 1]
      );
      return true;
    }

    const usage = result.rows[0].usage_count;
    if (usage >= this.freeLimit) {
      return false;
    }

    await pool.query(
      'UPDATE command_usage SET usage_count = $1 WHERE user_id = $2 AND command_name = $3',
      [usage + 1, this.userId, commandName]
    );

    return true;
  }

  async getRemainingCommands(commandName) {
    const result = await pool.query(
      'SELECT usage_count FROM command_usage WHERE user_id = $1 AND command_name = $1',
      [this.userId, commandName]
    );

    if (result.rows.length === 0) {
      return this.freeLimit;
    }

    return this.freeLimit - result.rows[0].usage_count;
  }
}

// Initialize bot
async function startBot() {
  const sessionData = process.env.BASE64_SESSION;
  const phone = process.env.PHONE_NUMBER;

  if (!sessionData) {
    console.log('❌ No session data found');
    return;
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const message = messages[0];
      if (!message.message || message.key.fromMe) return;

      const jid = message.key.remoteJid;
      const text = message.message.conversation || '';

      if (text.startsWith('!')) {
        const command = text.split(' ')[0].substring(1);
        const userManager = new CommandManager(phone);

        if (!(await userManager.canUseCommand(command))) {
          const remaining = await userManager.getRemainingCommands(command);
          await sock.sendMessage(jid, {
            text: `❌ Free trial limit reached!\n\nYou've used all ${process.env.FREE_COMMAND_LIMIT} free uses of !${command}.\n\n💎 Upgrade to premium at: https://9bot.com.br\n\nRemaining free commands: ${remaining}`
          });
          return;
        }

        // Handle command here
        await handleCommand(sock, message, command, userManager);
      }
    });

    console.log('✅ 9Bot Free instance started');
  } catch (error) {
    console.error('Bot startup error:', error);
  }
}

async function handleCommand(sock, message, command, userManager) {
  const jid = message.key.remoteJid;
  
  switch (command) {
    case 'menu':
      const remaining = await userManager.getRemainingCommands('menu');
      await sock.sendMessage(jid, {
        text: `🤖 9Bot Menu (Free Tier)\n\nAvailable commands:\n!menu - Show this menu\n!info - Bot information\n\n📊 Free usage: ${remaining}/${process.env.FREE_COMMAND_LIMIT} commands left\n\n💎 Upgrade: https://9bot.com.br`
      });
      break;
    
    case 'info':
      await sock.sendMessage(jid, {
        text: `ℹ️ 9Bot Information\n\nTier: FREE\nCommands Limit: ${process.env.FREE_COMMAND_LIMIT} per command\n\nVisit https://9bot.com.br to upgrade!`
      });
      break;
    
    default:
      await sock.sendMessage(jid, {
        text: `❌ Unknown command: !${command}\n\nType !menu for available commands.`
      });
  }
}

startBot();