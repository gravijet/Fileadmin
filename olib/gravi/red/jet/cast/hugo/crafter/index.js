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
let isShuttingDown = false; // Flag um doppelte Shutdowns zu verhindern

// Einstellungen aus Umgebungsvariablen
const JUMP_INTERVAL = (parseInt(process.env.JUMP_INTERVAL) || 60) * 1000;
const ENABLE_JUMP = (process.env.ENABLE_JUMP || '1') === '1'; // 0 = aus, 1 = ein (Standard)
const SERVER_IP = process.env.IP || 'gravijet.net:25565';
const VERSION = process.env.VERSION || '1.21.8';
const CHAT_COLOR = (process.env.CHAT_COLOR || '1') === '1'; // 0 = aus, 1 = ein (Standard)

console.log(`[Config] Server: ${SERVER_IP}`);
console.log(`[Config] Version: ${VERSION}`);
console.log(`[Config] Jump enabled: ${ENABLE_JUMP}, Jump interval: ${JUMP_INTERVAL/1000}s`);
console.log(`[Config] Chat color enabled: ${CHAT_COLOR}`);

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
            hideErrors: true
        });

        let hasShownLoginMessage = false;

        bot.on('login', () => {
            if (!hasShownLoginMessage) {
                console.log(`[Bot] Connected to ${SERVER_IP} with ${VERSION} as ${bot.username}.`);
                hasShownLoginMessage = true;
            }
        });

        bot.on('spawn', () => {
            if (!hasShownLoginMessage) {
                console.log(`[Bot] Connected to ${SERVER_IP} with ${VERSION} as ${bot.username}.`);
                hasShownLoginMessage = true;
            }

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

        // Chat-Handler mit Farboption
        bot.on('message', (message) => {
            try {
                let displayText;
                
                if (CHAT_COLOR) {
                    // Versuche mit toAnsi() für Farben
                    try {
                        if (typeof message.toAnsi === 'function') {
                            displayText = message.toAnsi();
                        } else {
                            // Fallback: toString() mit Farbcodes (wenn sie bereits als ANSI konvertiert sind)
                            displayText = message.toString();
                        }
                    } catch (ansiError) {
                        // Falls toAnsi() fehlschlägt, ohne Farben
                        displayText = message.toString().replace(/§[0-9a-fk-or]/g, '');
                    }
                } else {
                    // Ohne Farbcodes
                    displayText = message.toString().replace(/§[0-9a-fk-or]/g, '');
                }
                
                const cleanText = displayText.trim();
                if (cleanText && cleanText !== '') {
                    console.log(`[System] ${cleanText}`);
                }
            } catch (error) {
                // Fallback: Ohne Farbcodes
                try {
                    const text = message.toString().replace(/§[0-9a-fk-or]/g, '').trim();
                    if (text && text !== '') {
                        console.log(`[System] ${text}`);
                    }
                } catch (e) {
                    // Ignoriere Fehler
                }
            }
        });

        // Chat aus Konsole senden MIT FILTER und Shutdown-Kommando
        process.stdin.on('data', (data) => {
            const msg = data.toString().trim();

            if (msg === '\\stopafkclient') {
                if (!isShuttingDown) {
                    shutdown();
                }
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

        // Korrigierter Death-Handler (ohne removeAllListeners)
        bot.on('death', () => {
            console.log('[Bot] Died, respawning in 1 second...');
            setTimeout(() => {
                if (bot && bot._client && bot._client.ended === false) {
                    try {
                        // Einfaches Respawn ohne removeAllListeners
                        bot.respawn();
                        console.log('[Bot] Respawned');
                    } catch (e) {
                        console.log('[Error] Failed to respawn:', e.message);
                        // Bei Fehler neu verbinden
                        setTimeout(createBot, 5000);
                    }
                }
            }, 1000);
        });

        // Fehlerbehandlung & Reconnect
        bot.on('kicked', (reason) => {
            console.log(`[Kicked] ${reason}`);
            setTimeout(createBot, 10000);
        });

        bot.on('error', (err) => {
            // Ignoriere Profil-Daten-Fehler (spammt sonst)
            if (err.message.includes('Failed to obtain profile data') || 
                err.message.includes('does the account own minecraft')) {
                console.log('[Error] Authentication issue, reconnecting in 30s...');
                setTimeout(createBot, 30000);
            } else {
                console.log(`[Error] ${err.message}`);
                setTimeout(createBot, 10000);
            }
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

// Shutdown & Exit-Handler 
function shutdown() {
    if (isShuttingDown) return; // Verhindere mehrfache Ausführung
    
    isShuttingDown = true;
    console.log('[Info] Shutting down...');
    
    if (jumpInterval) {
        clearInterval(jumpInterval);
        jumpInterval = null;
    }
    
    if (bot) {
        try { 
            bot.quit('Shutting down'); 
        } catch (e) {}
        bot = null;
    }
    
    // stdin blockiert Node manchmal: Listener & Input beenden
    process.stdin.removeAllListeners('data');
    try { 
        process.stdin.pause(); 
    } catch (e) {}
    
    try { 
        process.stdin.destroy && process.stdin.destroy(); 
    } catch (e) {}
    
    // Sofort beenden ohne Verzögerung
    process.exit(0);
}

if (typeof process.stdin.setRawMode === 'function') {
    try { 
        process.stdin.setRawMode(true); 
    } catch { }
}
process.stdin.resume();

createBot();