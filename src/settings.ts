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
	language: string; // 'default', 'en-us', or 'en-gb'
	
	// Audio settings
	autoPlay: boolean;
	saveAudio: boolean;
	audioFolder: string;
	autoEmbed: boolean;
	
	// Chunking settings
	maxChunkLength: number;
	respectParagraphs: boolean;
}

export const DEFAULT_SETTINGS: KokoroTTSSettings = {
	pythonPath: 'python',
	modelPath: '',
	voicesPath: '',
	backendPath: '',
	serverPort: 7851,
	
	selectedVoice: 'f', // Default voice (Bella & Sarah mix)
	language: 'default',
	
	autoPlay: true,
	saveAudio: false,
	audioFolder: '',  // Empty string means save in same folder as note
	autoEmbed: false,
	
	maxChunkLength: 500,
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
				.addOption('f', 'Default (Bella & Sarah mix) [US]')
				.addOption('f_bella', 'Bella [US]')
				.addOption('f_sarah', 'Sarah [US]')
				.addOption('f_adam', 'Adam [US]')
				.addOption('f_michael', 'Michael [US]')
				.addOption('f_emma', 'Emma [GB]')
				.addOption('f_isabella', 'Isabella [GB]')
				.addOption('f_george', 'George [GB]')
				.addOption('f_lewis', 'Lewis [GB]')
				.addOption('f_nicole', 'Nicole [US]')
				.addOption('f_sky', 'Sky [US]')
				.setValue(this.plugin.settings.selectedVoice)
				.onChange(async (value) => {
					this.plugin.settings.selectedVoice = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Language variant')
			.setDesc('Override voice\'s suggested language variant')
			.addDropdown(dropdown => dropdown
				.addOption('default', 'Use voice\'s default')
				.addOption('en-us', 'US English')
				.addOption('en-gb', 'British English')
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					this.plugin.settings.language = value;
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

		// Save audio setting
		const saveAudioSetting = new Setting(containerEl)
			.setName('Save audio')
			.setDesc('Save generated audio files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveAudio)
				.onChange(async (value) => {
					this.plugin.settings.saveAudio = value;
					// Show/hide dependent settings
					if (value) {
						audioFolderSetting.settingEl.show();
						autoEmbedSetting.settingEl.show();
					} else {
						audioFolderSetting.settingEl.hide();
						autoEmbedSetting.settingEl.hide();
						// Disable auto-embed if saving is disabled
						this.plugin.settings.autoEmbed = false;
					}
					await this.plugin.saveSettings();
				}));

		// Audio folder setting (dependent on save audio)
		const audioFolderSetting = new Setting(containerEl)
			.setName('Audio folder')
			.setDesc('Optional folder for audio files (leave blank to save in same folder as notes)')
			.addText(text => text
				.setPlaceholder('tts-audio')
				.setValue(this.plugin.settings.audioFolder)
				.onChange(async (value) => {
					this.plugin.settings.audioFolder = value;
					await this.plugin.saveSettings();
				}));

		// Auto-embed setting (dependent on save audio)
		const autoEmbedSetting = new Setting(containerEl)
			.setName('Auto-embed')
			.setDesc('Automatically embed saved audio in notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoEmbed)
				.onChange(async (value) => {
					this.plugin.settings.autoEmbed = value;
					await this.plugin.saveSettings();
				}));

		// Hide dependent settings if save audio is disabled
		if (!this.plugin.settings.saveAudio) {
			audioFolderSetting.settingEl.hide();
			autoEmbedSetting.settingEl.hide();
		}

		// Text Processing Settings
		containerEl.createEl('h3', {text: 'Text processing'});

		new Setting(containerEl)
			.setName('Maximum chunk length')
			.setDesc('Maximum characters per chunk (engine limit: 500)')
			.addSlider(slider => slider
				.setLimits(100, 500, 50)
				.setValue(this.plugin.settings.maxChunkLength)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxChunkLength = value;
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
