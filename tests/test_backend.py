from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.config import Settings
from backend.processing import PerformanceArtifacts, SongArtifacts
from backend.store import FileStore


class FakeProcessor:
    def __init__(self) -> None:
        self.song_calls = 0
        self.performance_calls = 0

    def process_song(self, source_path, output_directory, progress):
        self.song_calls += 1
        output_directory.mkdir(parents=True, exist_ok=True)
        progress(0.4, "fake separation")
        vocals = output_directory / "vocals.wav"
        accompaniment = output_directory / "accompaniment.wav"
        pitch = output_directory / "reference_pitch.json"
        vocals.write_bytes(b"RIFF-fake-vocals")
        accompaniment.write_bytes(b"RIFF-fake-accompaniment")
        pitch.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "start_seconds": 0.025,
                    "hop_seconds": 0.02,
                    "duration_seconds": 0.08,
                    "voiced_frames": 2,
                    "minimum_midi": 57.0,
                    "maximum_midi": 57.1,
                    "frames": [None, 57.0, 57.1, None],
                }
            ),
            encoding="utf-8",
        )
        progress(0.9, "fake pitch")
        return SongArtifacts(
            reference_vocals_path=vocals,
            accompaniment_path=accompaniment,
            reference_pitch_path=pitch,
            duration_seconds=12.5,
            separation_seconds=0.25,
        )

    def process_performance(
        self,
        reference_vocals_path,
        performance_path,
        output_directory,
        progress,
    ):
        self.performance_calls += 1
        output_directory.mkdir(parents=True, exist_ok=True)
        progress(0.5, "fake analysis")
        vocals = output_directory / "user_vocals.wav"
        report = output_directory / "report.json"
        comparison = output_directory / "pitch_comparison.svg"
        score = {
            "overall": 88.0,
            "pitch": 86.0,
            "rhythm": 90.0,
            "completeness": 91.0,
            "stability": 87.0,
        }
        vocals.write_bytes(b"RIFF-fake-user-vocals")
        report.write_text(json.dumps(score), encoding="utf-8")
        comparison.write_text("<svg></svg>", encoding="utf-8")
        progress(0.9, "fake score")
        return PerformanceArtifacts(
            user_vocals_path=vocals,
            report_path=report,
            pitch_comparison_path=comparison,
            score=score,
            separation_seconds=0.2,
        )


class FailingProcessor(FakeProcessor):
    def process_song(self, source_path, output_directory, progress):
        raise RuntimeError(f"decoder failed under {output_directory}")


class BackendApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.data_root = Path(self.temporary.name) / "data"
        self.processor = FakeProcessor()
        settings = Settings(data_root=self.data_root, max_upload_bytes=1024)
        self.client_context = TestClient(
            create_app(
                settings,
                processor=self.processor,
                synchronous_jobs=True,
            )
        )
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary.cleanup()

    def _upload_song(self, content: bytes = b"RIFF-demo-audio") -> dict[str, object]:
        response = self.client.post(
            "/api/songs",
            files={"file": ("demo.wav", content, "audio/wav")},
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def test_health_and_missing_resources(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ok")
        self.assertEqual(self.client.get("/api/jobs/missing").status_code, 404)
        self.assertEqual(self.client.get("/api/songs/missing").status_code, 404)

    def test_cors_allows_lan_and_github_pages_but_not_public_origin(self) -> None:
        allowed_lan = self.client.options(
            "/api/health",
            headers={
                "Origin": "http://192.168.1.20:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        allowed_pages = self.client.options(
            "/api/health",
            headers={
                "Origin": "https://xuxakiss.github.io",
                "Access-Control-Request-Method": "GET",
            },
        )
        denied = self.client.options(
            "/api/health",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "GET",
            },
        )

        self.assertEqual(allowed_lan.status_code, 200)
        self.assertEqual(
            allowed_lan.headers["access-control-allow-origin"],
            "http://192.168.1.20:5173",
        )
        self.assertEqual(allowed_pages.status_code, 200)
        self.assertEqual(
            allowed_pages.headers["access-control-allow-origin"],
            "https://xuxakiss.github.io",
        )
        self.assertEqual(denied.status_code, 400)

    def test_rejects_unsupported_empty_and_oversized_uploads(self) -> None:
        unsupported = self.client.post(
            "/api/songs",
            files={"file": ("notes.txt", b"not audio", "text/plain")},
        )
        self.assertEqual(unsupported.status_code, 415)

        empty = self.client.post(
            "/api/songs",
            files={"file": ("empty.wav", b"", "audio/wav")},
        )
        self.assertEqual(empty.status_code, 400)

        oversized = self.client.post(
            "/api/songs",
            files={"file": ("huge.wav", b"R" * 1025, "audio/wav")},
        )
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(list((self.data_root / "incoming").iterdir()), [])

    def test_song_upload_exposes_resources_without_local_paths(self) -> None:
        submission = self._upload_song()
        job = self.client.get(f"/api/jobs/{submission['job_id']}").json()
        song = self.client.get(f"/api/songs/{submission['song_id']}").json()

        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["progress"], 1.0)
        self.assertEqual(song["status"], "ready")
        self.assertEqual(song["duration_seconds"], 12.5)
        self.assertNotIn(str(self.data_root), json.dumps(song))
        self.assertEqual(
            self.client.get(song["resources"]["accompaniment"]).content,
            b"RIFF-fake-accompaniment",
        )
        pitch = self.client.get(song["resources"]["pitch"]).json()
        self.assertEqual(pitch["frames"][1], 57.0)

    def test_duplicate_song_uses_sha256_cache(self) -> None:
        first = self._upload_song()
        second = self._upload_song()

        self.assertEqual(second["song_id"], first["song_id"])
        self.assertTrue(second["cached"])
        self.assertEqual(second["status"], "completed")
        self.assertEqual(self.processor.song_calls, 1)

    def test_performance_upload_returns_score_and_comparison(self) -> None:
        song = self._upload_song()
        response = self.client.post(
            f"/api/songs/{song['song_id']}/performances",
            files={"file": ("take.m4a", b"performance-audio", "audio/mp4")},
        )

        self.assertEqual(response.status_code, 202, response.text)
        submission = response.json()
        job = self.client.get(f"/api/jobs/{submission['job_id']}").json()
        performance = self.client.get(
            f"/api/performances/{submission['performance_id']}"
        ).json()
        comparison = self.client.get(performance["comparison_url"])

        self.assertEqual(job["status"], "completed")
        self.assertEqual(performance["status"], "ready")
        self.assertEqual(performance["score"]["overall"], 88.0)
        self.assertEqual(comparison.status_code, 200)
        self.assertIn("<svg", comparison.text)
        self.assertEqual(self.processor.performance_calls, 1)

    def test_processing_failure_is_persisted_without_absolute_path(self) -> None:
        settings = Settings(data_root=self.data_root / "failure", max_upload_bytes=1024)
        with TestClient(
            create_app(
                settings,
                processor=FailingProcessor(),
                synchronous_jobs=True,
            )
        ) as client:
            response = client.post(
                "/api/songs",
                files={"file": ("bad.wav", b"RIFF-bad", "audio/wav")},
            )
            job = client.get(f"/api/jobs/{response.json()['job_id']}").json()

        self.assertEqual(job["status"], "failed")
        self.assertNotIn(str(settings.data_root), job["error"])
        self.assertIn("<data>", job["error"])


class FileStoreTests(unittest.TestCase):
    def test_interrupted_jobs_are_marked_failed_on_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = FileStore(Path(directory))
            store.create_job(
                {
                    "id": "job-1",
                    "kind": "song_preprocessing",
                    "status": "running",
                    "progress": 0.4,
                }
            )

            recovered = store.recover_interrupted_jobs()

            self.assertEqual(recovered, 1)
            self.assertEqual(store.get_job("job-1")["status"], "failed")


if __name__ == "__main__":
    unittest.main()
