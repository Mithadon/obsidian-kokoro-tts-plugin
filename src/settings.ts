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
	speed: number;
	
	// Special text voice settings
	useDistinctVoices: boolean;
	quotedTextVoice: string;
	asteriskTextVoice: string;
	
	// Audio settings
	autoPlay: boolean;
	saveAudio: boolean;
	audioFolder: string;
	autoEmbed: boolean;
	
	// Chunking settings
	maxChunkLength: number;
	respectParagraphs: boolean;
	trimSilence: boolean;
	trimAmount: number;  // Amount in seconds to trim from start/end
}

export const DEFAULT_SETTINGS: KokoroTTSSettings = {
	pythonPath: 'python',
	modelPath: '',
	voicesPath: '',
	backendPath: '',
	serverPort: 7851,
	
	selectedVoice: 'af_bella', // Default voice
	speed: 1.0, // Default speed
	
	useDistinctVoices: false,
	quotedTextVoice: 'af_bella', // Default to same as main voice
	asteriskTextVoice: 'af_bella', // Default to same as main voice
	
	autoPlay: true,
	saveAudio: false,
	audioFolder: '',  // Empty string means save in same folder as note
	autoEmbed: false,
	
	maxChunkLength: 500,
	respectParagraphs: true,
	trimSilence: false,
	trimAmount: 0.1  // Default to 0.1 seconds
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
			.setName('Speech speed')
			.setDesc('Adjust the speed of speech (0.5 = half speed, 2.0 = double speed)')
			.addSlider(slider => slider
				.setLimits(0.5, 2.0, 0.1)
				.setValue(this.plugin.settings.speed)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.speed = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h4', {text: 'Voice Selection'});

		// Voice selection with refresh button
		const voiceContainer = containerEl.createDiv('voice-selection-container');
		
		const voiceSetting = new Setting(voiceContainer)
			.setName('Voice')
			.setDesc('Select TTS voice or a voice mix preset')
			.addDropdown(async (dropdown) => {
				try {
					// Get available voices from backend
					const voices = await this.plugin.backend.getAvailableVoices();
					
					// Add all available voices
					voices.forEach(voice => {
						dropdown.addOption(voice.id, voice.display);
					});
					
					dropdown.setValue(this.plugin.settings.selectedVoice);
					
					dropdown.onChange(async (value) => {
						this.plugin.settings.selectedVoice = value;
						await this.plugin.saveSettings();
					});
				} catch (error) {
					console.error('Error loading voices:', error);
					// Add default voice as fallback
					dropdown.addOption('af_bella', 'Bella [US Female]');
					dropdown.setValue('af_bella');
					new Notice('Failed to load voices. Please ensure the backend is running.');
				}
			});

		// Add refresh button next to voice dropdown
		voiceSetting.addButton((button) => {
			return button
				.setIcon('refresh-cw')
				.setTooltip('Refresh voice list')
				.onClick(async () => {
					try {
						// Get fresh voice list
						const voices = await this.plugin.backend.getAvailableVoices(true);
						
						// Update main voice dropdown
						const mainDropdown = voiceSetting.components[0] as any;
						mainDropdown.selectEl.empty();
						voices.forEach(voice => {
							mainDropdown.addOption(voice.id, voice.display);
						});
						
						// Keep current selection if it still exists, otherwise use first voice
						const currentVoice = this.plugin.settings.selectedVoice;
						if (voices.some(v => v.id === currentVoice)) {
							mainDropdown.setValue(currentVoice);
						} else if (voices.length > 0) {
							mainDropdown.setValue(voices[0].id);
							this.plugin.settings.selectedVoice = voices[0].id;
							await this.plugin.saveSettings();
						}

						// Update quoted text voice dropdown if visible
						if (this.plugin.settings.useDistinctVoices) {
							const quotedDropdown = quotedTextVoiceSetting.components[0] as any;
							quotedDropdown.selectEl.empty();
							voices.forEach(voice => {
								quotedDropdown.addOption(voice.id, voice.display);
							});
							const currentQuotedVoice = this.plugin.settings.quotedTextVoice;
							if (voices.some(v => v.id === currentQuotedVoice)) {
								quotedDropdown.setValue(currentQuotedVoice);
							} else if (voices.length > 0) {
								quotedDropdown.setValue(voices[0].id);
								this.plugin.settings.quotedTextVoice = voices[0].id;
								await this.plugin.saveSettings();
							}

							// Update asterisk text voice dropdown
							const asteriskDropdown = asteriskTextVoiceSetting.components[0] as any;
							asteriskDropdown.selectEl.empty();
							voices.forEach(voice => {
								asteriskDropdown.addOption(voice.id, voice.display);
							});
							const currentAsteriskVoice = this.plugin.settings.asteriskTextVoice;
							if (voices.some(v => v.id === currentAsteriskVoice)) {
								asteriskDropdown.setValue(currentAsteriskVoice);
							} else if (voices.length > 0) {
								asteriskDropdown.setValue(voices[0].id);
								this.plugin.settings.asteriskTextVoice = voices[0].id;
								await this.plugin.saveSettings();
							}
						}
						
						// Update text processor's voice map
						this.plugin.textProcessor.updateVoiceMap();
						new Notice('Voice list refreshed');
					} catch (error) {
						console.error('Error refreshing voices:', error);
						new Notice('Failed to refresh voices. Please ensure the backend is running.');
					}
				});
		});

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

		// Special Text Voice Settings
		containerEl.createEl('h3', {text: 'Special text voices'});

		// Add explanation of inline voice selection
		const inlineVoiceInfo = containerEl.createEl('div', {
			cls: 'setting-item-description',
		});
		inlineVoiceInfo.createEl('p', {
			text: 'You can specify voices for quoted text using the ktts prefix:',
		});
		inlineVoiceInfo.createEl('p', {
			text: '- kttsbella"Hello" → Uses Bella\'s voice',
		});
		inlineVoiceInfo.createEl('p', {
			text: '- kttsemma"Hi there" → Uses Emma\'s voice',
		});
		inlineVoiceInfo.createEl('p', {
			text: 'Available voice codes:',
		});
		inlineVoiceInfo.createEl('p', {
			text: '- US Female voices: alloy, aoede, bella, jessica, kore, nicole, nova, river, sarah, sky',
		});
		inlineVoiceInfo.createEl('p', {
			text: '- US Male voices: adam, echo, eric, fenrir, liam, michael, onyx, puck',
		});
		inlineVoiceInfo.createEl('p', {
			text: '- UK Female voices: alice, emma, isabella, lily',
		});
		inlineVoiceInfo.createEl('p', {
			text: '- UK Male voices: daniel, fable, george, lewis',
		});
		inlineVoiceInfo.createEl('p', {
			text: 'Any unrecognized voice code (e.g., kttsxyz) will use the default selected voice.',
		});

		containerEl.createEl('br');

		const useDistinctVoicesSetting = new Setting(containerEl)
			.setName('Use distinct voices')
			.setDesc('Enable different voices for quoted and emphasized text')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useDistinctVoices)
				.onChange(async (value) => {
					this.plugin.settings.useDistinctVoices = value;
					// Show/hide dependent settings
					if (value) {
						quotedTextVoiceSetting.settingEl.show();
						asteriskTextVoiceSetting.settingEl.show();
					} else {
						quotedTextVoiceSetting.settingEl.hide();
						asteriskTextVoiceSetting.settingEl.hide();
					}
					await this.plugin.saveSettings();
				}));

		// Voice for quoted text with refresh button
		const quotedTextVoiceSetting = new Setting(containerEl)
			.setName('Quoted text voice')
			.setDesc('Voice used for text within quotation marks')
			.addDropdown(async (dropdown) => {
				try {
					const voices = await this.plugin.backend.getAvailableVoices();
					voices.forEach(voice => {
						dropdown.addOption(voice.id, voice.display);
					});
					dropdown.setValue(this.plugin.settings.quotedTextVoice);
					dropdown.onChange(async (value) => {
						this.plugin.settings.quotedTextVoice = value;
						await this.plugin.saveSettings();
					});
				} catch (error) {
					console.error('Error loading voices for quoted text:', error);
					dropdown.addOption('af_bella', 'Bella [US Female]');
					dropdown.setValue('af_bella');
				}
			});

		// Voice for asterisk text with refresh button
		const asteriskTextVoiceSetting = new Setting(containerEl)
			.setName('Emphasized text voice')
			.setDesc('Voice used for text within asterisks')
			.addDropdown(async (dropdown) => {
				try {
					const voices = await this.plugin.backend.getAvailableVoices();
					voices.forEach(voice => {
						dropdown.addOption(voice.id, voice.display);
					});
					dropdown.setValue(this.plugin.settings.asteriskTextVoice);
					dropdown.onChange(async (value) => {
						this.plugin.settings.asteriskTextVoice = value;
						await this.plugin.saveSettings();
					});
				} catch (error) {
					console.error('Error loading voices for emphasized text:', error);
					dropdown.addOption('af_bella', 'Bella [US Female]');
					dropdown.setValue('af_bella');
				}
			});

		// Hide voice settings if distinct voices are disabled
		if (!this.plugin.settings.useDistinctVoices) {
			quotedTextVoiceSetting.settingEl.hide();
			asteriskTextVoiceSetting.settingEl.hide();
		}

		// Text Processing Settings
		containerEl.createEl('h3', {text: 'Text processing'});

		new Setting(containerEl)
			.setName('Trim silence')
			.setDesc('Remove silence from the start and end of each voice segment (experimental)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.trimSilence)
				.onChange(async (value) => {
					this.plugin.settings.trimSilence = value;
					trimAmountSetting.settingEl.toggle(value);
					await this.plugin.saveSettings();
				}));

		const trimAmountSetting = new Setting(containerEl)
			.setName('Trim amount')
			.setDesc('Amount of audio (in seconds) to trim from start and end')
			.addSlider(slider => slider
				.setLimits(0.05, 0.3, 0.05)
				.setValue(this.plugin.settings.trimAmount)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.trimAmount = value;
					await this.plugin.saveSettings();
				}));

		if (!this.plugin.settings.trimSilence) {
			trimAmountSetting.settingEl.hide();
		}


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
