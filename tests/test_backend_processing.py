from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from audio_engine.pitch import PitchTrack
from audio_engine.separation import SeparationResult
from audio_engine.wav_io import AudioData, read_wav, write_wav
from backend.processing import AudioProcessor, _clean_reference_pitch


class BackendProcessingTests(unittest.TestCase):
    def test_song_pitch_is_read_from_separated_original_vocals(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "song.wav"
            source.write_bytes(b"source")
            vocals = root / "stems" / "vocals.wav"
            accompaniment = root / "stems" / "minus_vocals.wav"
            vocals.parent.mkdir(parents=True)
            vocals.write_bytes(b"vocals")
            accompaniment.write_bytes(b"accompaniment")
            separation = SeparationResult(
                source_path=str(source),
                prepared_path=str(root / "prepared.wav"),
                vocals_path=str(vocals),
                accompaniment_path=str(accompaniment),
                model="htdemucs",
                device="cpu",
                elapsed_seconds=1.0,
            )
            audio = AudioData(samples=np.zeros(16000), sample_rate=16000)
            track = PitchTrack(
                times=np.array([0.025, 0.045, 0.065, 0.085, 0.105]),
                frequencies=np.full(5, 220.0),
                confidences=np.full(5, 0.9),
                rms=np.full(5, 0.2),
                hop_seconds=0.02,
            )

            with (
                patch("backend.processing.separate_vocals", return_value=separation),
                patch("backend.processing.read_audio", return_value=audio) as read,
                patch("backend.processing.extract_pitch", return_value=track),
            ):
                result = AudioProcessor().process_song(
                    source,
                    root / "output",
                    lambda _value, _message: None,
                )

            read.assert_called_once_with(vocals)
            self.assertEqual(result.reference_vocals_path, vocals)

    def test_reference_cleanup_removes_low_confidence_and_short_runs(self) -> None:
        track = PitchTrack(
            times=np.arange(10, dtype=np.float64) * 0.02,
            frequencies=np.full(10, 220.0),
            confidences=np.array([0.9, 0.9, 0.9, 0.9, 0.9, 0.4, 0.9, 0.9, 0.0, 0.0]),
            rms=np.full(10, 0.2),
            hop_seconds=0.02,
        )

        cleaned = _clean_reference_pitch(track)

        self.assertTrue(np.all(cleaned.frequencies[:5] > 0))
        self.assertTrue(np.all(cleaned.frequencies[5:] == 0))

    def test_segment_scoring_uses_only_the_matching_reference_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.wav"
            performance = root / "performance.webm"
            user_vocals = root / "user-vocals.wav"
            write_wav(reference, np.linspace(-0.2, 0.2, 32000), 16000)
            performance.write_bytes(b"performance")
            write_wav(user_vocals, np.zeros(16000), 16000)
            separation = SeparationResult(
                source_path=str(performance),
                prepared_path=str(root / "prepared.wav"),
                vocals_path=str(user_vocals),
                accompaniment_path=str(root / "accompaniment.wav"),
                model="htdemucs",
                device="cpu",
                elapsed_seconds=1.0,
            )
            report = Mock()
            report.to_dict.return_value = {
                "overall": 80.0,
                "pitch": 80.0,
                "rhythm": 80.0,
                "completeness": 80.0,
                "stability": 80.0,
            }

            with (
                patch("backend.processing.separate_vocals", return_value=separation),
                patch("backend.processing.analyze_files", return_value=report) as analyze,
            ):
                AudioProcessor().process_performance(
                    reference,
                    performance,
                    root / "output",
                    lambda _value, _message: None,
                    segment_start_seconds=0.5,
                    segment_end_seconds=1.5,
                )

            segment_path = Path(analyze.call_args.args[0])
            self.assertEqual(segment_path.name, "reference_segment.wav")
            self.assertAlmostEqual(read_wav(segment_path).duration_seconds, 1.0, places=3)


if __name__ == "__main__":
    unittest.main()
