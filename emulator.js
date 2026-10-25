// Emulator Manager - handles NES (jsnes) and GBA (EmulatorJS / mGBA WASM) emulation

class EmulatorManager {
    constructor(canvas, ctx, status, debug) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.status = status;
        this.debug = debug;
        this.currentSystem = 'nes';
        this.nes = null;
        this.running = false;
        this.rafId = null;
        this.pressedKeys = new Set();

        // GBA / EmulatorJS state
        this.gbaActive = false;
        this.gbaBlobUrl = null;
        this.gbaEngine = 'emulatorjs';
    }

    log(msg) {
        console.log(msg);
        this.debug.textContent = msg;
    }

    initCanvas(system) {
        if (system === 'nes') {
            this.canvas.width = 256;
            this.canvas.height = 240;
            this.canvas.className = '';
        } else if (system === 'gba') {
            this.canvas.width = 240;
            this.canvas.height = 160;
            this.canvas.className = 'gba';
        }
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.log(`Canvas initialized: ${this.canvas.width}x${this.canvas.height} (${system.toUpperCase()})`);
    }

    createNESEmulator() {
        this.log('Creating NES emulator instance...');

        const imageData = this.ctx.createImageData(256, 240);
        let frameCount = 0;

        return new jsnes.NES({
            onFrame: (buffer) => {
                frameCount++;

                if (!buffer) {
                    this.log('ERROR: No buffer received');
                    return;
                }

                const pixelCount = 256 * 240;
                const data = imageData.data;

                if (frameCount === 1) {
                    this.log(`Buffer length: ${buffer.length}, expected: ${pixelCount}`);
                }

                // jsNES 1.2.1 uses 32-bit RGB integers (0x00RRGGBB format)
                if (buffer.length === pixelCount) {
                    for (let i = 0; i < pixelCount; i++) {
                        const color = buffer[i];
                        const dstIdx = i * 4;
                        data[dstIdx] = (color >> 16) & 0xFF;     // Red
                        data[dstIdx + 1] = (color >> 8) & 0xFF;   // Green
                        data[dstIdx + 2] = color & 0xFF;          // Blue
                        data[dstIdx + 3] = 255;                    // Alpha
                    }
                } else if (buffer.length === pixelCount * 3) {
                    // RGB format (3 bytes per pixel)
                    for (let i = 0; i < pixelCount; i++) {
                        const srcIdx = i * 3;
                        const dstIdx = i * 4;
                        data[dstIdx] = buffer[srcIdx];
                        data[dstIdx + 1] = buffer[srcIdx + 1];
                        data[dstIdx + 2] = buffer[srcIdx + 2];
                        data[dstIdx + 3] = 255;
                    }
                } else {
                    this.log(`ERROR: Unexpected buffer size: ${buffer.length}`);
                    return;
                }

                this.ctx.putImageData(imageData, 0, 0);
            },
            onAudioSample: () => {}
        });
    }

    async loadNES(file) {
        if (typeof jsnes === 'undefined') {
            throw new Error('NES emulator library not loaded');
        }

        const buffer = await file.arrayBuffer();
        this.log(`ROM file size: ${buffer.byteLength} bytes`);

        const data = new Uint8Array(buffer);

        if (data.length < 16) {
            throw new Error('File too small');
        }

        const header = String.fromCharCode(data[0], data[1], data[2]);
        if (header !== 'NES' || data[3] !== 0x1A) {
            throw new Error('Invalid NES ROM header');
        }

        this.log('Valid NES ROM detected');

        let romString = '';
        const chunkSize = 8192;
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
            romString += String.fromCharCode.apply(null, chunk);
        }

        this.nes = this.createNESEmulator();

        this.log('Loading ROM into emulator...');
        this.nes.loadROM(romString);
        this.log('ROM loaded successfully!');

        this.running = true;
        this.status.textContent = `Playing: ${file.name}`;

        const gameLoop = () => {
            if (!this.running || !this.nes) return;
            this.nes.frame();
            this.rafId = requestAnimationFrame(gameLoop);
        };

        this.rafId = requestAnimationFrame(gameLoop);
        this.log('Game loop started');
    }

    // ---------------------------------------------------------------
    // GBA via selectable engines. EmulatorJS/mGBA stays the default because it
    // supports loading the user's local ROM directly from our file input.
    // ---------------------------------------------------------------
    setGBAEngine(engine) {
        this.gbaEngine = engine === 'iodine' ? 'iodine' : 'emulatorjs';
    }

    async loadGBA(file) {
        if (this.gbaEngine === 'iodine') {
            this.loadIodineGBA();
            return;
        }

        await this.loadEmulatorJSGBA(file);
    }

    async loadEmulatorJSGBA(file) {
        this.log('Loading GBA ROM via EmulatorJS (mGBA core)...');
        this.status.textContent = 'Loading GBA emulator...';

        // Swap visible display: hide our raw canvas, show EmulatorJS mount
        this.canvas.style.display = 'none';
        const gameContainer = document.getElementById('game-container');
        const gameMount = document.getElementById('game');
        gameContainer.style.display = 'flex';
        if (gameMount) {
            gameMount.classList.remove('gba-alt-active');
        }

        // Fully reset the mount so re-loading a ROM gives a clean instance
        gameMount.innerHTML = '';

        // Create a Blob URL for the ROM so EmulatorJS can fetch it
        if (this.gbaBlobUrl) {
            try { URL.revokeObjectURL(this.gbaBlobUrl); } catch (e) {}
            this.gbaBlobUrl = null;
        }
        this.gbaBlobUrl = URL.createObjectURL(file);

        // EmulatorJS is configured via globals on window
        // Docs: https://emulatorjs.org/docs/options
        window.EJS_player = '#game';
        window.EJS_core = 'gba';
        window.EJS_gameUrl = this.gbaBlobUrl;
        window.EJS_gameName = file.name;
        window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
        window.EJS_startOnLoaded = true;
        window.EJS_color = '#58a6ff';
        window.EJS_controlScheme = 'gba';
        window.EJS_defaultOptions = {
            'save-state-location': 'browser',
            'save-state-slot': '1',
            'save-save-interval': '10'
        };
        delete window.EJS_onSaveState;
        delete window.EJS_onLoadState;
        delete window.EJS_onSaveSave;
        delete window.EJS_onLoadSave;
        window.EJS_Buttons = {
            playPause: false,
            restart: false,
            mute: true,
            settings: true,
            fullscreen: true,
            saveState: true,
            loadState: true,
            saveSavFiles: true,
            loadSavFiles: true,
            gamepad: true,
            cheat: false,
            cacheManager: true,
            netplay: false,
            diskButton: false,
            volume: true,
            exitEmulation: false,
            quickSave: true,
            quickLoad: true,
            screenshot: false,
            screenRecord: false
        };
        window.EJS_VirtualGamepadSettings = [
            { type: 'button', text: 'B', id: 'b', location: 'right', left: 10, top: 70, bold: true, input_value: 0 },
            { type: 'button', text: 'A', id: 'a', location: 'right', left: 81, top: 40, bold: true, input_value: 8 },
            { type: 'dpad', id: 'dpad', location: 'left', left: '50%', top: '50%', joystickInput: false, inputValues: [4, 5, 6, 7] },
            { type: 'button', text: 'Select', id: 'select', location: 'center', left: -5, fontSize: 15, block: true, input_value: 2 },
            { type: 'button', text: 'Start', id: 'start', location: 'center', left: 60, fontSize: 15, block: true, input_value: 3 },
            { type: 'button', text: 'L', id: 'l', location: 'left', left: 3, top: -90, bold: true, block: true, input_value: 10 },
            { type: 'button', text: 'R', id: 'r', location: 'right', right: 3, top: -90, bold: true, block: true, input_value: 11 }
        ];

        // Tear down any previous EmulatorJS instance
        if (window.EJS_emulator) {
            try {
                if (typeof window.EJS_emulator.destroy === 'function') {
                    window.EJS_emulator.destroy();
                } else if (window.EJS_emulator.elements &&
                           window.EJS_emulator.elements.parent) {
                    window.EJS_emulator.elements.parent.remove();
                }
            } catch (e) {
                console.log('Could not destroy previous EJS instance:', e);
            }
            window.EJS_emulator = null;
        }

        // Load EmulatorJS loader.js if not already loaded
        await this._ensureEmulatorJsLoader();

        this.gbaActive = true;
        this.running = true;
        this.status.textContent = `Playing: ${file.name}`;
        this.log('EmulatorJS booting — first run downloads the WASM core (~few MB).');
    }

    loadIodineGBA() {
        this.log('Loading IodineGBA standalone fallback...');
        this.status.textContent = 'Loading IodineGBA standalone...';

        this.canvas.style.display = 'none';
        const gameContainer = document.getElementById('game-container');
        const gameMount = document.getElementById('game');
        gameContainer.style.display = 'flex';
        gameMount.classList.add('gba-alt-active');
        gameMount.innerHTML = '';

        if (this.gbaBlobUrl) {
            try { URL.revokeObjectURL(this.gbaBlobUrl); } catch (e) {}
            this.gbaBlobUrl = null;
        }

        if (window.EJS_emulator) {
            try {
                if (typeof window.EJS_emulator.destroy === 'function') {
                    window.EJS_emulator.destroy();
                } else if (window.EJS_emulator.elements &&
                           window.EJS_emulator.elements.parent) {
                    window.EJS_emulator.elements.parent.remove();
                }
            } catch (e) {
                console.log('Could not destroy EJS instance:', e);
            }
            window.EJS_emulator = null;
        }

        const iframe = document.createElement('iframe');
        iframe.className = 'gba-alt-frame';
        iframe.title = 'IodineGBA standalone emulator';
        iframe.src = 'https://taisel.github.io/IodineGBA/';
        iframe.loading = 'lazy';
        iframe.allow = 'fullscreen; autoplay';
        iframe.referrerPolicy = 'no-referrer';

        const note = document.createElement('p');
        note.className = 'gba-alt-note';
        note.textContent = 'IodineGBA is a standalone fallback. Use File > Game inside this frame to choose your ROM.';

        gameMount.appendChild(iframe);
        gameMount.appendChild(note);

        this.gbaActive = true;
        this.running = true;
        this.status.textContent = 'IodineGBA standalone loaded - use its in-frame Game file picker';
        this.log('IodineGBA standalone iframe loaded. Local ROM files cannot be passed into a cross-origin iframe.');
    }

    _ensureEmulatorJsLoader() {
        return new Promise((resolve, reject) => {
            // Re-trigger loader each time (loader.js is idempotent and re-reads EJS_* globals)
            // Remove any previously injected loader script so it can re-execute.
            const oldScripts = document.querySelectorAll('script[data-ejs-loader]');
            oldScripts.forEach((s) => s.remove());

            const script = document.createElement('script');
            script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
            script.setAttribute('data-ejs-loader', 'true');
            script.onload = () => {
                this.log('EmulatorJS loader script ready.');
                resolve();
            };
            script.onerror = () => {
                const msg = 'Failed to load EmulatorJS from CDN. Check your internet connection.';
                this.log('ERROR: ' + msg);
                this.status.textContent = msg;
                reject(new Error(msg));
            };
            document.head.appendChild(script);
        });
    }

    stop() {
        this.running = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        // Tear down GBA / EmulatorJS instance
        if (this.gbaActive) {
            if (window.EJS_emulator) {
                try {
                    if (typeof window.EJS_emulator.destroy === 'function') {
                        window.EJS_emulator.destroy();
                    } else if (window.EJS_emulator.elements &&
                               window.EJS_emulator.elements.parent) {
                        window.EJS_emulator.elements.parent.remove();
                    }
                } catch (e) {
                    console.log('Could not destroy EJS instance:', e);
                }
                window.EJS_emulator = null;
            }
            const gameMount = document.getElementById('game');
            if (gameMount) gameMount.innerHTML = '';
            if (gameMount) gameMount.classList.remove('gba-alt-active');
            if (this.gbaBlobUrl) {
                try { URL.revokeObjectURL(this.gbaBlobUrl); } catch (e) {}
                this.gbaBlobUrl = null;
            }
            this.gbaActive = false;
        }
    }

    setSystem(system) {
        this.currentSystem = system;
        const gameContainer = document.getElementById('game-container');
        const gameMount = document.getElementById('game');

        this.stop();

        if (system === 'nes') {
            this.canvas.style.display = 'block';
            gameContainer.style.display = 'none';
            if (gameMount) gameMount.innerHTML = '';
            if (gameMount) gameMount.classList.remove('gba-alt-active');
            this.initCanvas('nes');
        } else if (system === 'gba') {
            this.canvas.style.display = 'none';
            gameContainer.style.display = 'flex';
            if (gameMount) gameMount.innerHTML = '';
            if (gameMount) gameMount.classList.remove('gba-alt-active');
        }

        // Notify main.js to re-evaluate touch-overlay visibility
        if (typeof window.__syncTouchOverlay === 'function') {
            window.__syncTouchOverlay();
        }
    }
}
