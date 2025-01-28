#!/usr/bin/env python3
import sys
import json
import os
import numpy
import asyncio
import websockets
import logging
import signal
import warnings
import functools
import builtins

# Monkey patch built-in open to use UTF-8 for text mode
_open = builtins.open
@functools.wraps(_open)
def _open_with_utf8(*args, **kwargs):
    if len(args) > 1 and 'b' not in args[1]:  # Check if not binary mode
        if 'encoding' not in kwargs:
            kwargs['encoding'] = 'utf-8'
    return _open(*args, **kwargs)
builtins.open = _open_with_utf8

# Filter out PyTorch warnings
warnings.filterwarnings('ignore', message='.*weight_norm is deprecated.*')
warnings.filterwarnings('ignore', message='.*dropout option adds dropout after all but last recurrent layer.*')

from kokoro import KPipeline

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)

# Set espeak-ng environment variables for Windows if espeak is installed
if os.name == 'nt':  # Windows
    espeak_lib = r"C:\Program Files\eSpeak NG\libespeak-ng.dll"
    espeak_exe = r"C:\Program Files\eSpeak NG\espeak-ng.exe"
    if os.path.exists(espeak_lib) and os.path.exists(espeak_exe):
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = espeak_lib
        os.environ["PHONEMIZER_ESPEAK_PATH"] = espeak_exe
        logging.info("Found eSpeak NG installation, enabling fallback")

# Get Kokoro paths from arguments
if len(sys.argv) < 3:
    logging.error("Usage: kokoro_backend.py <model_path> <voices_path>")
    sys.exit(1)

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
    def __init__(self, model_path, voices_path):
        try:
            # Initialize pipeline with American English by default, no transformer
            self.pipeline = KPipeline(lang_code='a', trf=False)
            logging.info("Kokoro pipeline initialized")
        except Exception as e:
            logging.error(f"Failed to initialize pipeline: {str(e)}")
            raise
            
        self.current_audio = None
        self.stop_event = asyncio.Event()
        self.sessions = {}  # Store active TTS sessions

    async def generate_speech(self, text, voice_name='af_bella', speed=1.0, trim_silence=False, trim_amount=0.1):
        logging.info(f"Generating speech with voice: {voice_name} (speed: {speed})")
        
        # Generate audio using pipeline
        try:
            # Use full path to voice file
            voice_path = os.path.join(os.path.abspath(sys.argv[2]), voice_name + '.pt' if not voice_name.endswith('.pt') else voice_name)
            
            # Validate voice prefix matches pipeline language
            voice_prefix = voice_name[:2] if len(voice_name) > 2 else ''
            if voice_prefix not in ['af', 'am', 'bf', 'bm']:
                logging.warning(f"Invalid voice prefix '{voice_prefix}'. Expected af/am/bf/bm. Using voice as-is.")
            
            generator = self.pipeline(text, voice=voice_path, speed=speed)
            _, _, audio = next(generator)
            
            # Trim silence if requested
            if trim_silence and len(audio) > 0:
                # Calculate samples to trim (24000 samples per second)
                trim_samples = int(24000 * trim_amount)
                if len(audio) > (2 * trim_samples):  # Only trim if audio is long enough
                    audio = audio[trim_samples:-trim_samples]
            
            return audio, None
            
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            logging.error(f"Failed to generate speech: {str(e)}\n{error_details}")
            raise

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
                    voice = data.get('voice', 'af_bella')  # Default voice
                    speed = data.get('speed', 1.0)  # Default speed
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
                    audio, _ = await backend.generate_speech(
                        text, 
                        voice,
                        speed,
                        data.get('trim_silence', False),
                        data.get('trim_amount', 0.1)
                    )
                    
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
