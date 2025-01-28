# Voice Merging Guide for Kokoro TTS

This guide explains how to use the `merge_voices.py` script to combine multiple Kokoro TTS voice files (.pt) into a single voice file.

## Available Stock Voices

### American Female Voices (af_*)
- af_alloy.pt
- af_aoede.pt
- af_bella.pt
- af_jessica.pt
- af_kore.pt
- af_nicole.pt
- af_nova.pt
- af_river.pt
- af_sarah.pt
- af_sky.pt

### American Male Voices (am_*)
- am_adam.pt
- am_echo.pt
- am_eric.pt
- am_fenrir.pt
- am_liam.pt
- am_michael.pt
- am_onyx.pt
- am_puck.pt

### British Female Voices (bf_*)
- bf_alice.pt
- bf_emma.pt
- bf_isabella.pt
- bf_lily.pt

### British Male Voices (bm_*)
- bm_daniel.pt
- bm_fable.pt
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
python merge_voices.py --voices af_bella.pt af_emma.pt --output af_merged.pt
```

### 2. Three-Voice Merge
Merges three voices with equal weights (33.33% each):
```bash
python merge_voices.py --voices af_bella.pt af_sarah.pt af_nicole.pt --output af_custom.pt
```

### 3. Weighted Two-Voice Merge
Merges two voices with custom weights (70% first voice, 30% second voice):
```bash
python merge_voices.py --voices af_bella.pt af_sky.pt --weights 0.7 0.3 --output af_blend.pt
```

### 4. Weighted Three-Voice Merge
Merges three voices with custom weights (50% first voice, 30% second voice, 20% third voice):
```bash
python merge_voices.py --voices af_bella.pt af_nicole.pt af_sarah.pt --weights 0.5 0.3 0.2 --output af_mix.pt
```

### 5. Using Full Paths
When voice files are in different directories:
```bash
python merge_voices.py --voices /path/to/af_bella.pt /path/to/af_nicole.pt --output /path/to/output/af_merged.pt
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

3. **Output File Naming**
   - Custom voice files should use the appropriate prefix based on their primary characteristics:
     * af_* for American Female voices
     * am_* for American Male voices
     * bf_* for British Female voices
     * bm_* for British Male voices
   - Example: If merging female American voices, name the output like `af_custom.pt`
   - The prefix is required for the plugin to properly categorize and display the voice

4. **Output Directory**
   - The output directory will be created if it doesn't exist
   - The script will display merge details after successful completion

## Success Confirmation

After a successful merge, the script will display:
- The number of voices merged
- The output file path
- The list of input voices used
- The weights applied (either custom weights or "equal weights")
