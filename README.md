# Kokoro TTS Plugin for Obsidian

This plugin integrates the Kokoro TTS engine into Obsidian, providing high-quality text-to-speech with multiple voice options. It uses the lightweight Kokoro v0.19 model which offers natural-sounding speech in both American and British English.

## Features

- Multiple voice options (Bella, Sarah, Adam, Michael, Emma, Isabella, George, Lewis, Nicole, Sky)
- Support for both American and British English
- Text selection and full note reading
- Audio file saving and auto-embedding
- Configurable text processing (codeblocks, emphasis)
- Simple interface with keyboard shortcuts and context menu

## Prerequisites

1. Python 3.8 or higher
2. espeak-ng 1.51 (required for phonemization)
   - Windows: 
     * Download espeak-ng-1.51.msi from [espeak-ng releases](https://github.com/espeak-ng/espeak-ng/releases/tag/1.51)
     * Install the MSI package
     * Add both `C:\Program Files\eSpeak NG` and `C:\Program Files\eSpeak NG\bin` to your PATH
   - Linux: `sudo apt-get install espeak-ng`
   - macOS: `brew install espeak-ng`
   Note: Version 1.51 is required. Other versions may not work correctly.
3. Kokoro TTS model and voices
   - Clone from [Kokoro-82M repository](https://huggingface.co/hexgrad/Kokoro-82M)
   - Download model file (`kokoro-v0_19.pth`) and voice files

## Installation

### Manual Installation

1. Create a `kokoro-tts` folder in your vault's `.obsidian/plugins/` directory
2. Copy these files to the `kokoro-tts` folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `kokoro_backend.py`
   - `requirements.txt`
3. Install Python dependencies:
   ```bash
   cd YOUR_VAULT/.obsidian/plugins/kokoro-tts
   pip install -r requirements.txt
   ```
4. Enable the plugin in Obsidian's Community Plugins settings

### From Community Plugins (Coming Soon)

The plugin will be available in Obsidian's Community Plugins browser.

## Configuration

1. Open Settings → Kokoro TTS
2. Configure the required paths:
   - Python executable path (e.g., `python` or full path to Python)
   - Model path: Full path to `kokoro-v0_19.pth`
   - Voices path: Full path to the directory containing voice files
   - Backend script path: Path to `kokoro_backend.py` (default is in plugin directory)
3. Configure optional settings:
   - Voice selection
   - Audio settings (auto-play, save, embed)
   - Text processing options

### File Locations

The plugin expects the following structure:
```
YOUR_VAULT/
├── .obsidian/
│   └── plugins/
│       └── kokoro-tts/
│           ├── main.js
│           ├── manifest.json
│           ├── styles.css
│           ├── kokoro_backend.py    # Python backend script
│           └── requirements.txt     # Python dependencies
└── tts-audio/                      # Generated audio files (if enabled)
```

## Usage

### Commands

The plugin adds three commands that you can use:

1. **Read Highlighted Text**: Reads the currently selected text
2. **Read Whole Page**: Reads the entire current note
3. **Stop Speech**: Stops the current speech playback

Access these commands through:
- Command Palette (Ctrl/Cmd + P)
- Custom hotkeys (configurable in Settings → Hotkeys)
- Context menu (right-click on text)

### Audio Files

If audio saving is enabled:
- Files are saved in the same folder as the note being read
- Files are named with the format: `notename_timestamp_chunk.wav`
- Files can be automatically embedded in notes at the cursor position
- Standard Obsidian audio player is used for playback
- Use the "Stop Speech" command or button to stop playback

## Troubleshooting

### Common Issues

1. **"Failed to start TTS backend"**
   - Verify Python path in settings
   - Check if all dependencies are installed
   - Ensure espeak-ng is properly installed
   - Verify `kokoro_backend.py` exists in the plugin directory

2. **"Voice not found"**
   - Verify voices directory path
   - Check if voice files are properly downloaded

3. **"Model path not set"**
   - Configure the path to `kokoro-v0_19.pth` in settings
   - Ensure the model file exists at the specified path

4. **No audio output**
   - Check system audio settings
   - Verify sounddevice configuration
   - Check console for Python backend errors

### Debug Logs

Enable debug mode in settings to see detailed logs in the developer console (Ctrl/Cmd + Shift + I).

## Support

- For plugin issues: [GitHub Issues](https://github.com/mithadon/obsidian-kokoro-tts-plugin/issues)
- For Kokoro TTS issues: [Kokoro Discord](https://discord.gg/QuGxSWBfQy)

## Credits

- [Kokoro TTS](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad
- [StyleTTS2](https://github.com/yl4579/StyleTTS2) architecture by Li et al.
- [espeak-ng](https://github.com/espeak-ng/espeak-ng) for phonemization
