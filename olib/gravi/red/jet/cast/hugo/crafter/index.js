const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');

const AUTH_CACHE_DIR = path.join(__dirname, '.auth_cache');
if (!fs.existsSync(AUTH_CACHE_DIR)) {
    fs.mkdirSync(AUTH_CACHE_DIR, { recursive: true });
}

let bot = null;
let reconnectTimeout = null;
let jumpInterval = null;

// Einstellungen aus Umgebungsvariablen
const JUMP_INTERVAL = (parseInt(process.env.JUMP_INTERVAL) || 60) * 1000;
const ENABLE_JUMP = (process.env.ENABLE_JUMP || 'false').toLowerCase() === 'true';
const SERVER_IP = process.env.IP || 'gravijet.net:25565';
const VERSION = process.env.VERSION || '1.21.8';

console.log(`[Config] Server: ${SERVER_IP}`);
console.log(`[Config] Version: ${VERSION}`);
console.log(`[Config] Jump enabled: ${ENABLE_JUMP}, Jump interval: ${JUMP_INTERVAL/1000}s`);

const FORBIDDEN_CHARS = ['$'];
function isMessageSafe(message) {
    if (!message || typeof message !== 'string') return false;
    for (const char of FORBIDDEN_CHARS) {
        if (message.includes(char)) {
            console.log(`[Blocked] Message contains forbidden character: ${char}`);
            return false;
        }
    }
    if (message.length > 256) {
        console.log('[Blocked] Message too long');
        return false;
    }
    if (message.trim().length === 0) {
        return false;
    }
    return true;
}

function cleanText(text) {
    if (!text) return '';
    return text.toString()
        .replace(/§[0-9a-fk-or]/g, '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function createBot() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    if (jumpInterval) {
        clearInterval(jumpInterval);
        jumpInterval = null;
    }

    const [host, port] = SERVER_IP.includes(':') ? SERVER_IP.split(':') : [SERVER_IP, '25565'];

    console.log(`[Bot] Connecting to ${host}:${port} with version ${VERSION}...`);

    try {
        // Standard-Plugins laden und digging-Plugin entfernen (verursacht den Fehler)
        const defaultPlugins = require('mineflayer/lib/plugins');
        const customPlugins = { ...defaultPlugins };
        delete customPlugins.digging; // Digging-Plugin entfernen

        bot = mineflayer.createBot({
            host: host,
            port: parseInt(port),
            version: VERSION,
            auth: 'microsoft',
            profilesFolder: AUTH_CACHE_DIR,
            viewDistance: 'tiny',
            chatLengthLimit: 256,
            colorsEnabled: false,
            skipValidation: true,
            hideErrors: true,
            plugins: customPlugins // Custom plugins ohne digging
        });

        bot.on('login', () => {
            console.log(`[Bot] Connected as ${bot.username}.`);
        });

        bot.on('spawn', () => {
            console.log('[Success] Bot spawned.');
            if (ENABLE_JUMP) {
                jumpInterval = setInterval(() => {
                    if (bot && bot.entity) {
                        bot.setControlState('jump', true);
                        setTimeout(() => {
                            if (bot) bot.setControlState('jump', false);
                        }, 500);
                        console.log('[Anti-AFK] Jumped');
                    }
                }, JUMP_INTERVAL);
                console.log(`[Anti-AFK] Jumping enabled with ${JUMP_INTERVAL/1000}s interval.`);
            } else {
                console.log('[Anti-AFK] Jumping disabled');
            }
        });

        // Automatischer Respawn
        bot.on('death', () => {
            console.log('[Bot] Died, respawning in 1 second...');
            setTimeout(() => {
                if (bot && bot._client && bot._client.ended === false) {
                    try {
                        // Versuche verschiedene Respawn-Methoden
                        if (bot.respawn) {
                            bot.respawn();
                            console.log('[Bot] Respawned using bot.respawn()');
                        } else if (bot._client.write) {
                            // Direkter Respawn über Protocol
                            bot._client.write('client_command', { actionId: 0 });
                            console.log('[Bot] Respawned using client_command');
                        }
                    } catch (e) {
                        console.log('[Error] Failed to respawn:', e.message);
                    }
                }
            }, 1000);
        });

        // Chat Listener (mit Spielernamen)
        bot.on('message', (jsonMsg) => {
            try {
                const json = jsonMsg.json || jsonMsg;
                if (json.translate === 'chat.type.text' && json.with && json.with.length >= 2) {
                    const playerName = extractTextFromExtra([json.with[0]]);
                    const messageText = extractTextFromExtra([json.with[1]]);
                    console.log(`[${playerName}] ${messageText}`);
                } else {
                    const message = jsonMsg.toString().replace(/§[0-9a-fk-or]/g, '').trim();
                    if (message) console.log(`[System] ${message}`);
                }
            } catch (e) { }
        });

        // Chat aus Konsole senden MIT FILTER und Shutdown-Kommando
        process.stdin.on('data', (data) => {
            const msg = data.toString().trim();

            if (msg === '\\stopafkclient') {
                shutdown();
                return;
            }

            if (!isMessageSafe(msg)) {
                console.log('[Blocked] Message not sent - contains forbidden characters or is invalid');
                return;
            }

            if (msg && bot && bot.chat) {
                try {
                    bot.chat(msg);
                    console.log(`[You] ${msg}`);
                } catch (error) {
                    console.log('[Error] Could not send message:', error.message);
                }
            }
        });

        // Fehlerbehandlung & Reconnect
        bot.on('kicked', (reason) => {
            console.log(`[Kicked] ${reason}`);
            setTimeout(createBot, 10000);
        });

        bot.on('error', (err) => {
            console.log(`[Error] ${err.message}`);
            setTimeout(createBot, 10000);
        });

        bot.on('end', () => {
            console.log('[Info] Disconnected, reconnecting in 10s...');
            setTimeout(createBot, 10000);
        });

    } catch (error) {
        console.log(`[Error] Failed to create bot: ${error.message}`);
        setTimeout(createBot, 10000);
    }
}

function extractTextFromExtra(extraArray) {
    let text = '';
    if (Array.isArray(extraArray)) {
        extraArray.forEach(item => {
            if (typeof item === 'string') {
                text += item;
            } else if (item && item.text) {
                text += item.text;
            } else if (item && item.extra) {
                text += extractTextFromExtra(item.extra);
            }
        });
    }
    return text;
}

// Shutdown & Exit-Handler 
function shutdown() {
    console.log('[Info] Shutting down...');
    if (jumpInterval) clearInterval(jumpInterval);
    if (bot) {
        try { bot.quit('Shutting down'); } catch (e) {}
        try { bot.removeAllListeners(); } catch (e) {}
        bot = null;
    }
    // stdin blockiert Node manchmal: Listener & Input beenden
    process.stdin.removeAllListeners('data');
    try { process.stdin.pause(); } catch (e) {}
    try { process.stdin.destroy && process.stdin.destroy(); } catch (e) {}
    setTimeout(() => {
        process.exit(0);
    }, 300); // gibt Mineflayer etwas Zeit zum Disconnect
}

// SIGINT und SIGTERM für Heroku/Docker/PM2
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Node lässt stdin manchmal "offen laufen", workaround für interaktive Terminals
if (typeof process.stdin.setRawMode === 'function') {
    try { process.stdin.setRawMode(true); } catch { }
}
process.stdin.resume();

createBot();