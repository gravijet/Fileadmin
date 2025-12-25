import mc from 'minecraft-protocol';
import fs from 'fs';
import readline from 'readline';
import prismarineAuth from 'prismarine-auth';
const { Authflow, Titles } = prismarineAuth;

// ===== KONFIGURATION =====
const CONFIG_PATH = './config.json';
let config = {
    host: 'localhost',
    port: 25565,
    account: 'Bot',
    version: '1.21.4'
};

// ===== STATE =====
let client = null;
let reconnectTimeout = null;
let cachedAuth = null;
let authFlow = null;
let consoleInterface = null;

// ===== KONFIGURATION LADEN =====
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            config = { ...config, ...JSON.parse(data) };
            console.log('[CONFIG] Geladen');
        } else {
            console.log('[CONFIG] config.json nicht gefunden, erstelle Beispiel');
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        }
    } catch (error) {
        console.error('[CONFIG] Fehler:', error.message);
    }
}

// ===== MICROSOFT AUTHENTIFIZIERUNG =====
async function getMicrosoftAuth() {
    if (cachedAuth) {
        console.log('[AUTH] Verwende gecachte Authentifizierung');
        return cachedAuth;
    }
    
    console.log('[AUTH] Starte Microsoft-Authentifizierung...');
    
    try {
        if (!authFlow) {
            authFlow = new Authflow(config.account, './', {
                authTitle: Titles.MinecraftJava,
                deviceType: 'Win32',
                flow: 'sisu',
                onMsaCode: (data) => {
                    console.log('\n→ ÖFFNE IM BROWSER:', data.verification_uri);
                    console.log('→ CODE EINGEBEN:', data.user_code, '\n');
                }
            });
        }
        
        const auth = await authFlow.getMinecraftJavaToken({ fetchProfile: true });
        
        cachedAuth = {
            accessToken: auth.token,
            clientToken: auth.token,
            selectedProfile: {
                id: auth.profile.id,
                name: auth.profile.name
            }
        };
        
        console.log(`[AUTH] Erfolg! Eingeloggt als: ${auth.profile.name}`);
        return cachedAuth;
        
    } catch (error) {
        console.error('[AUTH] Fehler:', error.message);
        process.exit(1);
    }
}

// ===== CONSOLE INPUT HANDLING =====
function setupConsoleInput() {
    if (consoleInterface) {
        consoleInterface.close();
    }
    
    consoleInterface = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    consoleInterface.on('line', (input) => {
        const message = input.trim();
        
        if (!message) {
            return;
        }
        
        // Spezielle Console-Befehle
        if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
            console.log('[BOT] Beende...');
            shutdown();
            return;
        }
        
        if (message.toLowerCase() === 'help') {
            showHelp();
            return;
        }
        
        if (message.toLowerCase() === 'status') {
            showStatus();
            return;
        }
        
        if (message.toLowerCase() === 'reconnect') {
            console.log('[BOT] Starte Reconnect...');
            if (client) {
                client.end();
            }
            scheduleReconnect();
            return;
        }
        
        if (message.toLowerCase() === 'clear') {
            console.clear();
            return;
        }
        
        // Alles andere wird an Minecraft gesendet
        console.log(`[→ MC] ${message}`);
        sendToMinecraft(message);
    });
    
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  CONSOLE INPUT AKTIV                           ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('\nTippe Befehle ein, sie gehen direkt zu Minecraft.');
    console.log('Bot-Befehle: help, status, reconnect, clear, exit');
    console.log('Beispiele:');
    console.log('  /list          - Spielerliste');
    console.log('  /msg user hallo - Private Nachricht');
    console.log('  Hallo Welt!    - Normale Chat-Nachricht');
    console.log('');
}

function showHelp() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  HILFE - MINECRAFT CONSOLE BOT                ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('\nBOT-BEFEHLE (nur in Console):');
    console.log('  help       - Diese Hilfe anzeigen');
    console.log('  status     - Bot-Status anzeigen');
    console.log('  reconnect  - Verbindung neu starten');
    console.log('  clear      - Console leeren');
    console.log('  exit/quit  - Bot beenden');
    console.log('\nMINECRAFT-BEFEHLE (gehen zu Server):');
    console.log('  /command   - Minecraft Command (z.B. /list)');
    console.log('  Nachricht  - Normale Chat-Nachricht');
    console.log('\nTIP: Alles was du hier eingibst, wird direkt an');
    console.log('     Minecraft gesendet, außer die Bot-Befehle oben.');
    console.log('');
}

function showStatus() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  BOT STATUS                                   ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Verbunden:   ${client ? 'Ja' : 'Nein'}`);
    if (client) {
        console.log(`  Spieler:     ${client.username}`);
    }
    console.log(`  Server:      ${config.host}:${config.port}`);
    console.log(`  Version:     ${config.version}`);
    console.log(`  Account:     ${config.account}`);
    console.log('');
}

// ===== MINECRAFT COMMUNICATION =====
function sendToMinecraft(message) {
    if (!client) {
        console.log('[FEHLER] Nicht mit Minecraft verbunden');
        return;
    }
    
    try {
        if (message.startsWith('/')) {
            // Command senden
            client.write('chat_command', {
                command: message.substring(1),
                timestamp: BigInt(Date.now()),
                salt: 0n,
                argumentSignatures: [],
                signedPreview: false,
                messageCount: 0,
                acknowledged: Buffer.alloc(3)
            });
        } else {
            // Normale Nachricht senden
            client.write('chat', {
                message: message,
                position: 0,
                sender: client.uuid
            });
        }
    } catch (error) {
        console.error('[SENDEN] Fehler:', error.message);
    }
}

// ===== CLIENT MANAGEMENT =====
async function createClient() {
    console.log(`[BOT] Verbinde zu ${config.host}:${config.port}...`);
    
    try {
        const authData = await getMicrosoftAuth();
        
        const clientOptions = {
            host: config.host,
            port: config.port,
            version: config.version,
            username: authData.selectedProfile.name,
            accessToken: authData.accessToken,
            auth: 'microsoft',
            session: authData,
            hideErrors: true,
            skipValidation: true
        };
        
        console.log(`[BOT] Verbinde als: ${authData.selectedProfile.name}`);
        client = mc.createClient(clientOptions);
        
        setupClientHandlers();
        
    } catch (error) {
        console.error('[BOT] Verbindungsfehler:', error.message);
        scheduleReconnect();
    }
}

function setupClientHandlers() {
    client.on('login', () => {
        console.log('\n✅ ERFOLGREICH MIT MINECRAFT VERBUNDEN');
        console.log(`👤 Spieler: ${client.username}`);
        console.log(`🌐 Server: ${config.host}:${config.port}`);
        console.log(`📅 Version: ${config.version}`);
        console.log('\n✅ BOT BEREIT - Console Input aktiv\n');
        
        // Console Input nach Login aktivieren
        setTimeout(() => {
            setupConsoleInput();
        }, 1000);
    });
    
    // Einfaches Chat-Logging (optional)
    client.on('player_chat', (packet) => {
        try {
            const message = packet.plainMessage || packet.unsignedContent;
            if (message) {
                // Entferne Farbcodes
                const cleanMessage = message.replace(/§[0-9a-fklmnor]/gi, '');
                if (cleanMessage.trim()) {
                    console.log(`[CHAT] ${cleanMessage}`);
                }
            }
        } catch (error) {}
    });
    
    client.on('system_chat', (packet) => {
        try {
            if (packet.content) {
                // Einfache Text-Extraktion
                let text = '';
                if (typeof packet.content === 'string') {
                    text = packet.content;
                } else if (packet.content.value && packet.content.value.text) {
                    text = packet.content.value.text.value || '';
                }
                
                if (text && text.trim()) {
                    const cleanText = text.replace(/§[0-9a-fklmnor]/gi, '').trim();
                    if (cleanText) {
                        console.log(`[SYSTEM] ${cleanText}`);
                    }
                }
            }
        } catch (error) {}
    });
    
    client.on('disconnect', (packet) => {
        let reason = 'Verbindung getrennt';
        try {
            if (packet.reason && typeof packet.reason === 'string') {
                reason = packet.reason.replace(/§[0-9a-fklmnor]/gi, '');
            }
        } catch (error) {}
        
        console.log(`\n❌ VERBINDUNG GETRENNT: ${reason}`);
        
        if (consoleInterface) {
            consoleInterface.close();
            consoleInterface = null;
        }
        
        scheduleReconnect();
    });
    
    client.on('error', (error) => {
        console.error('[BOT] Fehler:', error.message);
        
        if (consoleInterface) {
            consoleInterface.close();
            consoleInterface = null;
        }
        
        scheduleReconnect();
    });
    
    client.on('end', () => {
        console.log('[BOT] Verbindung beendet');
        
        if (consoleInterface) {
            consoleInterface.close();
            consoleInterface = null;
        }
        
        scheduleReconnect();
    });
    
    // Resource Pack automatisch akzeptieren
    client.on('resource_pack_send', () => {
        console.log('[BOT] Akzeptiere Resource Pack');
        try {
            client.write('resource_pack_receive', { result: 0 });
        } catch (error) {}
    });
    
    // Ignoriere andere Pakete
    const ignoredPackets = ['keep_alive', 'position', 'entity_move_look', 'map_chunk', 'update_light'];
    ignoredPackets.forEach(packetName => {
        client.on(packetName, () => {});
    });
}

function scheduleReconnect() {
    if (client) {
        try {
            client.end();
        } catch (error) {}
        client = null;
    }
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    console.log('[BOT] Reconnect in 10 Sekunden...');
    reconnectTimeout = setTimeout(() => {
        createClient();
    }, 10000);
}

// ===== SHUTDOWN =====
function shutdown() {
    console.log('\n🛑 BOT WIRD BEENDET...');
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    if (consoleInterface) {
        consoleInterface.close();
        consoleInterface = null;
    }
    
    if (client) {
        try {
            client.end();
            console.log('[BOT] Verbindung zu Minecraft beendet');
        } catch (error) {}
    }
    
    console.log('[BOT] Erfolgreich beendet');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ===== START =====
async function start() {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║  MINECRAFT SIMPLE BOT                         ║');
    console.log('║  Nur Login + Console Input                    ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('\n📋 FUNKTIONEN:');
    console.log('  • Microsoft Authentifizierung');
    console.log('  • Automatischer Login');
    console.log('  • Console Input zu Minecraft');
    console.log('  • Automatischer Reconnect');
    console.log('  • Keine automatischen Aktionen');
    console.log('  • Kein Chat-Parsing');
    console.log('  • Kein Home/TPA System');
    console.log('');
    console.log('⚙️  Konfiguration: config.json anpassen');
    console.log('▶️  Starte mit: npm start');
    console.log('❌ Beenden mit: exit oder Ctrl+C');
    console.log('');
    
    loadConfig();
    await createClient();
}

start();
