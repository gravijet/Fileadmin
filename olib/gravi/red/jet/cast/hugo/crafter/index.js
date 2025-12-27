import mc from 'minecraft-protocol';
import fs from 'fs';
import readline from 'readline';
import prismarineAuth from 'prismarine-auth';
const { Authflow, Titles } = prismarineAuth;

// Config
const CONFIG_PATH = './config.json';
let config = {
    host: 'localhost',
    port: 25565,
    account: 'Bot',
    version: '1.21.4'
};

let client = null;
let reconnectTimeout = null;

// Config laden
if (fs.existsSync(CONFIG_PATH)) {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = { ...config, ...JSON.parse(data) };
    console.log('Config geladen');
} else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('config.json erstellt');
}

// Microsoft Auth
async function getMicrosoftAuth() {
    console.log('Starte Microsoft Authentifizierung...');
    
    try {
        const authflow = new Authflow(config.account, './', {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'sisu',
            onMsaCode: (data) => {
                console.log('\nÖffne im Browser:', data.verification_uri);
                console.log('Code eingeben:', data.user_code, '\n');
            }
        });
        
        const auth = await authflow.getMinecraftJavaToken({ fetchProfile: true });
        
        return {
            accessToken: auth.token,
            clientToken: auth.token,
            selectedProfile: {
                id: auth.profile.id,
                name: auth.profile.name
            }
        };
        
    } catch (error) {
        console.error('Auth Fehler:', error.message);
        process.exit(1);
    }
}

// Nachricht an Minecraft senden
function sendToMinecraft(message) {
    if (!client) {
        console.log('Nicht verbunden');
        return;
    }
    
    try {
        if (message.startsWith('/')) {
            // Command
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
            // Normale Nachricht
            client.write('chat', {
                message: message,
                position: 0,
                sender: client.uuid
            });
        }
        console.log(`Gesendet: ${message}`);
    } catch (error) {
        console.error('Sendefehler:', error.message);
    }
}

// Console Input
let consoleInterface = null;
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
        if (!message) return;
        
        if (message.toLowerCase() === 'exit') {
            shutdown();
            return;
        }
        
        if (message.toLowerCase() === 'reconnect') {
            console.log('Reconnect...');
            if (client) client.end();
            return;
        }
        
        sendToMinecraft(message);
    });
    
    console.log('\nConsole Input bereit!');
    console.log('Eingaben gehen direkt zu Minecraft.');
    console.log('exit = beenden, reconnect = neu verbinden\n');
}

// Client erstellen
async function createClient() {
    console.log(`Verbinde zu ${config.host}:${config.port}...`);
    
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
        
        console.log(`Verbinde als: ${authData.selectedProfile.name}`);
        client = mc.createClient(clientOptions);
        
        // Event Handler
        client.on('login', () => {
            console.log('\n✅ Eingeloggt!');
            console.log(`Spieler: ${client.username}`);
            console.log('Bot bereit.\n');
            
            setTimeout(() => {
                setupConsoleInput();
            }, 1000);
        });
        
        // Chat empfangen
        client.on('player_chat', (packet) => {
            try {
                const msg = packet.plainMessage || packet.unsignedContent || '';
                if (msg && msg.trim()) {
                    console.log(`[Chat] ${msg}`);
                }
            } catch (e) {}
        });
        
        client.on('system_chat', (packet) => {
            try {
                let text = '';
                if (typeof packet.content === 'string') {
                    text = packet.content;
                }
                if (text && text.trim()) {
                    console.log(`[System] ${text.replace(/§[0-9a-fklmnor]/gi, '')}`);
                }
            } catch (e) {}
        });
        
        client.on('disconnect', () => {
            console.log('Verbindung getrennt');
            if (consoleInterface) {
                consoleInterface.close();
                consoleInterface = null;
            }
            scheduleReconnect();
        });
        
        client.on('error', (error) => {
            console.error('Fehler:', error.message);
            scheduleReconnect();
        });
        
        client.on('end', () => {
            console.log('Verbindung beendet');
            scheduleReconnect();
        });
        
    } catch (error) {
        console.error('Verbindungsfehler:', error.message);
        scheduleReconnect();
    }
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
    
    console.log('Reconnect in 10 Sekunden...');
    reconnectTimeout = setTimeout(() => {
        createClient();
    }, 10000);
}

function shutdown() {
    console.log('\nBeende Bot...');
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    if (consoleInterface) {
        consoleInterface.close();
    }
    
    if (client) {
        try {
            client.end();
        } catch (error) {}
    }
    
    process.exit(0);
}

process.on('SIGINT', shutdown);

// Start
console.log('Minecraft Console Bot');
console.log('=====================\n');

createClient();
