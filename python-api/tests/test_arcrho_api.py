from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from arcrho_api import ArcRhoClient, DfmDataError, ReadOnlyError
from arcrho_api.paths import dfm_filename
from arcrho_api.migration import ArcRhoSession


def sample_payload() -> dict:
    return {
        "json format": "arcrho-dfm-method-by-tab-v1",
        "details tab": {
            "name": "Paid DFM",
            "output type": "Paid Ultimate",
            "input triangle": "Paid Loss",
            "origin length": 12,
            "development length": 12,
            "decimal places": 4,
        },
        "data tab": {
            "origin labels": ["2019", "2020", "2021"],
            "development labels": ["12m", "24m", "36m"],
            "input data triangle values": [],
            "input data triangle csv path": "",
        },
        "ratios tab": {
            "ratio triangle": {
                "origin labels": ["2019", "2020", "2021"],
                "development labels": ["(1) 12-24", "(2) 24-36"],
                "ratio values": [[1.1, 1.2], [1.5, 1.1], [0.9, 1.4]],
                "excluded": [[0, 0], [0, 0], [0, 0]],
            },
            "average formulas": {
                "label": ["Volume - all", "Simple - 3", "User Entry"],
                "custom average formula settings": {
                    "averageType": ["custom", "custom", "user_entry"],
                    "base": ["volume", "simple", ""],
                    "periods": ["all", 3, "all"],
                    "exclude": [0, 0, 0],
                },
                "selected": [[0, 0], [0, 0], [0, 0]],
                "values": [[1.0, 1.0], [1.2, 1.3], [None, None]],
            },
            "percent developed curve": {"x-axis label": "Development Month", "selected curves": []},
        },
        "results tab": {
            "ratio basis dataset": "",
            "ultimate ratio decimal places": 2,
            "ultimate vector": [100, 200, 300],
        },
        "notes tab": {"notes": "original"},
        "method metadata": {"last modified": "2026-01-01T00:00:00"},
        "unknown section": {"preserve": True},
    }


class ArcRhoApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(dir=r"C:\tmp")
        self.root = Path(self.tmp.name) / "ArcRho Server"
        self.project_dir = self.root / "projects" / "Demo"
        self.methods_dir = self.project_dir / "methods"
        self.methods_dir.mkdir(parents=True)
        (self.project_dir / "data").mkdir()
        self.method_path = self.methods_dir / dfm_filename(r"Auto\PP", "Paid DFM")
        self.method_path.write_text(json.dumps(sample_payload()), encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_client_project_and_index(self) -> None:
        client = ArcRhoClient(self.root)
        self.assertEqual(client.list_projects(), ["Demo"])
        project = client.project("demo")
        refs = project.rebuild_dfm_index()
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].name, "Paid DFM")
        index = json.loads((self.methods_dir / "dfm_method_index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["methods"], [{"path": "Auto^PP", "name": "Paid DFM"}])

    def test_dfm_helpers_preserve_unknown_fields(self) -> None:
        dfm = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP").dfm("Paid DFM")
        dfm.clear()
        dfm.ex_COVID_AY()
        dfm.ex_hi(1, 1, "high ratio")
        dfm.select_low(2, 1)
        dfm.set_selected_estimate("Simple - 3", "all")
        dfm.set_user_value(1.25, 2)
        dfm.add_notes("reviewed")
        dfm.save()
        saved = json.loads(self.method_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["unknown section"], {"preserve": True})
        self.assertEqual(saved["ratios tab"]["average formulas"]["selected"][1][0], 1)
        self.assertEqual(saved["ratios tab"]["average formulas"]["selected"][2][1], 1)
        self.assertIn("reviewed", saved["notes tab"]["notes"])
        self.assertNotEqual(saved["method metadata"]["last modified"], "2026-01-01T00:00:00")

    def test_read_only_blocks_save(self) -> None:
        dfm = ArcRhoClient(self.root, read_only=True).project("Demo").reserving_class(r"Auto\PP").dfm("Paid DFM")
        dfm.add_notes("blocked")
        with self.assertRaises(ReadOnlyError):
            dfm.save()

    def test_new_dfm_minimum_payload(self) -> None:
        rc = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP")
        dfm = rc.new_dfm(
            "New DFM",
            output_vector="New Ultimate",
            input_triangle="Paid Loss",
            origin_length=12,
            development_length=12,
        )
        dfm.save()
        self.assertTrue((self.methods_dir / dfm_filename(r"Auto\PP", "New DFM")).exists())

    def test_migration_session(self) -> None:
        session = ArcRhoSession(self.root)
        session.set_project("Demo")
        session.set_reserving_class(r"Auto\PP")
        dfm = session.DFM("Paid DFM")
        self.assertEqual(dfm.name, "Paid DFM")

    def test_missing_ratio_data_raises(self) -> None:
        rc = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP")
        dfm = rc.new_dfm(
            "Empty",
            output_vector="Output",
            input_triangle="Input",
            origin_length=12,
            development_length=12,
        )
        with self.assertRaises(DfmDataError):
            dfm.ex_hi(1)


if __name__ == "__main__":
    unittest.main()
