import re
from pathlib import Path
import threading
import time

import win32com.client

try:
    from core.arcrho_bridge.bridge_utils import read_json, write_json, write_json_with_compact_rows
except ModuleNotFoundError:
    from arcrho_bridge.bridge_utils import read_json, write_json, write_json_with_compact_rows


CONNECTION_NAME = "JGO_CO1SQLWPV22"
DISCONNECT_COOLDOWN_SECONDS = 5
DFM_METHOD_JSON_FORMAT = "arcrho-dfm-method-by-tab-v1"
DFM_COMPACT_ROW_KEYS = (
    "input data triangle values",
    "ratio values",
    "excluded",
    "selected",
    "values",
)


class ResQClient:
    def __init__(self):
        self.app = None
        self._disconnect_deadline = None
        self._disconnect_lock = threading.RLock()

    def _connect(self):
        with self._disconnect_lock:
            self._disconnect_deadline = None
            if self.app is None:
                self.app = win32com.client.Dispatch("ResQ3Automation.ResQApplication")
                self.app.ConnectByName(CONNECTION_NAME, "", "")
            return self.app

    def _schedule_disconnect(self):
        with self._disconnect_lock:
            if self.app is not None:
                self._disconnect_deadline = time.monotonic() + DISCONNECT_COOLDOWN_SECONDS

    def disconnect_if_idle(self):
        with self._disconnect_lock:
            if self._disconnect_deadline is None:
                return
            if time.monotonic() < self._disconnect_deadline:
                return
        self._disconnect()

    def _disconnect(self):
        with self._disconnect_lock:
            app = self.app
            self.app = None
            self._disconnect_deadline = None
        if app is None:
            return
        try:
            app.Disconnect()
        except Exception:
            pass

    def close(self):
        self._disconnect()

    def write_dfm_payload(self, request):
        self._connect()
        try:
            dfm = self._dfm_method(request)
            average_data = self._average_data(dfm)
            origin_labels, data_development_labels = self._labels(dfm)
            ratio_development_labels = self._ratio_development_labels(data_development_labels)
            payload = {
                "json format": DFM_METHOD_JSON_FORMAT,
                "details tab": {
                    "name": request.get("MethodName", self._optional_value(dfm, "Name", "")),
                    "output type": request.get("OutputVector", self._nested_name(dfm, "OutputVector")),
                    "input triangle": self._nested_name(dfm, "InputTriangle"),
                    "origin length": self._optional_value(dfm, "OriginLength", ""),
                    "development length": self._optional_value(dfm, "DevelopmentLength", ""),
                    "decimal places": self._optional_value(dfm, "RatioDecimalPlaces", request.get("DecimalPlaces", 4)),
                },
                "data tab": {
                    "origin labels": origin_labels,
                    "development labels": data_development_labels,
                    "input data triangle values": [],
                    "input data triangle csv path": "",
                },
                "ratios tab": {
                    "ratio triangle": {
                        "origin labels": origin_labels,
                        "development labels": ratio_development_labels,
                        "ratio values": [],
                        "excluded": self._excluded_ratio_pattern(dfm),
                    },
                    "average formulas": average_data,
                },
                "results tab": {
                    "ratio basis dataset": self._nested_name(dfm, "SummaryRatioBasis"),
                    "ultimate ratio decimal places": self._optional_value(dfm, "SummaryRatioDecimalPlaces", 2),
                    "ultimate vector": [],
                },
                "notes tab": {
                    "notes": self._optional_value(dfm, "Notes", ""),
                },
                "method metadata": {
                    "last modified": self._json_value(self._nested_value(dfm, "OutputVector", "Modified", "")),
                },
            }
            write_json_with_compact_rows(request["DataPath"], payload, compact_row_keys=DFM_COMPACT_ROW_KEYS)
            return payload
        finally:
            self._schedule_disconnect()

    def write_sync_dfm_payload(self, request):
        self._connect()
        try:
            dfm = self._dfm_method(request)
            payload = read_json(request["MethodJsonPath"])
            excluded_count = self._sync_excluded_ratios(dfm, payload)
            selected_count = self._sync_selected_ratios(dfm, payload)
            notes_changed = self._sync_notes(dfm, payload)
            dfm.Save()
            payload = {
                "ok": True,
                "status": "passed",
                "message": "Remote database updated",
                "updated": {
                    "excluded ratios": excluded_count,
                    "selected ratios": selected_count,
                    "notes": notes_changed,
                },
            }
            write_json(request["DataPath"], payload)
            return payload
        finally:
            self._schedule_disconnect()

    def write_error(self, request, message):
        data_path = request.get("DataPath")
        if not data_path:
            return
        write_json(
            Path(data_path),
            {
                "ok": False,
                "status": "error",
                "message": str(message),
            },
        )

    def _dfm_method(self, request):
        project = self.app.Projects().Item(request["ProjectName"])
        reserving_class = project.ReservingClasses().Item(request["Path"])
        return reserving_class.DFMMethods().Item(request["MethodName"])

    def _excluded_ratio_pattern(self, dfm):
        rows = int(dfm.OriginCount)
        row_widths = [
            max(int(dfm.DevelopmentCount(origin_index)) - 1, 0)
            for origin_index in range(1, rows + 1)
        ]
        columns = max(row_widths, default=0)
        pattern = []
        for origin_index, ratio_count in enumerate(row_widths, start=1):
            row = []
            for development_index in range(1, columns + 1):
                if development_index <= ratio_count:
                    row.append(int(dfm.ExcludedRatios(origin_index, development_index)))
                else:
                    row.append(2)
            pattern.append(self._trim_trailing_mask_cells(row))
        return pattern

    def _sync_excluded_ratios(self, dfm, payload):
        ratio_triangle = self._dict_path(payload, ("ratios tab", "ratio triangle"))
        pattern = ratio_triangle.get("excluded") if isinstance(ratio_triangle, dict) else None
        if not isinstance(pattern, list):
            return 0

        origin_count = int(self._optional_value(dfm, "OriginCount", 0) or 0)
        updates = 0
        for origin_index, row in enumerate(pattern, start=1):
            if origin_index > origin_count or not isinstance(row, list):
                continue
            ratio_count = max(int(dfm.DevelopmentCount(origin_index)) - 1, 0)
            for development_index, raw_value in enumerate(row, start=1):
                if development_index > ratio_count:
                    break
                value = self._excluded_value(raw_value)
                if value is None:
                    continue
                dfm.SetExcludedRatios(OriginIndex=origin_index, DevIndex=development_index, arg2=value)
                updates += 1
        return updates

    def _excluded_value(self, value):
        if value in (0, False, "0", "false", "False"):
            return 0
        if value in (1, True, "1", "true", "True"):
            return 1
        return None

    def _sync_selected_ratios(self, dfm, payload):
        average_formulas = self._dict_path(payload, ("ratios tab", "average formulas"))
        labels = average_formulas.get("label") if isinstance(average_formulas, dict) else None
        selected = average_formulas.get("selected") if isinstance(average_formulas, dict) else None
        if not isinstance(labels, list) or not isinstance(selected, list):
            return 0

        label_to_display_index = self._average_formula_display_indexes(dfm)
        column_count = self._development_column_count(dfm)
        updates = 0
        for development_index in range(1, column_count + 1):
            selected_label = self._selected_label_for_column(labels, selected, development_index - 1)
            if not selected_label:
                continue
            display_index = label_to_display_index.get(selected_label)
            if display_index is None:
                continue
            dfm.SetSelectedRatios(DevIndex=development_index, arg1=display_index)
            updates += 1
        return updates

    def _average_formula_display_indexes(self, dfm):
        out = {}
        for api_index in range(1, 50):
            try:
                raw_name = str(dfm.AverageFormula(api_index))
            except Exception:
                break
            display_index, name = self._parse_average_formula_name(raw_name, api_index)
            out.setdefault(name, display_index)
            if name == "User Entry":
                break
        return out

    def _selected_label_for_column(self, labels, selected, column_index):
        for row_index, row in enumerate(selected):
            if row_index >= len(labels) or not isinstance(row, list) or column_index >= len(row):
                continue
            if row[column_index] in (1, True, "1", "true", "True"):
                return str(labels[row_index])
        return ""

    def _sync_notes(self, dfm, payload):
        notes_tab = self._dict_path(payload, ("notes tab",))
        if not isinstance(notes_tab, dict) or "notes" not in notes_tab:
            return False
        notes = str(notes_tab.get("notes") or "")
        dfm.Notes = notes.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")
        return True

    def _dict_path(self, payload, path):
        current = payload
        for key in path:
            if not isinstance(current, dict):
                return {}
            current = current.get(key)
        return current if isinstance(current, dict) else {}

    def _trim_trailing_mask_cells(self, row):
        out = list(row)
        while out and out[-1] == 2:
            out.pop()
        return out

    def _average_data(self, dfm):
        formula_rows = self._average_formula_rows(dfm)
        column_count = self._development_column_count(dfm)
        display_indexes = [row["display_index"] for row in formula_rows]
        selected_indexes = [
            self._selected_average_display_index(dfm, development_index, display_indexes)
            for development_index in range(1, column_count + 1)
        ]

        return {
            "label": [row["name"] for row in formula_rows],
            "custom average formula settings": {
                "averageType": [row["averageType"] for row in formula_rows],
                "base": [row["base"] for row in formula_rows],
                "periods": [row["periods"] for row in formula_rows],
                "exclude": [row["exclude"] for row in formula_rows],
            },
            "selected": [
                [1 if selected_index == row["display_index"] else 0 for selected_index in selected_indexes]
                for row in formula_rows
            ],
            "values": self._user_entry_average_formula_values(dfm, formula_rows, column_count),
        }

    def _average_formula_rows(self, dfm):
        rows = []
        for api_index in range(1, 20):
            try:
                raw_name = str(dfm.AverageFormula(api_index))
            except Exception:
                break

            display_index, name = self._parse_average_formula_name(raw_name, api_index)
            row = {
                "api_index": api_index,
                "display_index": display_index,
                "name": name,
                "is_user_entry": name == "User Entry",
            }
            row.update(self._formula_metadata(name, row["is_user_entry"]))
            rows.append(row)
            if row["is_user_entry"]:
                break
        return rows

    def _parse_average_formula_name(self, raw_name, api_index):
        match = re.match(r"^\s*(\d+)\s*:\s*(.*?)\s*$", raw_name)
        if not match:
            return api_index - 1, raw_name.strip()
        return int(match.group(1)), match.group(2)

    def _selected_average_display_index(self, dfm, development_index, display_indexes):
        try:
            selected_index = int(dfm.SelectedRatios(development_index))
        except Exception:
            return None

        display_index_set = set(display_indexes)
        if selected_index in display_index_set:
            return selected_index
        if selected_index - 1 in display_index_set:
            return selected_index - 1
        return selected_index

    def _user_entry_average_formula_values(self, dfm, formula_rows, column_count):
        values = [[] for _ in formula_rows]
        for row_index, row in enumerate(formula_rows):
            if not row["is_user_entry"]:
                continue
            values[row_index] = [
                self._snapshot_value(self._average_ratio_value(dfm, development_index, row["api_index"]))
                for development_index in range(1, column_count + 1)
            ]
            break
        return values

    def _formula_metadata(self, name, is_user_entry):
        if is_user_entry:
            return {
                "averageType": "user_entry",
                "base": "simple",
                "periods": "all",
                "exclude": 0,
            }

        match = re.match(r"^(Simple|Volume) - (all|\d+)(?: Ex hi/lo)?$", name, re.IGNORECASE)
        if match:
            periods = match.group(2).lower()
            return {
                "averageType": "custom",
                "base": match.group(1).lower(),
                "periods": "all" if periods == "all" else int(periods),
                "exclude": 1 if "ex hi/lo" in name.lower() else 0,
            }

        return {
            "averageType": "custom",
            "base": self._formula_metadata_base(name),
            "periods": "all",
            "exclude": 0,
        }

    def _formula_metadata_base(self, name):
        base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        return base or "custom"

    def _average_ratio_value(self, dfm, development_index, api_index):
        try:
            return self._json_value(dfm.AverageRatioValues(development_index, api_index))
        except Exception:
            return None

    def _labels(self, dfm):
        origin_count = int(self._optional_value(dfm, "OriginCount", 0) or 0)
        development_count = self._development_column_count(dfm)
        origin_labels = self._indexed_values(dfm, ("OriginLabel", "OriginLabels"), origin_count)
        development_labels = self._indexed_values(
            dfm,
            ("DevelopmentLabel", "DevelopmentLabels", "DevLabel", "DevLabels"),
            development_count,
        )
        return origin_labels, development_labels

    def _ratio_development_labels(self, data_development_labels):
        if len(data_development_labels) < 2:
            return data_development_labels

        parsed = [self._development_label_number(label) for label in data_development_labels]
        if any(value is None for value in parsed):
            return data_development_labels

        labels = [
            f"({index}) {parsed[index - 1]}-{parsed[index]}"
            for index in range(1, len(parsed))
        ]
        labels.append(f"{parsed[-1]} - Ult")
        return labels

    def _development_label_number(self, label):
        if isinstance(label, (int, float)) and not isinstance(label, bool):
            return int(label)
        match = re.match(r"^\s*(\d+)", str(label))
        if not match:
            return None
        return int(match.group(1))

    def _indexed_values(self, obj, attr_names, count):
        for attr_name in attr_names:
            values = []
            for index in range(1, count + 1):
                try:
                    attr = getattr(obj, attr_name)
                    value = attr(index) if callable(attr) else attr[index - 1]
                    values.append(self._json_value(value))
                except Exception:
                    values = []
                    break
            if values:
                return values
        return []

    def _development_column_count(self, dfm):
        rows = int(dfm.OriginCount)
        if rows <= 0:
            return 0
        return max(int(dfm.DevelopmentCount(origin_index)) for origin_index in range(1, rows + 1))

    def _optional_value(self, obj, attr_name, default):
        try:
            value = getattr(obj, attr_name)
            if callable(value):
                value = value()
            return value
        except Exception:
            return default

    def _nested_name(self, obj, attr_name):
        try:
            value = getattr(obj, attr_name)
            return value.Name
        except Exception:
            return ""

    def _nested_value(self, obj, attr_name, nested_attr_name, default):
        try:
            value = getattr(obj, attr_name)
            nested_value = getattr(value, nested_attr_name)
            if callable(nested_value):
                nested_value = nested_value()
            return nested_value
        except Exception:
            return default

    def _json_value(self, value):
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        try:
            return float(value)
        except Exception:
            pass
        return str(value)

    def _snapshot_value(self, value):
        value = self._json_value(value)
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, (int, float)):
            return round(value, 4)
        return value

