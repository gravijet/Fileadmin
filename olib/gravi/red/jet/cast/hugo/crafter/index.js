const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const { URL } = require('url');

const AUTH_CACHE_DIR = path.join(__dirname, '.auth_cache');
if (!fs.existsSync(AUTH_CACHE_DIR)) {
    fs.mkdirSync(AUTH_CACHE_DIR, { recursive: true });
}

let bot = null;
let isShuttingDown = false;
let isConnected = false;
let currentVersion = null;
let wasKicked = false; // Track if we were kicked to auto-teleport

const JUMP_INTERVAL = (parseInt(process.env.JUMP_INTERVAL) || 60) * 1000;
const ENABLE_JUMP = (process.env.ENABLE_JUMP || '0') === '1';
const SERVER_IP = process.env.IP || 'blockbande.net:25565';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1450362713594138624/7DDmD3ng2z-jViSPhbyc1BnyVBUkEp1DdKEGQDptHFdj-woxWHKqbTuezAekar3D-BMe';
const AUTO_TELEPORT_COMMAND = process.env.AUTO_TELEPORT || '/plot home gravijet 1';
const TELEPORT_DELAY = parseInt(process.env.TELEPORT_DELAY) || 7000; // 7 seconds

// Try these versions in order if one fails
const VERSIONS_TO_TRY = ['1.21.4'];

console.log('='.repeat(60));
console.log('Minecraft AFK Bot with Discord Integration');
console.log('='.repeat(60));
console.log(`Server: ${SERVER_IP}`);
console.log(`Discord Webhook: ${DISCORD_WEBHOOK ? 'Enabled' : 'Disabled'}`);
console.log(`Auto-Teleport: ${AUTO_TELEPORT_COMMAND} (after ${TELEPORT_DELAY/1000}s)`);
console.log(`Will try versions: ${VERSIONS_TO_TRY.join(', ')}`);
console.log('='.repeat(60) + '\n');

// Discord webhook function
function sendToDiscord(message) {
    if (!DISCORD_WEBHOOK || !message || message.trim() === '') return;
    
    try {
        const webhookUrl = new URL(DISCORD_WEBHOOK);
        
        const payload = JSON.stringify({
            content: message,
            username: 'Minecraft Bot'
        });
        
        const options = {
            hostname: webhookUrl.hostname,
            path: webhookUrl.pathname + webhookUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        
        const req = https.request(options, (res) => {
            // Silent handling
            if (res.statusCode !== 204) {
                // Only log if error
                res.on('data', (d) => {
                    if (res.statusCode >= 400) {
                        console.log(`[Discord Error] ${res.statusCode}: ${d.toString()}`);
                    }
                });
            }
        });
        
        req.on('error', (error) => {
            console.log(`[Discord Error] ${error.message}`);
        });
        
        req.write(payload);
        req.end();
        
    } catch (error) {
        console.log(`[Discord Error] ${error.message}`);
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', (input) => {
    if (input.trim() === '\\stop') {
        console.log('Stopping...');
        if (bot) bot.quit();
        rl.close();
        process.exit(0);
        return;
    }
    
    if (bot && isConnected) {
        try {
            bot.chat(input);
            console.log(`> ${input}`);
        } catch (e) {
            console.log(`FAILED: ${e.message}`);
        }
    } else {
        console.log('Not connected yet');
    }
});

let versionIndex = 0;
let connectionAttempts = 0;

function createBot() {
    if (isShuttingDown) return;
    
    // If we've tried all versions, start over with longer delay
    if (versionIndex >= VERSIONS_TO_TRY.length) {
        connectionAttempts++;
        if (connectionAttempts > 3) {
            console.log('\n' + '='.repeat(60));
            console.log('ERROR: Could not connect with any version!');
            console.log('This usually means:');
            console.log('1. Your mineflayer/minecraft-protocol is outdated');
            console.log('2. The server requires a specific protocol version');
            console.log('\nTry running:');
            console.log('  npm install mineflayer@latest minecraft-protocol@latest');
            console.log('='.repeat(60));
            process.exit(1);
        }
        versionIndex = 0;
        console.log('\nRetrying all versions again...\n');
        setTimeout(() => createBot(), 10000);
        return;
    }
    
    const version = process.env.VERSION || VERSIONS_TO_TRY[versionIndex];
    currentVersion = version;
    
    const [host, port] = SERVER_IP.includes(':') ? SERVER_IP.split(':') : [SERVER_IP, '25565'];
    
    console.log(`\n[${new Date().toLocaleTimeString()}] Trying version ${version}...`);
    
    try {
        bot = mineflayer.createBot({
            host: host,
            port: parseInt(port),
            version: version,
            auth: 'microsoft',
            profilesFolder: AUTH_CACHE_DIR,
            viewDistance: 'tiny',
            skipValidation: true,
            hideErrors: true,
            checkTimeoutInterval: 120000
        });

        let hasError = false;
        let errorTimeout = null;
        let hasTeleported = false;

        // Detect critical errors early
        bot._client.on('error', (err) => {
            const msg = err.message || '';
            
            // Ignore non-critical parse errors
            if (msg.includes('Parse error') && !msg.includes('PartialReadError')) {
                return;
            }
            
            // PartialReadError = wrong version
            if (msg.includes('PartialReadError') || msg.includes('Read error')) {
                if (!hasError) {
                    hasError = true;
                    console.log(`  ✗ Version ${version} - Protocol error (wrong version)`);
                    
                    // Cleanup and try next version
                    try {
                        bot.quit();
                    } catch (e) {}
                    
                    bot = null;
                    isConnected = false;
                    versionIndex++;
                    
                    // Quick retry with next version
                    setTimeout(() => createBot(), 2000);
                }
                return;
            }
        });

        bot.on('login', () => {
            if (hasError) return;
            console.log(`  ✓ Version ${version} - Login successful!`);
        });

        bot.on('spawn', () => {
            if (hasError) return;
            isConnected = true;
            versionIndex = 0; // Reset for next disconnect
            connectionAttempts = 0;
            
            console.log(`  ✓ Connected as ${bot.username}`);
            console.log('\n' + '='.repeat(60));
            console.log('READY - Type messages and press Enter');
            console.log('Type \\stop to quit');
            console.log('='.repeat(60) + '\n');
            
            // Send connection notification to Discord
            sendToDiscord(`✅ **${bot.username}** connected to server`);
            
            // Auto-teleport if we were kicked
            if (wasKicked && AUTO_TELEPORT_COMMAND && !hasTeleported) {
                hasTeleported = true;
                wasKicked = false;
                
                console.log(`[Auto-Teleport] Executing "${AUTO_TELEPORT_COMMAND}" in ${TELEPORT_DELAY/1000}s...`);
                
                setTimeout(() => {
                    if (bot && isConnected) {
                        try {
                            bot.chat(AUTO_TELEPORT_COMMAND);
                            console.log(`[Auto-Teleport] ✓ Executed: ${AUTO_TELEPORT_COMMAND}`);
                            sendToDiscord(`🏠 Auto-teleported: \`${AUTO_TELEPORT_COMMAND}\``);
                        } catch (e) {
                            console.log(`[Auto-Teleport] ✗ Failed: ${e.message}`);
                        }
                    }
                }, TELEPORT_DELAY);
            }
            
            // Anti-AFK
            if (ENABLE_JUMP) {
                setInterval(() => {
                    if (bot && bot.entity && isConnected) {
                        try {
                            bot.setControlState('jump', true);
                            setTimeout(() => {
                                if (bot) bot.setControlState('jump', false);
                            }, 500);
                        } catch (e) {}
                    }
                }, JUMP_INTERVAL);
            }
        });

        bot.on('message', (message) => {
            if (!isConnected || hasError) return;
            try {
                const text = message.toString().replace(/§[0-9a-fk-or]/g, '').trim();
                if (text) {
                    console.log(text);
                    
                    // Send to Discord (1:1 copy)
                    sendToDiscord(text);
                }
            } catch (e) {}
        });

        bot.on('kicked', (reason) => {
            if (hasError) return;
            isConnected = false;
            wasKicked = true; // Mark that we were kicked for auto-teleport
            hasTeleported = false; // Reset teleport flag
            
            let text = '';
            try {
                if (typeof reason === 'object' && reason.value && reason.value.text && reason.value.text.value) {
                    text = reason.value.text.value;
                } else {
                    text = typeof reason === 'string' ? reason : JSON.stringify(reason);
                }
            } catch (e) { text = 'Unknown'; }
            
            console.log(`\nKicked: ${text}`);
            console.log('Reconnecting in 5s...');
            
            // Send kick notification to Discord
            sendToDiscord(`⚠️ **Kicked:** ${text}`);
            
            bot = null;
            setTimeout(() => createBot(), 5000);
        });

        bot.on('error', (err) => {
            if (hasError || isShuttingDown) return;
            
            const msg = err.message || '';
            
            // Ignore parse errors
            if (msg.includes('Parse error') && !msg.includes('PartialReadError')) {
                return;
            }
            
            // Protocol errors = try next version
            if (msg.includes('PartialReadError') || msg.includes('Read error')) {
                if (!hasError) {
                    hasError = true;
                    console.log(`  ✗ Version ${version} - Protocol mismatch`);
                    versionIndex++;
                    setTimeout(() => createBot(), 2000);
                }
                return;
            }
            
            console.log(`Error: ${msg}`);
            sendToDiscord(`❌ **Error:** ${msg}`);
        });

        bot.on('end', () => {
            if (hasError || isShuttingDown) return;
            isConnected = false;
            console.log('\nDisconnected - reconnecting in 5s...');
            sendToDiscord('🔴 **Disconnected** - reconnecting...');
            bot = null;
            setTimeout(() => createBot(), 5000);
        });
        
        bot.on('death', () => {
            console.log('[Death] Bot died');
            sendToDiscord('💀 **Died**');
            setTimeout(() => {
                try {
                    if (bot && bot._client && !bot._client.ended) {
                        bot.respawn();
                        console.log('[Death] Respawned');
                        sendToDiscord('✅ **Respawned**');
                    }
                } catch (e) {}
            }, 1000);
        });
        
        // Timeout if no connection after 15 seconds
        errorTimeout = setTimeout(() => {
            if (!isConnected && !hasError) {
                hasError = true;
                console.log(`  ✗ Version ${version} - Timeout`);
                try {
                    bot.quit();
                } catch (e) {}
                bot = null;
                versionIndex++;
                createBot();
            }
        }, 15000);

    } catch (error) {
        console.log(`Failed to create bot: ${error.message}`);
        versionIndex++;
        setTimeout(() => createBot(), 2000);
    }
}

createBot();