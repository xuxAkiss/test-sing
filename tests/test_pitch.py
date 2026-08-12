from __future__ import annotations

import unittest

import numpy as np

from audio_engine.pitch import extract_pitch
from audio_engine.synthetic import synthesize_melody
from audio_engine.wav_io import AudioData


class PitchExtractionTests(unittest.TestCase):
    def test_detects_a_stable_tone(self) -> None:
        samples = synthesize_melody([(0.15, None), (0.8, 220.0), (0.15, None)])
        track = extract_pitch(AudioData(samples=samples, sample_rate=16000))
        detected = track.frequencies[track.voiced]
        self.assertGreater(detected.size, 20)
        self.assertAlmostEqual(float(np.median(detected)), 220.0, delta=3.0)

    def test_silence_is_unvoiced(self) -> None:
        samples = np.zeros(16000, dtype=np.float64)
        track = extract_pitch(AudioData(samples=samples, sample_rate=16000))
        self.assertEqual(int(np.sum(track.voiced)), 0)

    def test_detected_pitch_stays_inside_requested_range(self) -> None:
        samples = synthesize_melody([(0.8, 700.0)])
        track = extract_pitch(
            AudioData(samples=samples, sample_rate=16000),
            min_frequency=70.0,
            max_frequency=700.0,
        )
        self.assertTrue(np.all(track.frequencies[track.voiced] <= 700.0))


if __name__ == "__main__":
    unittest.main()
