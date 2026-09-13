"""Offline MP3 encoding only. lameenc 1.8.1 is an authoring tool, not a game dependency.
Run after synthesize.mjs; no third-party code ships with the resulting audio.
"""
from pathlib import Path
import wave
import lameenc

for name in ["quarter-step", "folio-open", "battle-seal", "accession", "farewell"]:
    with wave.open(f"output/first-media-v1.29.25/audio/{name}.wav", "rb") as source:
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(96)
        encoder.set_in_sample_rate(source.getframerate())
        encoder.set_channels(source.getnchannels())
        encoder.set_quality(2)
        encoded = encoder.encode(source.readframes(source.getnframes())) + encoder.flush()
        Path(f"public/media/sfx/{name}.mp3").write_bytes(encoded)
