#!/usr/bin/env python3
import sys
import json
import torch
import os
from pathlib import Path
import asyncio
import websockets
import logging
import signal

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)

# Set espeak-ng environment variables for Windows
os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = r"C:\Program Files\eSpeak NG\libespeak-ng.dll"
os.environ["PHONEMIZER_ESPEAK_PATH"] = r"C:\Program Files\eSpeak NG\espeak-ng.exe"

# Get Kokoro root from first argument
if len(sys.argv) < 3:
    logging.error("Usage: kokoro_backend.py <model_path> <voices_path>")
    sys.exit(1)

kokoro_root = os.path.dirname(os.path.abspath(sys.argv[1]))
sys.path.append(kokoro_root)

try:
    from models import build_model
    from kokoro import generate
    logging.info("Imported Kokoro modules")
except ImportError as e:
    logging.error(f"Could not import Kokoro modules from {kokoro_root}")
    raise

class KokoroTTSBackend:
    def __init__(self, model_path, voices_path):
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        logging.info(f"Using device: {self.device}")
        
        # Load model
        try:
            self.model = build_model(model_path, self.device)
            logging.info("Model loaded")
        except Exception as e:
            logging.error(f"Failed to load model: {str(e)}")
            raise
        
        # Load voices
        self.voices = {}
        voices_dir = Path(voices_path)
        for voice_file in voices_dir.glob("*.pt"):
            voice_name = voice_file.stem
            self.voices[voice_name] = torch.load(voice_file, weights_only=True).to(self.device)
        logging.info(f"Loaded {len(self.voices)} voices")
        
        self.current_audio = None
        self.stop_event = asyncio.Event()
        
    def get_language(self, voice_name):
        # Language is determined by first letter of voice name
        # 'a' => American English
        # 'b' => British English
        return 'a' if voice_name.startswith('a') else 'b'
        
    async def generate_speech(self, text, voice_name='af', save_path=None):
        if voice_name not in self.voices:
            raise ValueError(f"Voice {voice_name} not found")
            
        # Get language code (a or b)
        lang = self.get_language(voice_name)
        logging.info(f"Using language: {lang}")
        
        # Generate audio
        audio, phonemes = generate(
            self.model,
            text,
            self.voices[voice_name],
            lang=lang
        )
        
        # Save if requested
        if save_path:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            import soundfile as sf
            sf.write(save_path, audio, 24000)
            
        return audio, phonemes
            
    async def play_audio(self, audio):
        if audio is None:
            return
            
        try:
            import sounddevice as sd
            self.stop_event.clear()
            sd.play(audio, 24000)
            await asyncio.sleep(0)  # Let other tasks run
            sd.wait()
        except Exception as e:
            logging.error(f"Error playing audio: {str(e)}")
            
    def stop(self):
        self.stop_event.set()
        import sounddevice as sd
        sd.stop()

async def handle_client(websocket, backend):
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                action = data.get('action')
                
                if action == 'ping':
                    # Respond to ping with pong
                    await websocket.send(json.dumps({
                        'status': 'pong',
                        'message': 'Backend is alive'
                    }))
                    continue
                
                if action == 'speak':
                    text = data.get('text', '')
                    voice = data.get('voice', 'af')
                    save_path = data.get('save_path')
                    
                    # Send status update
                    await websocket.send(json.dumps({
                        'status': 'generating',
                        'message': 'Generating speech...'
                    }))
                    
                    # Generate audio
                    audio, phonemes = await backend.generate_speech(text, voice, save_path)
                    
                    # Send completion status
                    await websocket.send(json.dumps({
                        'status': 'generated',
                        'message': 'Speech generated',
                        'phonemes': phonemes
                    }))
                    
                    # Play if requested
                    if data.get('autoplay', True):
                        await backend.play_audio(audio)
                        
                elif action == 'stop':
                    backend.stop()
                    await websocket.send(json.dumps({
                        'status': 'stopped',
                        'message': 'Speech stopped'
                    }))
                    
            except json.JSONDecodeError:
                await websocket.send(json.dumps({
                    'status': 'error',
                    'message': 'Invalid JSON'
                }))
            except Exception as e:
                await websocket.send(json.dumps({
                    'status': 'error',
                    'message': str(e)
                }))
                logging.error(f"Error handling message: {str(e)}")
                
    except websockets.exceptions.ConnectionClosed:
        logging.info("Client disconnected")

async def shutdown(server):
    """Cleanup function for graceful shutdown"""
    logging.info("Shutting down server...")
    server.close()
    await server.wait_closed()
    tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    logging.info("Server shutdown complete")

async def main():
    model_path = sys.argv[1]
    voices_path = sys.argv[2]
    
    try:
        backend = KokoroTTSBackend(model_path, voices_path)
    except Exception as e:
        logging.error(f"Failed to initialize backend: {str(e)}")
        sys.exit(1)
    
    port = 7851  # Same port as AllTalk for familiarity
    server = await websockets.serve(
        lambda ws: handle_client(ws, backend),
        "localhost",
        port
    )
    
    logging.info(f"Kokoro TTS backend running on ws://localhost:{port}")
    
    # Create a future to control the server lifetime
    stop_future = asyncio.Future()
    
    # Handle shutdown differently on Windows vs Unix
    if os.name == 'nt':  # Windows
        def handle_shutdown(signum, frame):
            if not stop_future.done():
                stop_future.set_result(None)
        
        # Register Windows signal handlers
        signal.signal(signal.SIGINT, handle_shutdown)
        signal.signal(signal.SIGTERM, handle_shutdown)
        
        try:
            await stop_future  # wait until shutdown is triggered
        finally:
            await shutdown(server)
    else:  # Unix
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: stop_future.set_result(None))
        try:
            await stop_future  # wait until shutdown is triggered
        finally:
            await shutdown(server)

if __name__ == '__main__':
    asyncio.run(main())
