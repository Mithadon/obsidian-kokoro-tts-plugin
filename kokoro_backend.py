#!/usr/bin/env python3
import sys
import json
import torch
import os
import numpy
from pathlib import Path
import asyncio
import websockets
import logging
import signal
import warnings

# Filter out specific PyTorch warnings
warnings.filterwarnings('ignore', message='.*weight_norm is deprecated.*')
warnings.filterwarnings('ignore', message='.*dropout option adds dropout after all but last recurrent layer.*')

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

class TTSSession:
    def __init__(self, save_path=None, autoplay=True, total_chunks=0):
        self.save_path = save_path
        self.autoplay = autoplay
        self.total_chunks = total_chunks
        self.audio_chunks = []
        self.current_chunk = 0
        self.start_time = asyncio.get_event_loop().time()
        self.total_chars = 0

class KokoroTTSBackend:
    # Voice name mapping
    VOICE_DEFAULTS = {
        'f': 'a',           # Default voice (Bella & Sarah mix) - US
        'f_bella': 'a',     # Bella - US
        'f_sarah': 'a',     # Sarah - US
        'f_adam': 'a',      # Adam - US
        'f_michael': 'a',   # Michael - US
        'f_emma': 'b',      # Emma - GB
        'f_isabella': 'b',  # Isabella - GB
        'f_george': 'b',    # George - GB
        'f_lewis': 'b',     # Lewis - GB
        'f_nicole': 'a',    # Nicole - US
        'f_sky': 'a',       # Sky - US
    }

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
            # Get base voice name by removing language prefix
            voice_name = voice_file.stem
            base_name = voice_name[1:] if voice_name.startswith(('a', 'b')) else voice_name
            
            # Load voice for both US and GB variants
            voice_data = torch.load(voice_file, weights_only=True).to(self.device)
            self.voices['a' + base_name] = voice_data  # US variant
            self.voices['b' + base_name] = voice_data  # GB variant
            
        logging.info(f"Loaded {len(self.voices) // 2} voices")
        
        self.current_audio = None
        self.stop_event = asyncio.Event()
        self.sessions = {}  # Store active TTS sessions

    def get_engine_voice_name(self, voice_name: str, language: str) -> str:
        """Get the full voice name for the engine with appropriate language prefix"""
        # Remove any existing language prefix
        base_name = voice_name[1:] if voice_name.startswith(('a', 'b')) else voice_name
        
        # Get default language for this voice
        default_lang = self.VOICE_DEFAULTS.get(base_name, 'a')
        
        # Use specified language or default
        lang_prefix = 'a' if language == 'en-us' else ('b' if language == 'en-gb' else default_lang)
        engine_voice = lang_prefix + base_name
        
        logging.info(f"Voice mapping: {voice_name} -> {engine_voice} (language: {language}, default: {default_lang})")
        return engine_voice

    async def generate_speech(self, text, voice_name='f', language='default'):
        # Get full voice name for engine
        engine_voice = self.get_engine_voice_name(voice_name, language)
        
        if engine_voice not in self.voices:
            raise ValueError(f"Voice {engine_voice} not found")
            
        # Get language code from engine voice name
        lang = engine_voice[0]
        logging.info(f"Using voice: {engine_voice} (lang: {lang})")
        
        # Generate audio
        audio, phonemes = generate(
            self.model,
            text,
            self.voices[engine_voice],
            lang=lang
        )
            
        return audio, phonemes

    def concatenate_audio(self, audio_chunks):
        """Concatenate multiple audio chunks into a single audio stream"""
        if not audio_chunks:
            return numpy.array([])
        return numpy.concatenate(audio_chunks)
            
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
                
                if action == 'start_session':
                    session_id = data.get('session_id')
                    save_path = data.get('save_path')
                    autoplay = data.get('autoplay', True)
                    total_chunks = data.get('total_chunks', 0)
                    
                    backend.sessions[session_id] = TTSSession(save_path, autoplay, total_chunks)
                    
                    await websocket.send(json.dumps({
                        'status': 'session_started',
                        'message': 'Started new TTS session'
                    }))
                    
                elif action == 'speak':
                    session_id = data.get('session_id')
                    text = data.get('text', '')
                    voice = data.get('voice', 'f')  # Default voice without language prefix
                    is_last_chunk = data.get('is_last_chunk', False)
                    
                    if session_id not in backend.sessions:
                        raise ValueError(f"Invalid session ID: {session_id}")
                    
                    session = backend.sessions[session_id]
                    
                    # Send status update
                    await websocket.send(json.dumps({
                        'status': 'generating',
                        'message': 'Generating speech...'
                    }))
                    
                    # Generate audio
                    audio, phonemes = await backend.generate_speech(text, voice, data.get('language', 'default'))
                    
                    # Store audio chunk and update stats
                    session.audio_chunks.append(audio)
                    session.current_chunk += 1
                    session.total_chars += len(text)
                    
                    # If this is the last chunk, concatenate and handle final audio
                    if is_last_chunk:
                        # Concatenate all chunks
                        final_audio = backend.concatenate_audio(session.audio_chunks)
                        
                        # Calculate session stats
                        elapsed_time = asyncio.get_event_loop().time() - session.start_time
                        chars_per_second = session.total_chars / elapsed_time if elapsed_time > 0 else 0
                        
                        # Save if requested
                        if session.save_path:
                            logging.info(f"Saving concatenated audio to {session.save_path}")
                            os.makedirs(os.path.dirname(session.save_path), exist_ok=True)
                            import soundfile as sf
                            sf.write(session.save_path, final_audio, 24000)
                            logging.info("Audio saved successfully")
                        
                        # Play if requested
                        if session.autoplay:
                            await backend.play_audio(final_audio)
                        
                        # Send completion stats
                        await websocket.send(json.dumps({
                            'status': 'session_stats',
                            'message': f'Generated {session.total_chars:,} characters in {session.current_chunk} chunks ({elapsed_time:.1f}s, {chars_per_second:.1f} chars/s)'
                        }))
                        
                        # Clean up session
                        del backend.sessions[session_id]
                    
                    # Send completion status
                    await websocket.send(json.dumps({
                        'status': 'generated',
                        'message': 'Speech generated',
                        'phonemes': phonemes,
                        'is_last_chunk': is_last_chunk
                    }))
                        
                elif action == 'stop':
                    backend.stop()
                    backend.sessions.clear()  # Clear all active sessions
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
