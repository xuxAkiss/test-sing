from __future__ import annotations

import os
from pathlib import Path
import unittest

from audio_engine.pipeline import analyze_files


PROJECT_ROOT = Path(__file__).resolve().parent.parent


REAL_AUDIO_CASES = (
    {
        "name": "搁浅",
        "artifact_directory": "搁浅",
        "minimum_scores": {
            "overall": 78.0,
            "pitch": 68.0,
            "rhythm": 92.0,
            "completeness": 91.0,
            "stability": 86.0,
        },
        "minimum_alignment_quality": 0.93,
    },
    {
        "name": "七里香",
        "artifact_directory": "七里香",
        "minimum_scores": {
            "overall": 76.0,
            "pitch": 65.0,
            "rhythm": 90.0,
            "completeness": 89.0,
            "stability": 88.0,
        },
        "minimum_alignment_quality": 0.90,
    },
    {
        "name": "告白气球",
        "artifact_directory": "浪漫告白气球之歌",
        "minimum_scores": {
            "overall": 68.0,
            "pitch": 55.0,
            "rhythm": 87.0,
            "completeness": 88.0,
            "stability": 81.0,
        },
        "minimum_alignment_quality": 0.88,
    },
)


@unittest.skipUnless(
    os.environ.get("KARAOKE_RUN_REAL_AUDIO_REGRESSION") == "1",
    "set KARAOKE_RUN_REAL_AUDIO_REGRESSION=1 to run local real-audio cases",
)
class RealAudioRegressionTests(unittest.TestCase):
    def test_phone_recordings_keep_expected_score_quality(self) -> None:
        output_root = PROJECT_ROOT / ".tmp" / "real-audio-regression"

        for case in REAL_AUDIO_CASES:
            artifact_directory = case["artifact_directory"]
            reference_path = (
                PROJECT_ROOT
                / "artifacts"
                / "reference_separation"
                / artifact_directory
                / "stems"
                / "htdemucs"
                / "prepared_input"
                / "vocals.wav"
            )
            performance_path = (
                PROJECT_ROOT
                / "artifacts"
                / "full_separation"
                / artifact_directory
                / "stems"
                / "htdemucs"
                / "prepared_input"
                / "vocals.wav"
            )
            missing = [
                str(path)
                for path in (reference_path, performance_path)
                if not path.is_file()
            ]
            if missing:
                self.fail(
                    f"{case['name']} is enabled but its local audio fixture is missing: "
                    + ", ".join(missing)
                )

            with self.subTest(song=case["name"]):
                report = analyze_files(
                    reference_path,
                    performance_path,
                    output_root / str(case["name"]),
                    max_shift_seconds=10.0,
                    alignment_method="dtw",
                    dtw_band_seconds=30.0,
                )

                self.assertGreaterEqual(report.overall, 60.0)
                for score_name, minimum in case["minimum_scores"].items():
                    self.assertGreaterEqual(
                        getattr(report, score_name),
                        minimum,
                        f"{case['name']} {score_name} score regressed",
                    )
                self.assertGreaterEqual(
                    report.alignment["quality"],
                    case["minimum_alignment_quality"],
                    f"{case['name']} alignment quality regressed",
                )


if __name__ == "__main__":
    unittest.main()
