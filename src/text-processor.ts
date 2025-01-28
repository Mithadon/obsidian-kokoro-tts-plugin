import { KokoroTTSSettings } from './settings';

interface TextSegment {
    text: string;
    type: string; // Allow for extended types like 'quoted:voice_name'
}

interface TextChunk {
    text: string;
    voice?: string;
}

interface VoiceAssignment {
    start: number;
    voice: string;
}

export class TextProcessor {
    // Regular expressions for different types of quotes
    private static readonly QUOTE_PATTERNS = [
        /[\u201C\u201D]/g,  // Smart quotes (U+201C LEFT DOUBLE QUOTATION MARK, U+201D RIGHT DOUBLE QUOTATION MARK)
        /[\u201E\u201F]/g,  // Alternative smart quotes (U+201E DOUBLE LOW-9 QUOTATION MARK, U+201F DOUBLE HIGH-REVERSED-9 QUOTATION MARK)
        /"/g,               // Straight quotes
    ];

    private voiceMap: Map<string, string> = new Map();

    constructor(private settings: KokoroTTSSettings) {
        // Initialize with default mappings
        this.updateVoiceMap();
    }

    /**
     * Updates the voice map with current voice files
     */
    public updateVoiceMap() {
        this.voiceMap.clear();
        
        // Add mappings without prefix (e.g., 'bella' -> 'af_bella')
        const addMapping = (fullName: string) => {
            // Extract the name part after the prefix and underscore
            const match = fullName.match(/^[a-z]{2}_(.+)$/);
            if (match) {
                const shortName = match[1].toLowerCase();
                this.voiceMap.set(shortName, fullName);
            }
            // Also add the full name mapping
            this.voiceMap.set(fullName.toLowerCase(), fullName);
        };

        // Add all stock voices
        ['af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 
         'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 
         'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'bf_alice', 'bf_emma', 'bf_isabella', 
         'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'].forEach(addMapping);

        // Try to get additional voices from settings
        try {
            if (this.settings.voicesPath) {
                const fs = require('fs');
                const files = fs.readdirSync(this.settings.voicesPath);
                files.forEach((file: string) => {
                    if (file.endsWith('.pt')) {
                        const voiceName = file.slice(0, -3); // Remove .pt extension
                        addMapping(voiceName);
                    }
                });
            }
        } catch (error) {
            console.error('Error loading additional voices:', error);
        }
    }

    /**
     * Pre-processes text to handle ktts prefixes and normalize quotes
     */
    private preprocessText(text: string): { text: string; voiceAssignments: VoiceAssignment[] } {
        // First normalize quotes
        let processedText = text;
        for (const pattern of TextProcessor.QUOTE_PATTERNS) {
            processedText = processedText.replace(pattern, '"');
        }

        // Find all ktts prefixes and store voice assignments
        const voiceAssignments: VoiceAssignment[] = [];
        let result = processedText;
        
        // Find and process all ktts prefixes
        const kttsRegex = /ktts([a-z]+)(?=")/gi;
        let match;
        let processedResult = result;
        let totalOffset = 0;

        // First pass: collect all voice assignments
        while ((match = kttsRegex.exec(processedText)) !== null) {
            const voiceCode = match[1].toLowerCase();
            const voice = this.getVoiceFromCode(voiceCode);
            
            voiceAssignments.push({
                start: match.index - totalOffset,
                voice: voice
            });
            
            // Calculate the length of text to remove (ktts + voice name)
            const removeLength = match[0].length;
            totalOffset += removeLength;
            
            // Remove the ktts prefix, leaving just the quote
            processedResult = processedResult.slice(0, match.index - (totalOffset - removeLength)) + 
                            processedResult.slice(match.index - (totalOffset - removeLength) + removeLength);
        }

        result = processedResult;

        return { text: result, voiceAssignments };
    }

    /**
     * Get voice from code, handling both short and full names
     */
    private getVoiceFromCode(code: string): string {
        if (!code) {
            return this.settings.selectedVoice;
        }

        // Try to find the voice in our map
        const normalizedCode = code.toLowerCase();
        const mappedVoice = this.voiceMap.get(normalizedCode);
        
        if (mappedVoice) {
            return mappedVoice;
        }

        // If not found, check if it's already a valid voice name with prefix
        const prefixMatch = normalizedCode.match(/^(af|am|bf|bm)_/);
        if (prefixMatch && this.voiceMap.has(normalizedCode)) {
            return normalizedCode;
        }

        // If code not recognized, use default voice
        return this.settings.selectedVoice;
    }

    /**
     * Splits text into segments based on quotes and asterisks
     */
    private splitIntoSegments(text: string): TextSegment[] {
        const segments: TextSegment[] = [];
        let currentText = '';
        let currentType = 'normal';  // Type will be inferred from usage
        let inQuote = false;
        let inAsterisk = false;

        // Pre-process text to handle ktts prefixes and normalize quotes
        const { text: processedText, voiceAssignments } = this.preprocessText(text);
        let currentVoiceAssignmentIndex = 0;

        let i = 0;
        while (i < processedText.length) {
            if (processedText[i] === '"') {
                // Handle quote boundaries
                if (currentText) {
                    segments.push({ text: currentText, type: currentType });
                    currentText = '';
                }
                
                inQuote = !inQuote;
                if (inQuote && currentVoiceAssignmentIndex < voiceAssignments.length && 
                    voiceAssignments[currentVoiceAssignmentIndex].start === i) {
                    // Use the assigned voice for this quote
                    currentType = `quoted:${voiceAssignments[currentVoiceAssignmentIndex].voice}`;
                    currentVoiceAssignmentIndex++;
                } else {
                    currentType = inQuote ? 'quoted' : 'normal';
                }
                i++;
                continue;
            } else if (processedText[i] === '*' && !inQuote) {
                // Handle asterisk boundaries
                if (currentText) {
                    segments.push({ text: currentText, type: currentType });
                    currentText = '';
                }
                inAsterisk = !inAsterisk;
                currentType = inAsterisk ? 'asterisk' : 'normal';
                i++;
                continue;
            }
            
            currentText += processedText[i];
            i++;
        }

        // Add any remaining text
        if (currentText) {
            segments.push({ text: currentText, type: currentType });
        }

        return segments;
    }

    /**
     * Splits text into sentences while preserving quoted sections
     */
    private splitPreservingQuotes(text: string): string[] {
        const sentences: string[] = [];
        let currentSentence = '';
        let inQuote = false;
        let buffer = '';

        for (let i = 0; i < text.length; i++) {
            buffer += text[i];

            if (text[i] === '"') {
                inQuote = !inQuote;
            }

            // Check for sentence end, but only process if we're not in a quote
            if (!inQuote && (text[i] === '.' || text[i] === '!' || text[i] === '?')) {
                // Look ahead to confirm sentence end
                const nextChar = text[i + 1] || '';
                const followingChar = text[i + 2] || '';

                // Check if this is really the end of a sentence
                if (nextChar === ' ' || nextChar === '\n' || nextChar === '') {
                    currentSentence += buffer;
                    sentences.push(currentSentence.trim());
                    currentSentence = '';
                    buffer = '';
                }
                // Handle abbreviations (e.g., "Mr.", "Dr.", "U.S.A.")
                else if (nextChar === '.' || /[a-zA-Z]/.test(nextChar)) {
                    continue;
                }
            }
        }

        // Add any remaining text
        if (buffer || currentSentence) {
            sentences.push((currentSentence + buffer).trim());
        }

        return sentences.filter(s => s.length > 0);
    }

    /**
     * Assigns voices to text segments based on settings and inline voice selection
     */
    private getVoiceForSegment(type: string): string {
        // Check for inline voice selection
        const inlineVoiceMatch = type.match(/^quoted:(.+)$/);
        if (inlineVoiceMatch) {
            return inlineVoiceMatch[1];
        }

        // Use settings-based voice selection
        if (!this.settings.useDistinctVoices) {
            return this.settings.selectedVoice;
        }

        switch (type) {
            case 'quoted':
                return this.settings.quotedTextVoice;
            case 'asterisk':
                return this.settings.asteriskTextVoice;
            default:
                return this.settings.selectedVoice;
        }
    }

    splitIntoChunks(text: string): TextChunk[] {
        // First split into paragraphs if enabled
        const paragraphs = this.settings.respectParagraphs ? 
            text.split(/\n\s*\n/) : [text];
        
        const chunks: TextChunk[] = [];
        
        // Process each paragraph separately
        for (const paragraph of paragraphs) {
            // Split paragraph into segments
            const segments = this.splitIntoSegments(paragraph);
            
            // Process each segment
            for (const segment of segments) {
                const voice = this.getVoiceForSegment(segment.type);
                const sentences = this.splitPreservingQuotes(segment.text);
                
                let currentChunk = '';
                
                for (const sentence of sentences) {
                    const trimmedSentence = sentence.trim();
                    
                    // If a single sentence exceeds max length, split it at the last space before the limit
                    if (trimmedSentence.length > this.settings.maxChunkLength) {
                        if (currentChunk) {
                            chunks.push({ text: currentChunk.trim(), voice });
                            currentChunk = '';
                        }
                        
                        let remainingSentence = trimmedSentence;
                        while (remainingSentence.length > this.settings.maxChunkLength) {
                            const lastSpace = remainingSentence.lastIndexOf(' ', this.settings.maxChunkLength);
                            if (lastSpace === -1) {
                                // No space found, force split at maxChunkLength
                                chunks.push({ 
                                    text: remainingSentence.slice(0, this.settings.maxChunkLength).trim(),
                                    voice 
                                });
                                remainingSentence = remainingSentence.slice(this.settings.maxChunkLength);
                            } else {
                                chunks.push({ 
                                    text: remainingSentence.slice(0, lastSpace).trim(),
                                    voice 
                                });
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
                        chunks.push({ text: currentChunk.trim(), voice });
                        currentChunk = trimmedSentence;
                    } else {
                        currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
                    }
                }
                
                if (currentChunk) {
                    chunks.push({ text: currentChunk.trim(), voice });
                }
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
