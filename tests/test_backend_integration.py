from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from audio_engine.synthetic import create_demo_files
from backend.app import create_app
from backend.config import Settings
from backend.processing import AudioProcessor


@unittest.skipUnless(
    os.environ.get("KARAOKE_RUN_INTEGRATION") == "1",
    "set KARAOKE_RUN_INTEGRATION=1 to run Demucs integration",
)
class RealBackendIntegrationTests(unittest.TestCase):
    def test_song_and_performance_complete_through_http_api(self) -> None:
        project_root = Path(__file__).resolve().parent.parent
        temporary_root = project_root / ".tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="backend-integration-", dir=temporary_root
        ) as directory:
            root = Path(directory)
            reference, performance = create_demo_files(root / "input")
            settings = Settings(
                data_root=root / "data",
                max_upload_bytes=10 * 1024 * 1024,
            )
            application = create_app(
                settings,
                processor=AudioProcessor(device="cpu"),
                synchronous_jobs=True,
            )

            with TestClient(application) as client:
                with reference.open("rb") as source:
                    song_response = client.post(
                        "/api/songs",
                        files={"file": ("reference.wav", source, "audio/wav")},
                    )
                self.assertEqual(song_response.status_code, 202, song_response.text)
                song_submission = song_response.json()
                song_job = client.get(
                    f"/api/jobs/{song_submission['job_id']}"
                ).json()
                self.assertEqual(song_job["status"], "completed", song_job)

                song = client.get(
                    f"/api/songs/{song_submission['song_id']}"
                ).json()
                self.assertEqual(song["status"], "ready", song)
                self.assertEqual(client.get(song["resources"]["pitch"]).status_code, 200)
                self.assertEqual(
                    client.get(song["resources"]["accompaniment"]).status_code, 200
                )

                with performance.open("rb") as source:
                    performance_response = client.post(
                        f"/api/songs/{song['id']}/performances",
                        files={"file": ("performance.wav", source, "audio/wav")},
                    )
                self.assertEqual(
                    performance_response.status_code, 202, performance_response.text
                )
                performance_submission = performance_response.json()
                performance_job = client.get(
                    f"/api/jobs/{performance_submission['job_id']}"
                ).json()
                self.assertEqual(
                    performance_job["status"], "completed", performance_job
                )
                result = client.get(
                    "/api/performances/"
                    f"{performance_submission['performance_id']}"
                ).json()
                self.assertEqual(result["status"], "ready", result)
                self.assertIn("overall", result["score"])
                self.assertEqual(client.get(result["comparison_url"]).status_code, 200)


if __name__ == "__main__":
    unittest.main()
