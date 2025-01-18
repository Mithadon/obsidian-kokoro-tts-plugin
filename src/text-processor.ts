import { KokoroTTSSettings } from './settings';

export class TextProcessor {
    constructor(private settings: KokoroTTSSettings) {}

    splitIntoChunks(text: string): string[] {
        // Split text into paragraphs if enabled
        const paragraphs = this.settings.respectParagraphs ? 
            text.split(/\n\s*\n/) : [text];
        
        const chunks: string[] = [];
        
        for (const paragraph of paragraphs) {
            // Split into sentences using a more robust regex that handles common abbreviations
            const sentences = paragraph.match(/[^.!?]+(?:[.!?]+(?:(?=[A-Z]|\s+|$)|(?=[a-z]+\.|$)))/g) || [paragraph];
            
            let currentChunk = '';
            
            for (const sentence of sentences) {
                const trimmedSentence = sentence.trim();
                
                // If a single sentence exceeds max length, split it at the last space before the limit
                if (trimmedSentence.length > this.settings.maxChunkLength) {
                    if (currentChunk) {
                        chunks.push(currentChunk.trim());
                        currentChunk = '';
                    }
                    
                    let remainingSentence = trimmedSentence;
                    while (remainingSentence.length > this.settings.maxChunkLength) {
                        const lastSpace = remainingSentence.lastIndexOf(' ', this.settings.maxChunkLength);
                        if (lastSpace === -1) {
                            // No space found, force split at maxChunkLength
                            chunks.push(remainingSentence.slice(0, this.settings.maxChunkLength).trim());
                            remainingSentence = remainingSentence.slice(this.settings.maxChunkLength);
                        } else {
                            chunks.push(remainingSentence.slice(0, lastSpace).trim());
                            remainingSentence = remainingSentence.slice(lastSpace + 1);
                        }
                    }
                    if (remainingSentence) {
                        currentChunk = remainingSentence;
                    }
                    continue;
                }
                
                // Check if adding this sentence would exceed the chunk length
                if (currentChunk.length + trimmedSentence.length + 1 > this.settings.maxChunkLength) {
                    chunks.push(currentChunk.trim());
                    currentChunk = trimmedSentence;
                } else {
                    currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
                }
            }
            
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
        }
        
        return chunks;
    }

    /**
     * Generates a unique filename for saving audio
     * @param baseName Base name for the file (usually from the note title)
     * @returns Generated filename with timestamp
     */
    generateAudioFilename(baseName: string): string {
        const timestamp = Date.now();
        return `${baseName}_${timestamp}.wav`;
    }
}
