import { KokoroTTSSettings } from './settings';

export class TextProcessor {
    constructor(private settings: KokoroTTSSettings) {}

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

    /**
     * Generates a unique filename for saving audio
     * @param baseName Base name for the file (usually from the note title)
     * @param index Chunk index for multi-chunk text
     * @returns Generated filename with timestamp
     */
    generateAudioFilename(baseName: string, index: number): string {
        const timestamp = Date.now();
        return `${baseName}_${timestamp}_${index}.wav`;
    }
}
