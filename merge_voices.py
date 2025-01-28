#!/usr/bin/env python3
import torch
import argparse
import os

def merge_voices(voice_files, weights=None):
    """
    Merge multiple voice embeddings with optional weights.
    
    Args:
        voice_files: List of paths to .pt voice files
        weights: Optional list of weights for weighted average (must sum to 1)
    
    Returns:
        Merged voice embedding tensor
    """
    voices = [torch.load(f, weights_only=True) for f in voice_files]
    if weights:
        weights = torch.tensor(weights).unsqueeze(-1)
        return (torch.stack(voices) * weights).sum(dim=0)
    return torch.mean(torch.stack(voices), dim=0)

def main():
    parser = argparse.ArgumentParser(description='Merge Kokoro TTS voice files')
    parser.add_argument('--voices', nargs='+', required=True, 
                      help='Space-separated list of voice files to merge')
    parser.add_argument('--weights', nargs='+', type=float,
                      help='Optional space-separated list of weights (must sum to 1)')
    parser.add_argument('--output', required=True,
                      help='Output file path for merged voice')
    args = parser.parse_args()
    
    # Validate inputs
    if not all(os.path.exists(f) for f in args.voices):
        raise FileNotFoundError("One or more voice files not found")
        
    if args.weights:
        if len(args.weights) != len(args.voices):
            raise ValueError("Number of weights must match number of voices")
        if abs(sum(args.weights) - 1.0) > 1e-6:
            raise ValueError("Weights must sum to 1")
    
    # Create output directory if needed
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    
    # Merge voices
    merged = merge_voices(args.voices, args.weights)
    torch.save(merged, args.output)
    print(f"Successfully merged {len(args.voices)} voices into {args.output}")
    
    # Print example usage
    weights_str = ' '.join(map(str, args.weights)) if args.weights else "equal weights"
    print("\nMerge details:")
    print(f"Voices: {', '.join(args.voices)}")
    print(f"Weights: {weights_str}")

if __name__ == '__main__':
    main()
