import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import KokoroTTSPlugin from './main';

export interface KokoroTTSSettings {
	// Server settings
	pythonPath: string;
	modelPath: string;
	voicesPath: string;
	backendPath: string;
	serverPort: number;
	
	// Voice settings
	selectedVoice: string;
	language: string; // 'en-us' or 'en-gb'
	
	// Audio settings
	autoPlay: boolean;
	saveAudio: boolean;
	audioFolder: string;
	autoEmbed: boolean;
	
	// Chunking settings
	maxChunkLength: number;
	chunkStrategy: 'sentence' | 'word' | 'character';
	respectParagraphs: boolean;
}

export const DEFAULT_SETTINGS: KokoroTTSSettings = {
	pythonPath: 'python',
	modelPath: '',
	voicesPath: '',
	backendPath: '',
	serverPort: 7851,
	
	selectedVoice: 'af', // Default voice (Bella & Sarah mix)
	language: 'en-us',
	
	autoPlay: true,
	saveAudio: false,
	audioFolder: '',  // Empty string means save in same folder as note
	autoEmbed: false,
	
	maxChunkLength: 500,
	chunkStrategy: 'sentence',
	respectParagraphs: true
};

export class KokoroTTSSettingTab extends PluginSettingTab {
	plugin: KokoroTTSPlugin;
	backendStatus: HTMLElement;

	constructor(app: App, plugin: KokoroTTSPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Kokoro TTS'});
		
		// Add credit for the TTS engine
		const creditEl = containerEl.createEl('p', {
			text: 'Powered by Kokoro TTS Engine - ',
		});
		creditEl.createEl('a', {
			text: 'Hexgrad/Kokoro-82M',
			href: 'https://huggingface.co/hexgrad/Kokoro-82M'
		});

		// Backend Status and Control
		containerEl.createEl('h3', {text: 'Backend status'});
		
		this.backendStatus = containerEl.createEl('div', {
			text: this.plugin.backend.isConnected ? 'Running' : 'Stopped',
			cls: this.plugin.backend.isConnected ? 'kokoro-tts-status-running' : 'kokoro-tts-status-stopped'
		});

		new Setting(containerEl)
			.setName('Backend control')
			.setDesc('Start or stop the TTS backend')
			.addButton(button => button
				.setButtonText(this.plugin.backend.isConnected ? 'Stop backend' : 'Start backend')
				.onClick(async () => {
					try {
						if (this.plugin.backend.isConnected) {
							await this.plugin.backend.stopBackend();
							button.setButtonText('Start backend');
							this.backendStatus.textContent = 'Stopped';
							this.backendStatus.className = 'kokoro-tts-status-stopped';
						} else {
							try {
								await this.plugin.backend.startBackend();
								button.setButtonText('Stop backend');
								this.backendStatus.textContent = 'Running';
								this.backendStatus.className = 'kokoro-tts-status-running';
							} catch (error) {
								// Reset UI on failure
								button.setButtonText('Start backend');
								this.backendStatus.textContent = 'Stopped';
								this.backendStatus.className = 'kokoro-tts-status-stopped';
								throw error;
							}
						}
					} catch (error) {
						new Notice(`Backend error: ${error.message}`);
					}
				}));

		// Python Backend Settings
		containerEl.createEl('h3', {text: 'Python backend settings'});

		new Setting(containerEl)
			.setName('Python path')
			.setDesc('Path to Python executable (use full path if "python" alone doesn\'t work)')
			.addText(text => text
				.setPlaceholder('e.g., python or C:/Python39/python.exe')
				.setValue(this.plugin.settings.pythonPath)
				.onChange(async (value) => {
					this.plugin.settings.pythonPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model path')
			.setDesc('Path to Kokoro model file (kokoro-v0_19.pth)')
			.addText(text => text
				.setPlaceholder('e.g., C:/path/to/kokoro-v0_19.pth')
				.setValue(this.plugin.settings.modelPath)
				.onChange(async (value) => {
					this.plugin.settings.modelPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Voices path')
			.setDesc('Path to voices directory')
			.addText(text => text
				.setPlaceholder('e.g., C:/path/to/voices')
				.setValue(this.plugin.settings.voicesPath)
				.onChange(async (value) => {
					this.plugin.settings.voicesPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Backend path')
			.setDesc('Full path to kokoro_backend.py')
			.addText(text => text
				.setPlaceholder('e.g., C:/path/to/kokoro_backend.py')
				.setValue(this.plugin.settings.backendPath)
				.onChange(async (value) => {
					this.plugin.settings.backendPath = value;
					await this.plugin.saveSettings();
				}));

		// Voice Settings
		containerEl.createEl('h3', {text: 'Voice settings'});

		new Setting(containerEl)
			.setName('Voice')
			.setDesc('Select TTS voice')
			.addDropdown(dropdown => dropdown
				.addOption('af', 'Default (Bella & Sarah mix)')
				.addOption('af_bella', 'Bella')
				.addOption('af_sarah', 'Sarah')
				.addOption('am_adam', 'Adam')
				.addOption('am_michael', 'Michael')
				.addOption('bf_emma', 'Emma')
				.addOption('bf_isabella', 'Isabella')
				.addOption('bm_george', 'George')
				.addOption('bm_lewis', 'Lewis')
				.addOption('af_nicole', 'Nicole')
				.addOption('af_sky', 'Sky')
				.setValue(this.plugin.settings.selectedVoice)
				.onChange(async (value) => {
					this.plugin.settings.selectedVoice = value;
					await this.plugin.saveSettings();
				}));

		// Audio Settings
		containerEl.createEl('h3', {text: 'Audio settings'});

		new Setting(containerEl)
			.setName('Auto-play')
			.setDesc('Automatically play generated audio')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoPlay)
				.onChange(async (value) => {
					this.plugin.settings.autoPlay = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Save audio')
			.setDesc('Save generated audio files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveAudio)
				.onChange(async (value) => {
					this.plugin.settings.saveAudio = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Audio folder')
			.setDesc('Optional folder for audio files (leave blank to save in same folder as notes)')
			.addText(text => text
				.setPlaceholder('tts-audio')
				.setValue(this.plugin.settings.audioFolder)
				.onChange(async (value) => {
					this.plugin.settings.audioFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-embed')
			.setDesc('Automatically embed saved audio in notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoEmbed)
				.onChange(async (value) => {
					this.plugin.settings.autoEmbed = value;
					await this.plugin.saveSettings();
				}));

		// Chunking Settings
		containerEl.createEl('h3', {text: 'Text chunking'});

		new Setting(containerEl)
			.setName('Maximum chunk length')
			.setDesc('Maximum number of characters per chunk (100-2000)')
			.addSlider(slider => slider
				.setLimits(100, 2000, 100)
				.setValue(this.plugin.settings.maxChunkLength)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxChunkLength = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Chunking strategy')
			.setDesc('How to split text into chunks')
			.addDropdown(dropdown => dropdown
				.addOption('sentence', 'By sentences (recommended)')
				.addOption('word', 'By words')
				.addOption('character', 'By characters')
				.setValue(this.plugin.settings.chunkStrategy)
				.onChange(async (value: 'sentence' | 'word' | 'character') => {
					this.plugin.settings.chunkStrategy = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Respect paragraphs')
			.setDesc('Start new chunks at paragraph breaks')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.respectParagraphs)
				.onChange(async (value) => {
					this.plugin.settings.respectParagraphs = value;
					await this.plugin.saveSettings();
				}));
	}
}
