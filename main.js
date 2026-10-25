
// Main Application Entry Point

document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const status = document.getElementById('status');
    const debug = document.getElementById('debug');
    const romFile = document.getElementById('romFile');
    const systemSelect = document.getElementById('systemSelect');
    const gbaEngineGroup = document.getElementById('gbaEngineGroup');
    const gbaEngineSelect = document.getElementById('gbaEngineSelect');
    const gbaSaveHint = document.getElementById('gbaSaveHint');

    // Core managers
    const emulator = new EmulatorManager(canvas, ctx, status, debug);
    const inputHandler = new InputHandler(emulator);
    const controlSettings = new ControlSettings(inputHandler);
    const touchControls = new TouchControls(emulator, inputHandler);

    emulator.touchControls = touchControls;

    // Initial canvas
    emulator.initCanvas('nes');

    // -----------------------------------------------------------
    // Touch device detection
    // -----------------------------------------------------------
    const isTouchDevice =
        (window.matchMedia &&
            window.matchMedia('(hover: none) and (pointer: coarse)').matches) ||
        ('ontouchstart' in window);

    function syncSystemClass() {
        const system = systemSelect.value || emulator.currentSystem;

        document.body.classList.toggle('is-nes', system === 'nes');
        document.body.classList.toggle('is-gba', system === 'gba');
        document.body.classList.toggle('system-nes', system === 'nes');
        document.body.classList.toggle('system-gba', system === 'gba');

        if (gbaEngineGroup) {
            gbaEngineGroup.style.display = system === 'gba' ? 'block' : 'none';
        }

        if (gbaSaveHint) {
            const isEmulatorJsGba =
                system === 'gba' &&
                (!gbaEngineSelect || gbaEngineSelect.value !== 'iodine');

            gbaSaveHint.style.display = isEmulatorJsGba ? 'block' : 'none';
        }
    }

    function syncTouchOverlay() {
        if (!touchControls.container) return;

        syncSystemClass();

        const shouldShow =
            isTouchDevice &&
            (systemSelect.value || emulator.currentSystem) === 'nes';

        if (shouldShow) touchControls.show();
        else touchControls.hide();
    }

    window.__syncTouchOverlay = syncTouchOverlay;

    // -----------------------------------------------------------
    // ROM library hosted in Retro-Web-Emulator/roms
    // -----------------------------------------------------------
    const ROM_REPOSITORY =
        'https://api.github.com/repos/Kadaz/Retro-Web-Emulator/git/trees/main?recursive=1';

    const ROM_RAW_BASE =
        'https://raw.githubusercontent.com/Kadaz/Retro-Web-Emulator/main/';

    let remoteRomEntries = [];
    let remoteRomEntriesLoaded = false;

    // Create the ROM library controls without changing index.html.
    const remoteRomPanel = document.createElement('div');
    remoteRomPanel.style.cssText =
        'margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;' +
        'gap:8px;align-items:end;width:100%;';

    const remoteRomField = document.createElement('div');
    remoteRomField.style.cssText =
        'display:flex;flex-direction:column;gap:5px;min-width:0;';

    const remoteRomLabel = document.createElement('label');
    remoteRomLabel.textContent = 'ROM from your GitHub library';
    remoteRomLabel.htmlFor = 'remoteRomSelect';

    const remoteRomSelect = document.createElement('select');
    remoteRomSelect.id = 'remoteRomSelect';
    remoteRomSelect.style.cssText = 'width:100%;min-width:0;';

    const remoteRomLoadButton = document.createElement('button');
    remoteRomLoadButton.type = 'button';
    remoteRomLoadButton.textContent = 'Load ROM';
    remoteRomLoadButton.style.cssText =
        'white-space:nowrap;min-height:36px;';

    remoteRomField.append(remoteRomLabel, remoteRomSelect);
    remoteRomPanel.append(remoteRomField, remoteRomLoadButton);

    if (romFile.parentElement) {
        romFile.parentElement.appendChild(remoteRomPanel);
    }

    function showRomPlaceholder(message) {
        remoteRomSelect.replaceChildren();

        const option = document.createElement('option');
        option.value = '';
        option.textContent = message;

        remoteRomSelect.appendChild(option);
    }

    async function refreshRemoteRomList() {
        remoteRomSelect.disabled = true;
        remoteRomLoadButton.disabled = true;
        showRomPlaceholder('Loading ROM list from GitHub…');

        try {
            if (!remoteRomEntriesLoaded) {
                const response = await fetch(ROM_REPOSITORY);

                if (!response.ok) {
                    throw new Error(
                        'GitHub ROM list request failed (' + response.status + ')'
                    );
                }

                const treeData = await response.json();

                if (treeData.truncated) {
                    throw new Error(
                        'GitHub returned an incomplete file list.'
                    );
                }

                remoteRomEntries = (treeData.tree || [])
                    .filter(function (entry) {
                        return (
                            entry.type === 'blob' &&
                            /^roms\/.*\.(nes|gba)$/i.test(entry.path)
                        );
                    })
                    .sort(function (a, b) {
                        return a.path.localeCompare(b.path);
                    });

                remoteRomEntriesLoaded = true;
            }

            const selectedSystem = systemSelect.value || 'nes';
            const extension = selectedSystem === 'gba' ? '.gba' : '.nes';

            const matchingRoms = remoteRomEntries.filter(function (entry) {
                return entry.path.toLowerCase().endsWith(extension);
            });

            remoteRomSelect.replaceChildren();

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = matchingRoms.length
                ? 'Choose a ' + selectedSystem.toUpperCase() + ' ROM…'
                : 'No ' + selectedSystem.toUpperCase() + ' ROMs found';

            remoteRomSelect.appendChild(placeholder);

            matchingRoms.forEach(function (entry) {
                const option = document.createElement('option');
                option.value = entry.path;
                option.textContent = entry.path.replace(/^roms\//, '');
                remoteRomSelect.appendChild(option);
            });

            remoteRomSelect.disabled = matchingRoms.length === 0;
            remoteRomLoadButton.disabled = matchingRoms.length === 0;

            if (matchingRoms.length === 0) {
                status.textContent =
                    'No ' + selectedSystem.toUpperCase() +
                    ' ROMs were found in the GitHub roms folder.';
            }
        } catch (error) {
            showRomPlaceholder('Could not read GitHub ROM list');
            remoteRomSelect.disabled = true;
            remoteRomLoadButton.disabled = true;

            status.textContent = 'GitHub ROM list error: ' + error.message;
            console.error(error);
        }
    }

    remoteRomLoadButton.addEventListener('click', async function () {
        const selectedPath = remoteRomSelect.value;

        if (!selectedPath) {
            status.textContent = 'Choose a ROM from your GitHub library first.';
            return;
        }

        const selectedSystem =
            selectedPath.toLowerCase().endsWith('.gba') ? 'gba' : 'nes';

        if (systemSelect.value !== selectedSystem) {
            systemSelect.value = selectedSystem;
            systemSelect.dispatchEvent(new Event('change'));
        }

        remoteRomLoadButton.disabled = true;
        status.textContent = 'Downloading ROM from GitHub…';

        try {
            const encodedPath = selectedPath
                .split('/')
                .map(encodeURIComponent)
                .join('/');

            const response = await fetch(ROM_RAW_BASE + encodedPath);

            if (!response.ok) {
                throw new Error('ROM download failed (' + response.status + ')');
            }

            const blob = await response.blob();

            if (blob.size === 0) {
                throw new Error('The downloaded ROM file is empty.');
            }

            const fileName = selectedPath.split('/').pop();

            const romFileObject = new File(
                [blob],
                fileName,
                { type: 'application/octet-stream' }
            );

            status.textContent = 'Loading ' + fileName + '…';

            emulator.stop();

            if (selectedSystem === 'nes') {
                await emulator.loadNES(romFileObject);
            } else {
                // Use EmulatorJS/mGBA for direct local-Blob ROM loading.
                // The Iodine iframe fallback cannot receive this File directly.
                if (gbaEngineSelect) {
                    gbaEngineSelect.value = 'emulatorjs';
                }

                emulator.setGBAEngine('emulatorjs');
                await emulator.loadGBA(romFileObject);
            }

            syncTouchOverlay();
        } catch (error) {
            emulator.log('ERROR: ' + error.message);
            status.textContent = 'Could not load GitHub ROM: ' + error.message;
            console.error(error);
        } finally {
            remoteRomLoadButton.disabled = !remoteRomSelect.value;
        }
    });

    // -----------------------------------------------------------
    // System selection
    // -----------------------------------------------------------
    systemSelect.addEventListener('change', async (e) => {
        const system = e.target.value;

        emulator.setSystem(system);

        status.textContent =
            `System: ${systemSelect.options[systemSelect.selectedIndex].text} - Load a ROM file`;

        if (
            system === 'gba' &&
            gbaEngineSelect &&
            gbaEngineSelect.value === 'iodine'
        ) {
            emulator.setGBAEngine('iodine');
            emulator.loadGBA();
        }

        syncTouchOverlay();
        await refreshRemoteRomList();
    });

    if (gbaEngineSelect) {
        gbaEngineSelect.addEventListener('change', async (e) => {
            emulator.setGBAEngine(e.target.value);

            if (emulator.currentSystem !== 'gba') return;

            const file = romFile.files && romFile.files[0];

            if (emulator.gbaEngine === 'iodine' || file) {
                status.textContent = 'Switching GBA engine...';

                try {
                    emulator.stop();
                    await emulator.loadGBA(file);
                } catch (err) {
                    emulator.log('ERROR: ' + err.message);
                    status.textContent = 'Error: ' + err.message;
                    console.error(err);
                }
            } else {
                emulator.setSystem('gba');
                status.textContent = 'GBA engine changed - load a ROM file';
            }

            syncTouchOverlay();
        });
    }

    // -----------------------------------------------------------
    // ROM loader — existing local file support
    // -----------------------------------------------------------
    romFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        status.textContent = 'Loading ROM...';
        emulator.log('Reading ROM file...');

        try {
            emulator.stop();

            if (emulator.currentSystem === 'nes') {
                await emulator.loadNES(file);
            } else if (emulator.currentSystem === 'gba') {
                await emulator.loadGBA(file);
            }

            syncTouchOverlay();
        } catch (err) {
            emulator.log('ERROR: ' + err.message);
            status.textContent = 'Error: ' + err.message;
            console.error(err);
        }
    });

    // Canvas focus helper for keyboard input
    canvas.setAttribute('tabindex', '0');
    canvas.addEventListener('keydown', (e) => e.preventDefault());

    // file:// protocol warning
    if (window.location.protocol === 'file:') {
        const warning = document.getElementById('fileProtocolWarning');

        if (warning) warning.style.display = 'block';

        status.textContent = '⚠ Please use a web server (see warning above)';
        emulator.log(
            '⚠ Running from file:// - CORS restrictions will prevent loading external resources'
        );
    } else {
        status.textContent = 'Ready! Select a system and load a ROM file.';
        emulator.log('Emulator ready');
    }

    // Initial sync and load the remote ROM list.
    syncSystemClass();
    syncTouchOverlay();
    refreshRemoteRomList();
});
