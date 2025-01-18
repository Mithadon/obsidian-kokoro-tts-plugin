import { App, Editor, MarkdownView, Notice, Plugin, Menu } from 'obsidian';
import * as path from 'path';
import { KokoroTTSSettings, DEFAULT_SETTINGS, KokoroTTSSettingTab } from './settings';
import { BackendManager } from './backend';
import { TextProcessor } from './text-processor';

export default class KokoroTTSPlugin extends Plugin {
	settings: KokoroTTSSettings;
	backend: BackendManager;
	textProcessor: TextProcessor;
	statusBarItem: HTMLElement;
	ribbonIcon: HTMLElement;

	async onload() {
		try {
			await this.loadSettings();

			// Initialize components
			this.backend = new BackendManager(this.settings, () => {
				this.updateRibbonIcon();
				this.updateStatusBar();
			});
			this.textProcessor = new TextProcessor(this.settings);

			// Add ribbon icon to show status
			this.ribbonIcon = this.addRibbonIcon('sound', 'Kokoro TTS', (evt: MouseEvent) => {
				if (this.backend.isConnected) {
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
					this.backend.stopSpeech();
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
		} catch (error) {
			console.error('Error initializing plugin UI:', error);
			// Don't throw, allow plugin to be enabled even if UI fails
			new Notice('Warning: Some plugin features may not be available');
		}
	}

	onunload() {
		try {
			this.backend.stopSpeech();
			this.backend.stopBackend();
		} catch (error) {
			console.error('Error during plugin unload:', error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateRibbonIcon() {
		try {
			if (this.ribbonIcon) {
				if (this.backend.isConnected) {
					this.ribbonIcon.addClass('kokoro-tts-running');
				} else {
					this.ribbonIcon.removeClass('kokoro-tts-running');
				}
			}
		} catch (error) {
			console.error('Error updating ribbon icon:', error);
		}
	}

	updateStatusBar() {
		try {
			if (this.statusBarItem) {
				if (this.backend.isConnected) {
					this.statusBarItem.setText('Kokoro TTS: Running');
				} else {
					this.statusBarItem.setText('Kokoro TTS: Stopped');
				}
			}
		} catch (error) {
			console.error('Error updating status bar:', error);
		}
	}

	async speakText(text: string) {
		try {
			// Get current file path for saving audio
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				throw new Error('No active file');
			}

			// Split into chunks
			const chunks = this.textProcessor.splitIntoChunks(text);
			console.log(`Split text into ${chunks.length} chunks`);

			// Process each chunk
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				
				// Prepare save path
				let savePath: string | undefined;
				let relativePath: string | undefined;
				
				if (this.settings.saveAudio) {
					const fileName = this.textProcessor.generateAudioFilename(activeFile.basename, i);
					
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

				// Send speak command and wait for completion
				await this.backend.speakText(chunk, savePath);

				// If audio was saved and auto-embed is enabled, embed it in the note
				if (relativePath && this.settings.autoEmbed) {
					const editor = this.app.workspace.activeEditor?.editor;
					if (editor) {
						const cursor = editor.getCursor();
						const embedText = `\n![[${relativePath}]]\n`;
						editor.replaceRange(embedText, cursor);
					}
				}
			}

		} catch (error) {
			new Notice(`Error: ${error.message}`);
			console.error('TTS Error:', error);
		}
	}
}
