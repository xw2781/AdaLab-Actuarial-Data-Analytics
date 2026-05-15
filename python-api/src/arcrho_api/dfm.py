"""DFM method object and production migration helpers."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

from .exceptions import DfmDataError, InvalidDfmJsonError
from .io import read_json, write_json_atomic
from .paths import DFM_JSON_FORMAT, clean_text

if TYPE_CHECKING:
    from .reserving_class import ReservingClass


def _tab(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    if isinstance(value, dict):
        return value
    value = {}
    payload[key] = value
    return value


def _get_tab(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _matrix(value: Any) -> list[list[Any]]:
    return value if isinstance(value, list) else []


def _coerce_matrix(value: Any) -> list[list[Any]]:
    if not isinstance(value, list):
        return []
    return [row if isinstance(row, list) else [] for row in value]


def _matrix_shape(reference: list[list[Any]]) -> tuple[int, int]:
    rows = len(reference)
    cols = max((len(row) for row in reference if isinstance(row, list)), default=0)
    return rows, cols


def _ensure_matrix(container: dict[str, Any], key: str, rows: int, cols: int, fill: Any = 0) -> list[list[Any]]:
    existing = _coerce_matrix(container.get(key))
    while len(existing) < rows:
        existing.append([])
    for row in existing:
        while len(row) < cols:
            row.append(fill)
    if rows >= 0:
        existing = existing[:rows]
    for index, row in enumerate(existing):
        existing[index] = row[:cols]
    container[key] = existing
    return existing


def _normalize_label(value: Any) -> str:
    return " ".join(str(value if value is not None else "").split()).strip()


def _label_key(value: Any) -> str:
    label = _normalize_label(value)
    if ":" in label:
        prefix, rest = label.split(":", 1)
        if prefix.strip().isdigit():
            label = rest.strip()
    return label.lower()


def _as_col_index(dev_period: int) -> int:
    try:
        col = int(dev_period) - 1
    except (TypeError, ValueError) as err:
        raise DfmDataError(f"Development period must be an integer: {dev_period!r}") from err
    if col < 0:
        raise DfmDataError(f"Development period must be 1-based and positive: {dev_period!r}")
    return col


def _dev_periods_to_cols(dev_periods: int | Iterable[int] | str, col_count: int) -> list[int]:
    if isinstance(dev_periods, str):
        text = dev_periods.strip().lower()
        if text in {"", "all", "*"}:
            return list(range(col_count))
        return [_as_col_index(int(text))]
    if isinstance(dev_periods, int):
        return [_as_col_index(dev_periods)]
    return [_as_col_index(value) for value in dev_periods]


def _is_number(value: Any) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return number == number and number not in (float("inf"), float("-inf"))


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


class DfmMethod:
    """One ArcRho DFM method JSON file."""

    def __init__(self, reserving_class: "ReservingClass", name: str, payload: dict[str, Any], file_path: Path) -> None:
        self.reserving_class_obj = reserving_class
        self.project = reserving_class.project
        self.project_name = reserving_class.project.name
        self.reserving_class = reserving_class.path
        self.name = clean_text(name)
        self.file_path = file_path
        self.payload = payload
        self._ensure_grouped_payload()

    @classmethod
    def load_existing(cls, reserving_class: "ReservingClass", name: str) -> "DfmMethod":
        file_path = reserving_class.project.dfm_path(reserving_class.path, name)
        if not file_path.exists():
            raise InvalidDfmJsonError(f"DFM method JSON not found: {file_path}")
        payload = read_json(file_path)
        return cls(reserving_class, name, payload, file_path)

    @classmethod
    def new(
        cls,
        reserving_class: "ReservingClass",
        name: str,
        *,
        output_vector: str,
        input_triangle: str,
        origin_length: int,
        development_length: int,
        decimal_places: int = 4,
        notes: str = "",
        **extra: Any,
    ) -> "DfmMethod":
        method_name = clean_text(name)
        payload: dict[str, Any] = {
            "json format": DFM_JSON_FORMAT,
            "details tab": {
                "name": method_name,
                "output type": clean_text(output_vector),
                "input triangle": clean_text(input_triangle),
                "origin length": int(origin_length),
                "development length": int(development_length),
                "decimal places": int(decimal_places),
            },
            "data tab": {
                "origin labels": [],
                "development labels": [],
                "input data triangle values": [],
                "input data triangle csv path": "",
            },
            "ratios tab": {
                "ratio triangle": {
                    "origin labels": [],
                    "development labels": [],
                    "ratio values": [],
                    "excluded": [],
                },
                "average formulas": _default_average_formulas(),
                "percent developed curve": {
                    "x-axis label": "Development Month",
                    "selected curves": [],
                },
            },
            "results tab": {
                "ratio basis dataset": "",
                "ultimate ratio decimal places": 2,
                "ultimate vector": [],
            },
            "notes tab": {
                "notes": str(notes or ""),
            },
            "method metadata": {
                "last modified": _now_iso(),
            },
        }
        if extra:
            payload["api metadata"] = {"new_dfm extra": extra}
        return cls(
            reserving_class,
            method_name,
            payload,
            reserving_class.project.dfm_path(reserving_class.path, method_name),
        )

    def load(self) -> "DfmMethod":
        self.payload = read_json(self.file_path)
        self._ensure_grouped_payload()
        return self

    def to_dict(self) -> dict[str, Any]:
        return deepcopy(self.payload)

    def save(self) -> Path:
        self._sync_details_identity()
        _tab(self.payload, "method metadata")["last modified"] = _now_iso()
        path = write_json_atomic(self.file_path, self.payload, read_only=self.project.read_only)
        self.project.rebuild_dfm_index()
        return path

    @property
    def output_vector(self) -> str:
        return clean_text(self.details.get("output type"))

    @property
    def input_triangle(self) -> str:
        return clean_text(self.details.get("input triangle"))

    @property
    def origin_length(self) -> int | None:
        return _int_or_none(self.details.get("origin length"))

    @property
    def development_length(self) -> int | None:
        return _int_or_none(self.details.get("development length"))

    @property
    def decimal_places(self) -> int | None:
        return _int_or_none(self.details.get("decimal places"))

    @property
    def notes(self) -> str:
        return str(self.notes_tab.get("notes") or "")

    @property
    def last_modified(self) -> str:
        return clean_text(self.metadata.get("last modified"))

    @property
    def details(self) -> dict[str, Any]:
        return _tab(self.payload, "details tab")

    @property
    def data_tab(self) -> dict[str, Any]:
        return _tab(self.payload, "data tab")

    @property
    def ratios_tab(self) -> dict[str, Any]:
        return _tab(self.payload, "ratios tab")

    @property
    def ratio_triangle(self) -> dict[str, Any]:
        return _tab(self.ratios_tab, "ratio triangle")

    @property
    def average_formulas(self) -> dict[str, Any]:
        return _tab(self.ratios_tab, "average formulas")

    @property
    def results_tab(self) -> dict[str, Any]:
        return _tab(self.payload, "results tab")

    @property
    def notes_tab(self) -> dict[str, Any]:
        return _tab(self.payload, "notes tab")

    @property
    def metadata(self) -> dict[str, Any]:
        return _tab(self.payload, "method metadata")

    def update_details(self, **fields: Any) -> "DfmMethod":
        mapping = {
            "name": "name",
            "output_vector": "output type",
            "output_type": "output type",
            "input_triangle": "input triangle",
            "origin_length": "origin length",
            "development_length": "development length",
            "decimal_places": "decimal places",
        }
        for key, value in fields.items():
            target = mapping.get(key, key.replace("_", " "))
            self.details[target] = value
            if target == "name":
                self.name = clean_text(value)
                self.file_path = self.project.dfm_path(self.reserving_class, self.name)
        return self

    def update_notes(self, text: str) -> "DfmMethod":
        self.notes_tab["notes"] = str(text or "")
        return self

    def add_notes(self, text: str, *, append: bool = True, add_space: bool | None = None) -> "DfmMethod":
        new_text = str(text or "")
        if not append:
            return self.update_notes(new_text)
        existing = self.notes
        if not existing:
            return self.update_notes(new_text)
        separator = "\n\n" if add_space is not False else "\n"
        return self.update_notes(f"{existing}{separator}{new_text}")

    def clear_notes(self) -> "DfmMethod":
        return self.update_notes("")

    def selected_average_formulas(self) -> dict[str, Any]:
        return deepcopy(self.average_formulas)

    def set_ratio_exclusions(self, matrix: list[list[bool | int]]) -> "DfmMethod":
        self.ratio_triangle["excluded"] = [[1 if cell else 0 for cell in row] for row in matrix]
        return self

    def clear(self) -> "DfmMethod":
        rows, cols = self._ratio_shape()
        if rows and cols:
            self.ratio_triangle["excluded"] = [[0 for _ in range(cols)] for _ in range(rows)]
        selected = _coerce_matrix(self.average_formulas.get("selected"))
        if selected:
            self.average_formulas["selected"] = [[0 for _ in row] for row in selected]
        return self

    def include_all_ratios(self) -> "DfmMethod":
        rows, cols = self._ratio_shape()
        self.ratio_triangle["excluded"] = [[0 for _ in range(cols)] for _ in range(rows)]
        return self

    def exclude_high(self, dev_period: int, count: int = 1, reason: str = "") -> "DfmMethod":
        return self._exclude_extreme(dev_period, count, high=True, reason=reason)

    def exclude_low(self, dev_period: int, count: int = 1, reason: str = "") -> "DfmMethod":
        return self._exclude_extreme(dev_period, count, high=False, reason=reason)

    def select_high(self, dev_period: int, count: int = 1, reason: str = "") -> "DfmMethod":
        return self._select_extreme(dev_period, count, high=True, reason=reason)

    def select_low(self, dev_period: int, count: int = 1, reason: str = "") -> "DfmMethod":
        return self._select_extreme(dev_period, count, high=False, reason=reason)

    def exclude_l_df(self, dev_period: int, row: int | str, reason: str = "", add_notes: bool = True) -> "DfmMethod":
        col = _as_col_index(dev_period)
        row_index = self._resolve_row(row)
        excluded = self._excluded_matrix()
        self._set_excluded_cell(excluded, row_index, col, 1)
        if reason and add_notes:
            self.add_notes(reason)
        return self

    def exclude_row(self, row: int | str, add_notes: bool = False) -> "DfmMethod":
        row_index = self._resolve_row(row)
        excluded = self._excluded_matrix()
        for col in range(len(excluded[row_index])):
            excluded[row_index][col] = 1
        if add_notes:
            self.add_notes(f"Excluded row {row}.")
        return self

    def exclude_origin_year(self, origin_year: int | str, reason: str = "") -> "DfmMethod":
        return self.exclude_row(origin_year).add_notes(reason) if reason else self.exclude_row(origin_year)

    def exclude_covid_years(self, years: Iterable[int] | None = None) -> "DfmMethod":
        target_years = list(years if years is not None else (2020, 2021))
        labels = self._origin_labels()
        for year in target_years:
            for index, label in enumerate(labels):
                if str(year) in str(label):
                    self.exclude_row(index + 1)
        return self

    def exclude_diagonal(
        self,
        dev_index: int,
        start_row: int | None = None,
        end_row: int | None = None,
        reason: str = "",
        add_notes: bool = True,
    ) -> "DfmMethod":
        rows, cols = self._ratio_shape()
        if not rows or not cols:
            raise DfmDataError("DFM has no ratio triangle values.")
        start = 0 if start_row is None else max(0, int(start_row) - 1)
        end = rows - 1 if end_row is None else min(rows - 1, int(end_row) - 1)
        excluded = self._excluded_matrix()
        diag = max(0, int(dev_index))
        for row in range(start, end + 1):
            col = cols - 1 - (row - start) - diag
            if 0 <= col < cols:
                excluded[row][col] = 1
        if reason and add_notes:
            self.add_notes(reason)
        return self

    def set_selected_average(self, label: str, dev_periods: int | Iterable[int] | str = "all") -> "DfmMethod":
        labels = self._average_labels()
        row_index = self._ensure_average_label(label)
        col_count = self._average_col_count()
        selected = _ensure_matrix(self.average_formulas, "selected", len(self._average_labels()), col_count, 0)
        for col in _dev_periods_to_cols(dev_periods, col_count):
            self._require_col(col, col_count)
            for row in selected:
                row[col] = 0
            selected[row_index][col] = 1
        # Keep labels variable referenced after possible row creation.
        _ = labels
        return self

    def set_user_ratio(self, value: float, dev_period: int, row_index: int | None = None) -> "DfmMethod":
        target_row = self._ensure_average_label("User Entry")
        if row_index is not None:
            target_row = max(0, int(row_index))
            self._ensure_average_row_count(target_row + 1)
        col_count = self._average_col_count()
        values = _ensure_matrix(self.average_formulas, "values", len(self._average_labels()), col_count, None)
        col = _as_col_index(dev_period)
        self._require_col(col, col_count)
        values[target_row][col] = float(value)
        return self.set_selected_average(self._average_labels()[target_row], dev_period)

    def copy_average_formula_patterns(self, source: "DfmMethod") -> "DfmMethod":
        self.ratios_tab["average formulas"] = deepcopy(source.average_formulas)
        return self

    def copy_ratio_patterns(self, source: "DfmMethod") -> "DfmMethod":
        self.ratio_triangle["excluded"] = deepcopy(source.ratio_triangle.get("excluded", []))
        return self

    def set_tail_value(
        self,
        dev_period: int,
        values: Iterable[float] | None = None,
        *,
        n_year: int | None = None,
        years: int | None = None,
        exclude: str | None = None,
        value_list: Iterable[float] | None = None,
        historical_ratio_data: Any = None,
    ) -> "DfmMethod":
        source_values = list(values if values is not None else (value_list if value_list is not None else []))
        if not source_values:
            raise DfmDataError("set_tail_value requires values or value_list.")
        start_col = _as_col_index(dev_period)
        for offset, value in enumerate(source_values):
            self.set_user_ratio(float(value), start_col + offset + 1)
        note_bits = [f"Tail values set from development period {dev_period}"]
        lookback = years if years is not None else n_year
        if lookback is not None:
            note_bits.append(f"years={lookback}")
        if exclude:
            note_bits.append(f"exclude={exclude}")
        if historical_ratio_data is not None:
            note_bits.append("historical ratio data supplied")
        self.add_notes("; ".join(note_bits))
        return self

    def apply_adjustments(self, selection: str | None = None, *args: Any, **kwargs: Any) -> "DfmMethod":
        if selection:
            self.set_selected_average(selection)
        return self

    def set_custom_averages(
        self,
        avg_index: int | None = None,
        avg_name: str | None = None,
        periods_included: int | str = "all",
        weight_type: str = "simple",
        ex_hi_lo: int = 0,
    ) -> "DfmMethod":
        label = avg_name or f"{str(weight_type).title()} - {periods_included}"
        row = self._ensure_average_label(label)
        settings = self._average_settings()
        self._ensure_settings_len(settings, len(self._average_labels()))
        settings["averageType"][row] = "custom"
        settings["base"][row] = str(weight_type).lower()
        settings["periods"][row] = periods_included
        settings["exclude"][row] = int(ex_hi_lo or 0)
        return self

    def selected_cumulative_factor(self, dev_index: int) -> float | None:
        values = self._selected_ratio_values()
        idx = int(dev_index)
        if idx < 0 or idx >= len(values):
            return None
        running = 1.0
        for value in values[idx:]:
            if value is None:
                return None
            running *= value
        return running

    def dev_period(self, index: int, format: int = 0) -> str:
        labels = self.ratio_triangle.get("development labels") or self.data_tab.get("development labels") or []
        idx = int(index)
        if 0 <= idx < len(labels):
            return str(labels[idx])
        return str(idx + 1)

    def dev_month(self, index: int) -> float | None:
        label = self.dev_period(index)
        digits = "".join(ch if ch.isdigit() or ch == "." else " " for ch in label).split()
        if not digits:
            return None
        return _number(digits[-1])

    def ratio(self, row: int, column: int) -> Any:
        values = _coerce_matrix(self.ratio_triangle.get("ratio values"))
        row_index = self._resolve_row(row)
        col_index = _as_col_index(column)
        try:
            return values[row_index][col_index]
        except IndexError as err:
            raise DfmDataError(f"Ratio cell not found at row={row}, column={column}.") from err

    def ultimate(self, row: int) -> Any:
        vector = self.results_tab.get("ultimate vector")
        if not isinstance(vector, list):
            return None
        row_index = self._resolve_row(row)
        try:
            return vector[row_index]
        except IndexError as err:
            raise DfmDataError(f"Ultimate value not found at row={row}.") from err

    def selected_ratio(self, dev_period: int) -> float | None:
        values = self._selected_ratio_values()
        col = _as_col_index(dev_period)
        return values[col] if 0 <= col < len(values) else None

    def results_dataframe(self):
        try:
            import pandas as pd
        except ImportError as err:
            raise DfmDataError("Install the pandas extra to use results_dataframe(): pip install arcrho-api[pandas]") from err
        origin_labels = self._origin_labels()
        ultimate = self.results_tab.get("ultimate vector")
        if not isinstance(ultimate, list):
            ultimate = []
        row_count = max(len(origin_labels), len(ultimate))
        return pd.DataFrame(
            {
                "origin": [origin_labels[i] if i < len(origin_labels) else i + 1 for i in range(row_count)],
                "ultimate": [ultimate[i] if i < len(ultimate) else None for i in range(row_count)],
            }
        )

    # Legacy aliases used by production notebooks.
    ex_hi = exclude_high
    ex_lo = exclude_low
    select_high = select_high
    select_low = select_low
    ex_LDF = exclude_l_df
    ex_row = exclude_row
    ex_AY = exclude_origin_year
    ex_COVID_AY = exclude_covid_years
    ex_diagonal = exclude_diagonal
    set_selected_estimate = set_selected_average
    set_user_value = set_user_ratio
    set_average_formula_patterns = copy_average_formula_patterns
    set_ratio_patterns = copy_ratio_patterns

    def view(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self.to_dict()

    def plot_diagnostics(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self.to_dict()

    def plot_ultimates(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self.to_dict()

    def quick_preview(self) -> dict[str, Any]:
        return self.to_dict()

    def prior(self, index: int = -1) -> "DfmMethod":
        raise DfmDataError("Prior-version lookup is not implemented in phase one.")

    def view_prior(self, index: int = -1) -> "DfmMethod":
        return self.prior(index)

    def view_prior_notes(self, index: int = -1) -> str:
        return self.prior(index).notes

    def info(self) -> dict[str, Any]:
        return {
            "project": self.project_name,
            "reserving_class": self.reserving_class,
            "name": self.name,
            "path": str(self.file_path),
            "output_vector": self.output_vector,
            "input_triangle": self.input_triangle,
            "origin_length": self.origin_length,
            "development_length": self.development_length,
        }

    def _ensure_grouped_payload(self) -> None:
        if not isinstance(self.payload, dict):
            raise InvalidDfmJsonError("DFM payload must be a JSON object.")
        self.payload.setdefault("json format", DFM_JSON_FORMAT)
        if self.payload.get("json format") != DFM_JSON_FORMAT:
            raise InvalidDfmJsonError(
                f"Unsupported DFM JSON format: {self.payload.get('json format')!r}. "
                f"Expected {DFM_JSON_FORMAT!r}."
            )
        _tab(self.payload, "details tab")
        _tab(self.payload, "data tab")
        ratios = _tab(self.payload, "ratios tab")
        _tab(ratios, "ratio triangle")
        _tab(ratios, "average formulas")
        _tab(self.payload, "results tab")
        _tab(self.payload, "notes tab")
        _tab(self.payload, "method metadata")
        self._sync_details_identity()

    def _sync_details_identity(self) -> None:
        self.details.setdefault("name", self.name)
        self.details["name"] = clean_text(self.details.get("name")) or self.name
        self.name = clean_text(self.details.get("name"))

    def _ratio_values(self) -> list[list[Any]]:
        values = _coerce_matrix(self.ratio_triangle.get("ratio values"))
        if not values:
            values = _coerce_matrix(self.data_tab.get("input data triangle values"))
        return values

    def _ratio_shape(self) -> tuple[int, int]:
        return _matrix_shape(self._ratio_values() or _coerce_matrix(self.ratio_triangle.get("excluded")))

    def _excluded_matrix(self) -> list[list[Any]]:
        rows, cols = self._ratio_shape()
        if not rows or not cols:
            raise DfmDataError("DFM has no ratio triangle values or exclusion matrix.")
        return _ensure_matrix(self.ratio_triangle, "excluded", rows, cols, 0)

    def _set_excluded_cell(self, excluded: list[list[Any]], row: int, col: int, value: int) -> None:
        if row < 0 or row >= len(excluded):
            raise DfmDataError(f"Ratio row out of range: {row + 1}")
        if col < 0 or col >= len(excluded[row]):
            raise DfmDataError(f"Ratio development period out of range: {col + 1}")
        excluded[row][col] = value

    def _exclude_extreme(self, dev_period: int, count: int, *, high: bool, reason: str = "") -> "DfmMethod":
        col = _as_col_index(dev_period)
        candidates = self._ratio_candidates(col)
        if not candidates:
            raise DfmDataError(f"No numeric ratio values found for development period {dev_period}.")
        ordered = sorted(candidates, key=lambda item: item[1], reverse=high)
        excluded = self._excluded_matrix()
        for row, _value in ordered[: max(0, int(count))]:
            excluded[row][col] = 1
        if reason:
            self.add_notes(reason)
        return self

    def _select_extreme(self, dev_period: int, count: int, *, high: bool, reason: str = "") -> "DfmMethod":
        col = _as_col_index(dev_period)
        candidates = self._ratio_candidates(col)
        if not candidates:
            raise DfmDataError(f"No numeric ratio values found for development period {dev_period}.")
        keep = {row for row, _value in sorted(candidates, key=lambda item: item[1], reverse=high)[: max(0, int(count))]}
        excluded = self._excluded_matrix()
        for row, _value in candidates:
            excluded[row][col] = 0 if row in keep else 1
        if reason:
            self.add_notes(reason)
        return self

    def _ratio_candidates(self, col: int) -> list[tuple[int, float]]:
        values = self._ratio_values()
        rows, cols = _matrix_shape(values)
        self._require_col(col, cols)
        out: list[tuple[int, float]] = []
        for row_index in range(rows):
            row = values[row_index] if row_index < len(values) else []
            if col >= len(row):
                continue
            number = _number(row[col])
            if number is not None:
                out.append((row_index, number))
        return out

    def _origin_labels(self) -> list[Any]:
        labels = self.data_tab.get("origin labels")
        if not isinstance(labels, list):
            labels = self.ratio_triangle.get("origin labels")
        return labels if isinstance(labels, list) else []

    def _resolve_row(self, row: int | str) -> int:
        if isinstance(row, int):
            index = row - 1 if row > 0 else row
            if index < 0:
                raise DfmDataError(f"Row must be 1-based and positive: {row}")
            return index
        text = clean_text(row)
        labels = self._origin_labels()
        for index, label in enumerate(labels):
            if clean_text(label) == text or text in clean_text(label):
                return index
        if text.isdigit():
            year = text
            for index, label in enumerate(labels):
                if year in clean_text(label):
                    return index
            return int(text) - 1
        raise DfmDataError(f"Could not resolve origin row: {row!r}")

    def _average_labels(self) -> list[str]:
        labels = self.average_formulas.get("label")
        if not isinstance(labels, list):
            labels = []
            self.average_formulas["label"] = labels
        return [_normalize_label(label) for label in labels]

    def _average_settings(self) -> dict[str, list[Any]]:
        settings = self.average_formulas.get("custom average formula settings")
        if not isinstance(settings, dict):
            settings = {}
            self.average_formulas["custom average formula settings"] = settings
        for key in ("averageType", "base", "periods", "exclude"):
            if not isinstance(settings.get(key), list):
                settings[key] = []
        return settings  # type: ignore[return-value]

    def _ensure_settings_len(self, settings: dict[str, list[Any]], length: int) -> None:
        defaults = {
            "averageType": "custom",
            "base": "",
            "periods": "all",
            "exclude": 0,
        }
        for key, default in defaults.items():
            values = settings.setdefault(key, [])
            while len(values) < length:
                values.append(default)

    def _ensure_average_row_count(self, row_count: int) -> None:
        labels = self.average_formulas.setdefault("label", [])
        while len(labels) < row_count:
            labels.append(f"User Entry {len(labels) + 1}")
        settings = self._average_settings()
        self._ensure_settings_len(settings, row_count)
        col_count = self._average_col_count()
        _ensure_matrix(self.average_formulas, "selected", row_count, col_count, 0)
        _ensure_matrix(self.average_formulas, "values", row_count, col_count, None)

    def _ensure_average_label(self, label: str) -> int:
        wanted = _label_key(label)
        labels = self.average_formulas.setdefault("label", [])
        for index, existing in enumerate(labels):
            if _label_key(existing) == wanted:
                return index
        labels.append(_normalize_label(label))
        row = len(labels) - 1
        settings = self._average_settings()
        self._ensure_settings_len(settings, len(labels))
        inferred = _infer_average_settings(label)
        if inferred:
            settings["averageType"][row] = "custom"
            settings["base"][row] = inferred["base"]
            settings["periods"][row] = inferred["periods"]
            settings["exclude"][row] = inferred["exclude"]
        self._ensure_average_row_count(len(labels))
        return row

    def _average_col_count(self) -> int:
        selected = _coerce_matrix(self.average_formulas.get("selected"))
        values = _coerce_matrix(self.average_formulas.get("values"))
        ratio_rows, ratio_cols = self._ratio_shape()
        labels = self.ratio_triangle.get("development labels")
        label_count = len(labels) if isinstance(labels, list) else 0
        return max(_matrix_shape(selected)[1], _matrix_shape(values)[1], ratio_cols, label_count, 1)

    def _require_col(self, col: int, col_count: int) -> None:
        if col < 0 or col >= col_count:
            raise DfmDataError(f"Development period out of range: {col + 1}; available columns: {col_count}")

    def _selected_ratio_values(self) -> list[float | None]:
        labels = self._average_labels()
        selected = _coerce_matrix(self.average_formulas.get("selected"))
        values = _coerce_matrix(self.average_formulas.get("values"))
        col_count = self._average_col_count()
        out: list[float | None] = [None] * col_count
        for col in range(col_count):
            row_index = None
            for row, selected_row in enumerate(selected):
                if col < len(selected_row) and bool(selected_row[col]):
                    row_index = row
                    break
            if row_index is None:
                continue
            if row_index < len(values) and col < len(values[row_index]):
                out[col] = _number(values[row_index][col])
        _ = labels
        return out


def _default_average_formulas() -> dict[str, Any]:
    return {
        "label": ["Volume - all", "Simple - all", "User Entry"],
        "custom average formula settings": {
            "averageType": ["custom", "custom", "user_entry"],
            "base": ["volume", "simple", ""],
            "periods": ["all", "all", "all"],
            "exclude": [0, 0, 0],
        },
        "selected": [],
        "values": [],
    }


def _infer_average_settings(label: str) -> dict[str, Any] | None:
    import re

    normalized = _normalize_label(label)
    match = re.match(r"^(volume|simple)\s*-\s*(all|[1-9]\d*)(?:\s+ex\s+hi/lo(?:\s*x\s*([1-9]\d*))?)?$", normalized, re.I)
    if not match:
        if normalized.lower().startswith("user"):
            return {"base": "", "periods": "all", "exclude": 0}
        return None
    periods: str | int = match.group(2).lower()
    if periods != "all":
        periods = int(periods)
    exclude = int(match.group(3) or 0)
    if "ex hi/lo" in normalized.lower() and exclude == 0:
        exclude = 1
    return {"base": match.group(1).lower(), "periods": periods, "exclude": exclude}


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

