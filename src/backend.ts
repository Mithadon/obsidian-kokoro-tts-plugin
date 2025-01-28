import { Notice } from 'obsidian';
import { ChildProcess } from 'child_process';
import { KokoroTTSSettings } from './settings';
import { TextProcessor } from './text-processor';
import * as fs from 'fs';
import * as path from 'path';

export class BackendManager {
    private ws: WebSocket | null = null;
    private pythonProcess: ChildProcess | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectTimeout = 1000;  // Start with 1 second

    private textProcessor: TextProcessor;

    constructor(
        private settings: KokoroTTSSettings,
        private onStatusChange: () => void
    ) {
        this.textProcessor = new TextProcessor(settings);
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    get webSocket(): WebSocket | null {
        return this.ws;
    }

    async startBackend(): Promise<void> {
        // Validate required paths
        if (!this.settings.modelPath) {
            throw new Error('Model path not set. Please set the full path to the Kokoro model file in settings.');
        }
        if (!this.settings.voicesPath) {
            throw new Error('Voices path not set. Please set the full path to the voices directory in settings.');
        }
        if (!this.settings.backendPath) {
            throw new Error('Backend script path not set. Please set the full path to kokoro_backend.py in settings.');
        }

        try {
            // Save settings to a temporary file for the backend to access
            const settingsPath = path.join(path.dirname(this.settings.backendPath), 'kokoro_settings.json');
            console.log('Writing settings to:', settingsPath);
            console.log('Settings content:', JSON.stringify(this.settings, null, 2));
            await fs.promises.writeFile(settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
            console.log('Settings file written successfully');

            // Start Python backend process
            const { spawn } = require('child_process');
            this.pythonProcess = spawn(this.settings.pythonPath, [
                this.settings.backendPath,
                this.settings.modelPath,
                this.settings.voicesPath,
                settingsPath  // Pass settings file path as argument
            ]);

            // Handle process events
            if (!this.pythonProcess) {
                throw new Error('Failed to start Python process. Please verify your Python path in settings.');
            }

            if (this.pythonProcess.stdout) {
                this.pythonProcess.stdout.on('data', (data: Buffer) => {
                    console.log('TTS Backend stdout:', data.toString());
                });
            }

            if (this.pythonProcess.stderr) {
                this.pythonProcess.stderr.on('data', (data: Buffer) => {
                    console.log('TTS Backend stderr:', data.toString());
                });
            }

            this.pythonProcess.on('error', (error: Error) => {
                console.error('Failed to start TTS backend:', error);
                new Notice(`Failed to start TTS backend: ${error.message}`);
                this.onStatusChange();
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

    async connectWebSocket(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            this.ws = new WebSocket(`ws://localhost:${this.settings.serverPort}`);

            this.ws.onopen = () => {
                console.log('Connected to TTS backend');
                this.reconnectAttempts = 0;
                this.reconnectTimeout = 1000;
                this.onStatusChange();
                new Notice('Kokoro TTS backend connected');

                // Send a ping to verify connection
                this.ws?.send(JSON.stringify({ action: 'ping' }));
            };

            this.ws.onclose = () => {
                console.log('Disconnected from TTS backend');
                this.ws = null;
                this.onStatusChange();
                
                // Only show disconnect notice if we were previously connected
                if (this.reconnectAttempts > 0) {
                    new Notice('Kokoro TTS backend disconnected');
                }

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
                    this.onStatusChange();
                    new Notice('Failed to connect to TTS backend. Please check your settings and try starting the backend again.');
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
                            // Don't show individual chunk completion notices
                            break;
                        case 'session_stats':
                            new Notice(response.message);
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

    async stopBackend(): Promise<void> {
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

            // Clean up settings file
            try {
                const settingsPath = path.join(path.dirname(this.settings.backendPath), 'kokoro_settings.json');
                await fs.promises.unlink(settingsPath);
            } catch (error) {
                console.error('Error cleaning up settings file:', error);
            }

            this.onStatusChange();
            new Notice('Kokoro TTS backend stopped');
        } catch (error) {
            console.error('Error stopping backend:', error);
            new Notice('Error stopping Kokoro TTS backend');
            
            // Force cleanup
            this.ws = null;
            this.pythonProcess = null;
            this.onStatusChange();
        }
    }

    async speakText(chunks: { text: string; voice: string }[], savePath?: string): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('TTS backend not connected. Please start the backend in settings first.');
        }

        // Start a new generation session
        const sessionId = Date.now().toString();
        const command = {
            action: 'start_session',
            session_id: sessionId,
            total_chunks: chunks.length,
            save_path: savePath,
            autoplay: this.settings.autoPlay
        };
        this.ws.send(JSON.stringify(command));

        // Process each chunk
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk.text.trim()) continue;

            const isLastChunk = i === chunks.length - 1;
            
            const chunkCommand = {
                action: 'speak',
                session_id: sessionId,
                text: chunk.text.trim(),
                voice: chunk.voice,
                speed: this.settings.speed,
                chunk_index: i,
                is_last_chunk: isLastChunk,
                trim_silence: this.settings.trimSilence,
                trim_amount: this.settings.trimAmount
            };

            this.ws.send(JSON.stringify(chunkCommand));

            // Wait for completion of each chunk
            await new Promise<void>((resolve, reject) => {
                const handler = (event: MessageEvent) => {
                    const response = JSON.parse(event.data);
                    if (response.status === 'generated') {
                        this.ws?.removeEventListener('message', handler);
                        resolve();
                    } else if (response.status === 'error') {
                        this.ws?.removeEventListener('message', handler);
                        reject(new Error(response.message));
                    }
                };
                this.ws?.addEventListener('message', handler);
            });
        }
    }

    stopSpeech(): void {
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
