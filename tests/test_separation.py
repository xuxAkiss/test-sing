from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from audio_engine.separation import find_separation_python, separate_vocals


class SeparationTests(unittest.TestCase):
    def test_missing_input_is_rejected_before_model_launch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.m4a"
            with self.assertRaises(FileNotFoundError):
                separate_vocals(missing, Path(directory) / "output")

    def test_separation_runtime_is_discoverable_when_installed(self) -> None:
        project_venv = Path(__file__).resolve().parent.parent / ".venv"
        if not project_venv.exists():
            self.skipTest("optional separation environment is not installed")
        self.assertTrue(find_separation_python().is_file())


if __name__ == "__main__":
    unittest.main()
