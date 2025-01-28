# Voice Merging Guide for Kokoro TTS

This guide explains how to use the `merge_voices.py` script to combine multiple Kokoro TTS voice files (.pt) into a single voice file.

## Available Voices

Located in `B:\Programming\Repositories\Kokoro-82M\voices`:

### American Female Voices
- af_bella.pt
- af_nicole.pt
- af_sarah.pt
- af_sky.pt
- af_sky-backup.pt
- af.pt

### American Male Voices
- am_adam.pt
- am_michael.pt

### British Female Voices
- bf_emma.pt
- bf_isabella.pt

### British Male Voices
- bm_george.pt
- bm_lewis.pt

## Basic Usage

The script requires at least two parameters:
- `--voices`: A list of voice files to merge
- `--output`: The output file path for the merged voice

Optional parameter:
- `--weights`: Custom weights for each voice (must sum to 1)

## Examples

### 1. Simple Two-Voice Merge
Merges two voices with equal weights (50% each):
```bash
python merge_voices.py --voices voice1.pt voice2.pt --output merged_voice.pt
```

### 2. Three-Voice Merge
Merges three voices with equal weights (33.33% each):
```bash
python merge_voices.py --voices voice1.pt voice2.pt voice3.pt --output merged_voice.pt
```

### 3. Weighted Two-Voice Merge
Merges two voices with custom weights (70% first voice, 30% second voice):
```bash
python merge_voices.py --voices voice1.pt voice2.pt --weights 0.7 0.3 --output merged_voice.pt
```

### 4. Weighted Three-Voice Merge
Merges three voices with custom weights (50% first voice, 30% second voice, 20% third voice):
```bash
python merge_voices.py --voices voice1.pt voice2.pt voice3.pt --weights 0.5 0.3 0.2 --output merged_voice.pt
```

### 5. Using Full Paths
When voice files are in different directories:
```bash
python merge_voices.py --voices /path/to/voice1.pt /path/to/voice2.pt --output /path/to/output/merged_voice.pt
```

## Important Notes

1. **File Requirements**
   - All voice files must be valid .pt files created with Kokoro TTS
   - Voice files must exist and be accessible

2. **Using Weights**
   - Weights are optional - if not specified, voices are merged equally
   - When using weights:
     - The number of weights must match the number of voices
     - Weights must sum exactly to 1
     - Example weights for 3 voices: 0.5 0.3 0.2 (sums to 1)

3. **Output**
   - The output directory will be created if it doesn't exist
   - The script will display merge details after successful completion

## Success Confirmation

After a successful merge, the script will display:
- The number of voices merged
- The output file path
- The list of input voices used
- The weights applied (either custom weights or "equal weights")
