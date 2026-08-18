from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from audio_engine.pipeline import analyze_files, inspect_audio_file
from audio_engine.cli import main
from audio_engine.synthetic import synthesize_melody
from audio_engine.wav_io import write_wav


NOTES = [
    (0.2, None),
    (0.55, 220.0),
    (0.12, None),
    (0.55, 261.63),
    (0.12, None),
    (0.55, 329.63),
    (0.2, None),
]


class PipelineTests(unittest.TestCase):
    def test_inspection_writes_quality_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "phone.wav"
            output = root / "inspection"
            write_wav(source, synthesize_melody(NOTES), 16000)

            report = inspect_audio_file(source, output)

            self.assertGreater(report["duration_seconds"], 1.0)
            self.assertGreater(report["pitch_voiced_frames"], 10)
            self.assertTrue((output / "inspection.json").is_file())
            self.assertTrue((output / "pitch_track.csv").is_file())
            self.assertTrue((output / "pitch_track.svg").is_file())

    def test_pipeline_aligns_delay_and_writes_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            performance_path = root / "performance.wav"
            output = root / "result"
            write_wav(reference_path, synthesize_melody(NOTES), 16000)
            write_wav(
                performance_path,
                synthesize_melody(NOTES, delay_seconds=0.18, detune_cents=18.0),
                16000,
            )

            report = analyze_files(reference_path, performance_path, output)

            self.assertAlmostEqual(report.alignment["shift_seconds"], 0.18, delta=0.06)
            self.assertGreater(report.overall, 80.0)
            for name in (
                "reference_pitch.csv",
                "performance_pitch.csv",
                "report.json",
                "pitch_comparison.svg",
            ):
                self.assertTrue((output / name).is_file(), name)
            payload = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["overall"], report.overall)
            comparison = (output / "pitch_comparison.svg").read_text(encoding="utf-8")
            self.assertIn("音高对比", comparison)
            self.assertIn("你的演唱", comparison)

    def test_large_detune_scores_lower(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            close_path = root / "close.wav"
            far_path = root / "far.wav"
            write_wav(reference_path, synthesize_melody(NOTES), 16000)
            write_wav(close_path, synthesize_melody(NOTES, detune_cents=15.0), 16000)
            write_wav(far_path, synthesize_melody(NOTES, detune_cents=180.0), 16000)

            close_report = analyze_files(reference_path, close_path, root / "close_result")
            far_report = analyze_files(reference_path, far_path, root / "far_result")

            self.assertGreater(close_report.pitch, far_report.pitch + 30.0)

    def test_local_octave_difference_is_normalized_for_register_fairness(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            performance_path = root / "performance.wav"
            reference_notes = [(0.6, 220.0), (0.6, 261.63), (0.6, 329.63)]
            performance_notes = [(0.6, 220.0), (0.6, 523.26), (0.6, 329.63)]
            write_wav(reference_path, synthesize_melody(reference_notes), 16000)
            write_wav(performance_path, synthesize_melody(performance_notes), 16000)

            report = analyze_files(reference_path, performance_path, root / "result")

            self.assertGreater(report.pitch, 90.0)
            self.assertGreater(
                report.diagnostics["octave_normalized_frames_percent"], 15.0
            )

    def test_dtw_aligns_non_uniform_tempo_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            performance_path = root / "performance.wav"
            reference_notes = [
                (0.18, None),
                (0.45, 220.00),
                (0.10, None),
                (0.55, 261.63),
                (0.10, None),
                (0.40, 329.63),
                (0.10, None),
                (0.60, 293.66),
                (0.10, None),
                (0.45, 349.23),
                (0.18, None),
            ]
            performance_notes = [
                (0.28, None),
                (0.65, 220.00),
                (0.10, None),
                (0.40, 261.63),
                (0.10, None),
                (0.62, 329.63),
                (0.10, None),
                (0.42, 293.66),
                (0.10, None),
                (0.58, 349.23),
                (0.18, None),
            ]
            write_wav(reference_path, synthesize_melody(reference_notes), 16000)
            write_wav(performance_path, synthesize_melody(performance_notes), 16000)

            report = analyze_files(
                reference_path,
                performance_path,
                root / "dtw_result",
                alignment_method="dtw",
                max_shift_seconds=1.0,
                dtw_band_seconds=1.5,
            )

            self.assertEqual(report.alignment["method"], "constrained_dtw")
            self.assertGreater(report.pitch, 90.0)
            self.assertGreater(report.overall, 80.0)
            self.assertTrue((root / "dtw_result" / "performance_pitch_raw.csv").is_file())
            self.assertTrue((root / "dtw_result" / "alignment_map.csv").is_file())
            self.assertLess(report.alignment["non_diagonal_steps_percent"], 60.0)

    def test_cli_forwards_dtw_alignment_option(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            performance_path = root / "performance.wav"
            output = root / "result"
            write_wav(reference_path, synthesize_melody(NOTES), 16000)
            write_wav(performance_path, synthesize_melody(NOTES), 16000)

            exit_code = main(
                [
                    "analyze",
                    "--reference",
                    str(reference_path),
                    "--performance",
                    str(performance_path),
                    "--output",
                    str(output),
                    "--alignment",
                    "dtw",
                ]
            )

            payload = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["alignment"]["method"], "constrained_dtw")


if __name__ == "__main__":
    unittest.main()
