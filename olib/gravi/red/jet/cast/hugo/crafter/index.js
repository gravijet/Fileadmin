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
let isShuttingDown = false;
let stdinListenerAdded = false;

const JUMP_INTERVAL = (parseInt(process.env.JUMP_INTERVAL) || 60) * 1000;
const ENABLE_JUMP = (process.env.ENABLE_JUMP || '1') === '1';
const SERVER_IP = process.env.IP || 'gravijet.net:25565';
const VERSION = process.env.VERSION || '1.21.8';
const CHAT_COLOR = (process.env.CHAT_COLOR || '1') === '1';

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

// Setup stdin listener ONCE, outside of createBot
function setupStdinListener() {
    if (stdinListenerAdded) return;
    
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
    
    stdinListenerAdded = true;
    console.log('[Info] Input listener initialized');
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

        bot.on('message', (message) => {
            try {
                let displayText;
                
                if (CHAT_COLOR) {
                    try {
                        if (typeof message.toAnsi === 'function') {
                            displayText = message.toAnsi();
                        } else {
                            displayText = message.toString();
                        }
                    } catch (ansiError) {
                        displayText = message.toString().replace(/§[0-9a-fk-or]/g, '');
                    }
                } else {
                    displayText = message.toString().replace(/§[0-9a-fk-or]/g, '');
                }
                
                const cleanText = displayText.trim();
                if (cleanText && cleanText !== '') {
                    console.log(`[System] ${cleanText}`);
                }
            } catch (error) {
                try {
                    const text = message.toString().replace(/§[0-9a-fk-or]/g, '').trim();
                    if (text && text !== '') {
                        console.log(`[System] ${text}`);
                    }
                } catch (e) {}
            }
        });

        bot.on('death', () => {
            console.log('[Bot] Died, respawning...');
            setTimeout(() => {
                try {
                    if (bot && bot._client && !bot._client.ended) {
                        bot.respawn();
                        console.log('[Bot] Respawned successfully');
                    } else {
                        console.log('[Bot] Cannot respawn - connection lost, reconnecting...');
                        createBot();
                    }
                } catch (e) {
                    console.log('[Error] Failed to respawn:', e.message);
                    console.log('[Bot] Reconnecting...');
                    setTimeout(createBot, 3000);
                }
            }, 1000);
        });

        bot.on('kicked', (reason) => {
            console.log(`[Kicked] ${reason}`);
            if (!isShuttingDown) {
                setTimeout(createBot, 10000);
            }
        });

        bot.on('error', (err) => {
            if (isShuttingDown) return;
            
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
            if (isShuttingDown) return;
            console.log('[Info] Disconnected, reconnecting in 10s...');
            setTimeout(createBot, 10000);
        });

    } catch (error) {
        console.log(`[Error] Failed to create bot: ${error.message}`);
        if (!isShuttingDown) {
            setTimeout(createBot, 10000);
        }
    }
}

function shutdown() {
    if (isShuttingDown) return; 
    
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
    
    process.stdin.removeAllListeners('data');
    try { 
        process.stdin.pause(); 
    } catch (e) {}
    
    try { 
        process.stdin.destroy && process.stdin.destroy(); 
    } catch (e) {}
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
}

// Setup stdin first
if (typeof process.stdin.setRawMode === 'function') {
    try { 
        process.stdin.setRawMode(true); 
    } catch { }
}
process.stdin.resume();
setupStdinListener();

// Then create bot
createBot();