import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Menu, ButtonComponent } from 'obsidian';
import { ChildProcess } from 'child_process';
import * as path from 'path';

interface KokoroTTSSettings {
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
	
	// Text processing
	skipCodeblocks: boolean;
	handleAsterisks: boolean;
	narratorVoice: string; // For text outside quotes
	
	// Chunking settings
	maxChunkLength: number;
	chunkStrategy: 'sentence' | 'word' | 'character';
	respectParagraphs: boolean;
}

const DEFAULT_SETTINGS: KokoroTTSSettings = {
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
	
	skipCodeblocks: true,
	handleAsterisks: true,
	narratorVoice: 'af',
	
	maxChunkLength: 500,
	chunkStrategy: 'sentence',
	respectParagraphs: true
}

export default class KokoroTTSPlugin extends Plugin {
	settings: KokoroTTSSettings;
	pythonProcess: ChildProcess | null;
	ws: WebSocket | null;
	reconnectAttempts: number;
	maxReconnectAttempts: number;
	reconnectTimeout: number;
	statusBarItem: HTMLElement;
	ribbonIcon: HTMLElement;

	async onload() {
		await this.loadSettings();

		// Set default backend path if not set
		if (!this.settings.backendPath) {
			// Get the vault path
			const vaultPath = (this.app.vault.adapter as any).getBasePath();
			// Construct path to the plugin's installation directory
			this.settings.backendPath = path.join(vaultPath, '.obsidian', 'plugins', 'kokoro-tts', 'kokoro_backend.py');
			await this.saveSettings();
		}

		// Initialize WebSocket properties
		this.ws = null;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 5;
		this.reconnectTimeout = 1000;  // Start with 1 second

		// Add ribbon icon to show status
		this.ribbonIcon = this.addRibbonIcon('sound', 'Kokoro TTS', (evt: MouseEvent) => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				new Notice('Kokoro TTS is running');
			} else {
				new Notice('Kokoro TTS is not running. Start it in settings.');
			}
		});
		this.updateRibbonIcon();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Add commands
		this.addCommand({
			id: 'read-selected-text',
			name: 'Read Selected Text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (selectedText) {
					this.speakText(selectedText);
				} else {
					new Notice('No text selected');
				}
			}
		});

		this.addCommand({
			id: 'read-whole-page',
			name: 'Read Whole Page',
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					const content = view.getViewData();
					this.speakText(content);
				}
			}
		});

		this.addCommand({
			id: 'stop-speech',
			name: 'Stop Speech',
			callback: () => {
				this.stopSpeech();
			}
		});

		// Add settings tab
		this.addSettingTab(new KokoroTTSSettingTab(this.app, this));

		// Add context menu items
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				if (editor.getSelection()) {
					menu.addItem((item) => {
						item
							.setTitle("Kokoro TTS: Read Selected Text")
							.setIcon("sound")
							.onClick(async () => {
								await this.speakText(editor.getSelection());
							});
					});
				}
				menu.addItem((item) => {
					item
						.setTitle("Kokoro TTS: Read Whole File")
						.setIcon("sound")
						.onClick(async () => {
							await this.speakText(editor.getValue());
						});
				});
			})
		);
	}

	onunload() {
		this.stopSpeech();
		this.stopBackend();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateRibbonIcon() {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ribbonIcon.addClass('kokoro-tts-running');
		} else {
			this.ribbonIcon.removeClass('kokoro-tts-running');
		}
	}

	updateStatusBar() {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.statusBarItem.setText('Kokoro TTS: Running');
		} else {
			this.statusBarItem.setText('Kokoro TTS: Stopped');
		}
	}

	async startBackend() {
		// Validate required paths
		if (!this.settings.modelPath) {
			throw new Error('Model path not set. Please configure it in settings.');
		}
		if (!this.settings.voicesPath) {
			throw new Error('Voices path not set. Please configure it in settings.');
		}
		if (!this.settings.backendPath) {
			throw new Error('Backend script not found. Please check installation.');
		}

		try {
			// Start Python backend process
			const { spawn } = require('child_process');
			this.pythonProcess = spawn(this.settings.pythonPath, [
				this.settings.backendPath,
				this.settings.modelPath,
				this.settings.voicesPath
			]);

			// Handle process events
			if (!this.pythonProcess) {
				throw new Error('Failed to start Python process');
			}

			if (this.pythonProcess.stderr) {
				this.pythonProcess.stderr.on('data', (data: Buffer) => {
					console.log('TTS Backend:', data.toString());
				});
			}

			this.pythonProcess.on('error', (error: Error) => {
				console.error('Failed to start TTS backend:', error);
				new Notice(`Failed to start TTS backend: ${error.message}`);
				this.updateRibbonIcon();
				this.updateStatusBar();
			});

			// Wait for server to start
			await new Promise(resolve => setTimeout(resolve, 2000));

			// Connect WebSocket
			await this.connectWebSocket();

		} catch (error) {
			console.error('Error starting backend:', error);
			throw error;
		}
	}

	async connectWebSocket() {
		if (this.ws?.readyState === WebSocket.OPEN) {
			return;
		}

		try {
			this.ws = new WebSocket(`ws://localhost:${this.settings.serverPort}`);

			this.ws.onopen = () => {
				console.log('Connected to TTS backend');
				this.reconnectAttempts = 0;
				this.reconnectTimeout = 1000;
				this.updateRibbonIcon();
				this.updateStatusBar();
				new Notice('Kokoro TTS backend connected');

				// Send a ping to verify connection
				this.ws?.send(JSON.stringify({ action: 'ping' }));
			};

			this.ws.onclose = () => {
				console.log('Disconnected from TTS backend');
				this.ws = null;
				this.updateRibbonIcon();
				this.updateStatusBar();
				new Notice('Kokoro TTS backend disconnected');

				// Try to reconnect if not shutting down
				if (this.pythonProcess && this.reconnectAttempts < this.maxReconnectAttempts) {
					setTimeout(() => {
						this.reconnectAttempts++;
						this.reconnectTimeout *= 2;  // Exponential backoff
						this.connectWebSocket();
					}, this.reconnectTimeout);
				}
			};

			this.ws.onerror = (error) => {
				// Only show error notice if we weren't trying to stop
				if (this.pythonProcess) {
					console.error('WebSocket error:', error);
					this.ws?.close();  // Force close on error
					this.ws = null;
					this.updateRibbonIcon();
					this.updateStatusBar();
					new Notice('Kokoro TTS backend connection error');
				}
			};

			this.ws.onmessage = (event) => {
				try {
					const response = JSON.parse(event.data);
					
					switch (response.status) {
						case 'pong':
							console.log('Backend connection verified:', response.message);
							break;
						case 'generating':
							new Notice('Generating speech...');
							break;
						case 'generated':
							new Notice('Speech generated');
							break;
						case 'error':
							new Notice(`Error: ${response.message}`);
							break;
						case 'stopped':
							new Notice('Speech stopped');
							break;
					}
					
				} catch (error) {
					console.error('Error handling message:', error);
				}
			};

		} catch (error) {
			console.error('Error connecting to WebSocket:', error);
			throw error;
		}
	}

	async stopBackend() {
		try {
			// Try to send stop command
			if (this.ws?.readyState === WebSocket.OPEN) {
				await new Promise<void>((resolve) => {
					this.ws?.send(JSON.stringify({ action: 'stop' }));
					setTimeout(resolve, 100);  // Give it time to process
				});
			}

			// Close WebSocket
			if (this.ws) {
				this.ws.close();
				this.ws = null;
			}

			// Kill Python process
			if (this.pythonProcess) {
				this.pythonProcess.kill();
				await new Promise<void>((resolve) => {
					// Wait for process to exit
					this.pythonProcess?.on('exit', () => {
						this.pythonProcess = null;
						resolve();
					});
					// Fallback if process doesn't exit
					setTimeout(() => {
						this.pythonProcess = null;
						resolve();
					}, 1000);
				});
			}

			this.updateRibbonIcon();
			this.updateStatusBar();
			new Notice('Kokoro TTS backend stopped');
		} catch (error) {
			console.error('Error stopping backend:', error);
			new Notice('Error stopping Kokoro TTS backend');
			
			// Force cleanup
			this.ws = null;
			this.pythonProcess = null;
			this.updateRibbonIcon();
			this.updateStatusBar();
		}
	}

	// Split text into chunks based on settings
	splitIntoChunks(text: string): string[] {
		// Split text into paragraphs if enabled
		const paragraphs = this.settings.respectParagraphs ? 
			text.split(/\n\s*\n/) : [text];
		
		const chunks: string[] = [];
		
		for (const paragraph of paragraphs) {
			let units: string[] = [];
			
			// Split based on strategy
			switch (this.settings.chunkStrategy) {
				case 'sentence':
					units = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
					break;
				case 'word':
					units = paragraph.match(/\S+/g) || [paragraph];
					break;
				case 'character':
					units = paragraph.match(/.{1,100}/g) || [paragraph];
					break;
			}
			
			let currentChunk = '';
			
			for (const unit of units) {
				if (currentChunk.length + unit.length > this.settings.maxChunkLength) {
					if (currentChunk) {
						chunks.push(currentChunk.trim());
					}
					currentChunk = unit;
				} else {
					currentChunk += (currentChunk ? ' ' : '') + unit;
				}
			}
			
			if (currentChunk) {
				chunks.push(currentChunk.trim());
			}
		}
		
		return chunks;
	}

	async speakText(text: string) {
		try {
			// Validate connection
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				throw new Error('TTS backend not connected');
			}

			// Get current file path for saving audio
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				throw new Error('No active file');
			}

			// Process text based on settings
			let processedText = text;
			if (this.settings.skipCodeblocks) {
				processedText = processedText.replace(/```[\s\S]*?```/g, '');
			}
			if (this.settings.handleAsterisks) {
				processedText = processedText.replace(/\*(.*?)\*/g, ' $1 ');
			}

			// Split into chunks
			const chunks = this.splitIntoChunks(processedText);
			console.log(`Split text into ${chunks.length} chunks`);

			// Process each chunk
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				
				// Prepare save path
				let savePath: string | undefined;
				let relativePath: string | undefined;
				
				if (this.settings.saveAudio) {
					const timestamp = Date.now();
					const fileName = `${activeFile.basename}_${timestamp}_${i}.wav`;
					
					// Determine save location
					let saveFolder: string;
					let relativeFolder: string;
					
					if (this.settings.audioFolder) {
						// Use specified audio folder
						saveFolder = path.join(
							(this.app.vault.adapter as any).getBasePath(),
							this.settings.audioFolder
						);
						relativeFolder = this.settings.audioFolder;
						
						// Create audio folder if it doesn't exist
						await this.app.vault.adapter.mkdir(this.settings.audioFolder);
					} else {
						// Save in the same folder as the note
						const parentFolder = activeFile.parent?.path || '';
						saveFolder = path.join(
							(this.app.vault.adapter as any).getBasePath(),
							parentFolder
						);
						relativeFolder = parentFolder;
						
						// Ensure parent folder exists
						if (parentFolder) {
							await this.app.vault.adapter.mkdir(parentFolder);
						}
					}
					
					// Create full paths (use forward slashes for both Windows and Unix)
					savePath = saveFolder + '/' + fileName;
					relativePath = relativeFolder ? relativeFolder + '/' + fileName : fileName;
					
					// Log paths for debugging
					console.log('Save path:', savePath);
					console.log('Relative path:', relativePath);
					console.log('Base path:', (this.app.vault.adapter as any).getBasePath());
				}

				// Send speak command
				const command = {
					action: 'speak',
					text: chunk,
					voice: this.settings.selectedVoice,
					save_path: savePath,
					autoplay: this.settings.autoPlay
				};

				this.ws.send(JSON.stringify(command));

				// Wait for completion before sending next chunk
				await new Promise((resolve, reject) => {
					const handler = (event: MessageEvent) => {
						const response = JSON.parse(event.data);
						if (response.status === 'generated') {
							this.ws?.removeEventListener('message', handler);
							
							// If audio was saved and auto-embed is enabled, embed it in the note
							if (relativePath && this.settings.autoEmbed) {
								const editor = this.app.workspace.activeEditor?.editor;
								if (editor) {
									const cursor = editor.getCursor();
									const embedText = `\n![[${relativePath}]]\n`;
									editor.replaceRange(embedText, cursor);
								}
							}
							
							resolve(null);
						} else if (response.status === 'error') {
							this.ws?.removeEventListener('message', handler);
							reject(new Error(response.message));
						}
					};
					this.ws?.addEventListener('message', handler);
				});
			}

		} catch (error) {
			new Notice(`Error: ${error.message}`);
			console.error('TTS Error:', error);
		}
	}

	stopSpeech() {
		try {
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ action: 'stop' }));
				new Notice('Speech stopped');
			}
		} catch (error) {
			new Notice(`Error stopping speech: ${error.message}`);
			console.error('Stop Error:', error);
		}
	}
}

class KokoroTTSSettingTab extends PluginSettingTab {
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

		// Backend Status and Control
		containerEl.createEl('h3', {text: 'Backend status'});
		
		this.backendStatus = containerEl.createEl('div', {
			text: this.plugin.ws?.readyState === WebSocket.OPEN ? 'Running' : 'Stopped',
			cls: this.plugin.ws?.readyState === WebSocket.OPEN ? 'kokoro-tts-status-running' : 'kokoro-tts-status-stopped'
		});

		new Setting(containerEl)
			.setName('Backend control')
			.setDesc('Start or stop the TTS backend')
			.addButton(button => button
				.setButtonText(this.plugin.ws?.readyState === WebSocket.OPEN ? 'Stop backend' : 'Start backend')
				.onClick(async () => {
					try {
						if (this.plugin.ws?.readyState === WebSocket.OPEN) {
							this.plugin.stopBackend();
							button.setButtonText('Start backend');
							this.backendStatus.textContent = 'Stopped';
							this.backendStatus.className = 'kokoro-tts-status-stopped';
						} else {
							try {
								await this.plugin.startBackend();
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
			.setDesc('Path to Python executable')
			.addText(text => text
				.setPlaceholder('python')
				.setValue(this.plugin.settings.pythonPath)
				.onChange(async (value) => {
					this.plugin.settings.pythonPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model path')
			.setDesc('Path to Kokoro model file (kokoro-v0_19.pth)')
			.addText(text => text
				.setPlaceholder('Path to model file')
				.setValue(this.plugin.settings.modelPath)
				.onChange(async (value) => {
					this.plugin.settings.modelPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Voices path')
			.setDesc('Path to voices directory')
			.addText(text => text
				.setPlaceholder('Path to voices directory')
				.setValue(this.plugin.settings.voicesPath)
				.onChange(async (value) => {
					this.plugin.settings.voicesPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Backend path')
			.setDesc('Path to kokoro_backend.py (leave blank for default installation path)')
			.addText(text => text
				.setPlaceholder('Path to kokoro_backend.py')
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

		// Text Processing Settings
		containerEl.createEl('h3', {text: 'Text processing'});

		new Setting(containerEl)
			.setName('Skip codeblocks')
			.setDesc('Skip reading code blocks')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.skipCodeblocks)
				.onChange(async (value) => {
					this.plugin.settings.skipCodeblocks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Handle asterisks')
			.setDesc('Process text between asterisks as emphasis')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.handleAsterisks)
				.onChange(async (value) => {
					this.plugin.settings.handleAsterisks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Narrator voice')
			.setDesc('Voice for text outside quotes')
			.addDropdown(dropdown => dropdown
				.addOption('af', 'Default (Bella & Sarah Mix)')
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
				.setValue(this.plugin.settings.narratorVoice)
				.onChange(async (value) => {
					this.plugin.settings.narratorVoice = value;
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
