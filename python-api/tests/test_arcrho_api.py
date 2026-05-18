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
            "ultimate vector csv path": "",
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
        self.data_dir = self.project_dir / "data"
        self.rc_data_dir = self.data_dir / "Auto^PP"
        self.rc_data_dir.mkdir(parents=True)
        self.method_path = self.rc_data_dir / dfm_filename("Paid DFM")
        self.input_csv = self.rc_data_dir / "input.csv"
        self.input_csv.write_text("10,20,30\n11,22,\n12,,\n", encoding="utf-8")
        self.ultimate_csv = self.rc_data_dir / "ultimate.csv"
        self.ultimate_csv.write_text("100\n200\n300\n", encoding="utf-8")
        payload = sample_payload()
        payload["data tab"]["input data triangle csv path"] = str(self.input_csv)
        payload["results tab"]["ultimate vector csv path"] = str(self.ultimate_csv)
        self.method_path.write_text(json.dumps(payload), encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_client_project_and_index(self) -> None:
        client = ArcRhoClient(self.root)
        self.assertEqual(client.list_projects(), ["Demo"])
        project = client.project("demo")
        refs = project.rebuild_dfm_index()
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].name, "Paid DFM")
        index = json.loads((self.data_dir / "dfm_method_index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["methods"], [{"path": "Auto^PP", "name": "Paid DFM"}])

    def test_dfm_helpers_preserve_unknown_fields(self) -> None:
        dfm = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP").dfm("Paid DFM")
        dfm.clear()
        dfm.ex_COVID_AY()
        dfm.ex_AY(2020, "exclude accident year")
        dfm.ex_hi(1, 1, "high ratio")
        dfm.select_low(2, 1)
        dfm.set_selected_estimate("Simple - 3", "all")
        dfm.set_user_value(1.25, 2)
        dfm.add_notes("reviewed")
        dfm.save()
        saved_text = self.method_path.read_text(encoding="utf-8")
        saved = json.loads(saved_text)
        self.assertEqual(saved["unknown section"], {"preserve": True})
        self.assertNotIn("input data triangle values", saved["data tab"])
        self.assertNotIn("ultimate vector", saved["results tab"])
        self.assertEqual(saved["ratios tab"]["ratio triangle"]["excluded"][1], [1, 1])
        self.assertIn("[1, 1]", saved_text)
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
        self.assertTrue((self.rc_data_dir / dfm_filename("New DFM")).exists())

    def test_migration_session(self) -> None:
        session = ArcRhoSession(self.root)
        session.set_project("Demo")
        session.set_reserving_class(r"Auto\PP")
        dfm = session.DFM("Paid DFM")
        self.assertEqual(dfm.name, "Paid DFM")

    def test_csv_backed_components_and_agent_edits(self) -> None:
        dfm = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP").dfm("Paid DFM")
        self.assertEqual(dfm.input_data_triangle()[0], [10.0, 20.0, 30.0])
        self.assertEqual(dfm.ultimate_vector(), [100.0, 200.0, 300.0])
        summary = dfm.agent_summary()
        self.assertEqual(summary["api method"], "DfmMethod.agent_summary")
        dfm.exclude_ratio("2020", "(1) 12-24").set_selected_average_by_label("Simple - 3", "(2) 24-36").save()
        saved = json.loads(self.method_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["ratios tab"]["ratio triangle"]["excluded"][1][0], 1)
        self.assertEqual(saved["ratios tab"]["average formulas"]["selected"][1][1], 1)

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

    def test_apply_adjustments_uses_col_growth_values(self) -> None:
        dfm = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP").dfm("Paid DFM")
        dfm.update_details(output_vector="Claim Counts--CWP")
        dfm.set_selected_estimate("Simple - 3")
        dfm.apply_adjustments()
        self.assertEqual(dfm.selected_average_label(1), "User Entry")
        self.assertEqual(dfm.selected_average_label(2), "Simple - 3")
        self.assertAlmostEqual(dfm.selected_ratio(1) or 0, 1.2862, places=4)
        self.assertAlmostEqual(dfm.selected_ratio(2) or 0, 1.3, places=4)
        self.assertIn("Apply growth adjustments of 1+5.08% = 1.0508", dfm.notes)
        self.assertIn("Apply accounting cutoff 1+2.00% = 1.0200", dfm.notes)
        self.assertIn('Selected average factor: "Simple - 3" (1.2000)', dfm.notes)

    def test_save_uses_row_compact_json_and_trims_triangle_rows(self) -> None:
        payload = sample_payload()
        payload["ratios tab"]["ratio triangle"]["ratio values"] = [[1.2, None, None]]
        payload["ratios tab"]["ratio triangle"]["excluded"] = [[1, 0, 2, 2]]
        payload["ratios tab"]["average formulas"]["values"] = [[1.2, None], [None, None], [1.3, None]]
        self.method_path.write_text(json.dumps(payload), encoding="utf-8")
        dfm = ArcRhoClient(self.root).project("Demo").reserving_class(r"Auto\PP").dfm("Paid DFM")
        dfm.save()
        saved_text = self.method_path.read_text(encoding="utf-8")
        saved = json.loads(saved_text)
        self.assertEqual(saved["ratios tab"]["ratio triangle"]["ratio values"], [[1.2]])
        self.assertEqual(saved["ratios tab"]["ratio triangle"]["excluded"], [[1]])
        self.assertEqual(saved["ratios tab"]["average formulas"]["values"], [[1.2], [], [1.3]])
        self.assertIn("[1.2]", saved_text)
        self.assertIn("[1]", saved_text)


if __name__ == "__main__":
    unittest.main()
