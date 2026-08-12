from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from audio_engine.media import find_ffmpeg, read_audio
from audio_engine.synthetic import synthesize_melody
from audio_engine.wav_io import write_wav


class MediaTests(unittest.TestCase):
    def test_read_audio_reads_wav_without_ffmpeg(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.wav"
            write_wav(source, synthesize_melody([(0.25, 220.0)]), 16000)
            audio = read_audio(source)
            self.assertEqual(audio.sample_rate, 16000)
            self.assertGreater(audio.samples.size, 0)

    def test_project_ffmpeg_is_discoverable_when_installed(self) -> None:
        project_vendor = Path(__file__).resolve().parent.parent / ".vendor"
        if not project_vendor.exists():
            self.skipTest("optional media runtime is not installed")
        self.assertTrue(find_ffmpeg().is_file())


if __name__ == "__main__":
    unittest.main()
