# ArcRho API Agent Reference

## Package Scope

The package lives under `python-api/` and imports as `arcrho_api`.

Phase one covers:

- ArcRho Server root validation.
- Project listing/opening.
- Reserving-class scoped access.
- DFM method discovery, load, create, mutate, and save.
- Production DFM helper methods used by reserve-review notebooks.

Phase one does not cover full dataset generation, Excel preview automation, RPC bridge orchestration, BF/Cape Cod/Result Selection APIs, or full Vector/Triangle editing.

## Public Entry Points

```python
from arcrho_api import ArcRhoClient

client = ArcRhoClient(r"E:\ArcRho Server")
project = client.project("Project Name")
rc = project.reserving_class(r"Segment\Path")
dfm = rc.dfm("Method Name")
```

Legacy migration:

```python
from arcrho_api.migration import ArcRhoSession

session = ArcRhoSession(r"E:\ArcRho Server")
session.set_project("Project Name")
session.set_reserving_class(r"Segment\Path")
dfm = session.DFM("Method Name")
```

## DFM JSON Contract

Only the grouped GUI shape is supported:

```text
json format = arcrho-dfm-method-by-tab-v1
details tab
data tab
ratios tab
results tab
notes tab
method metadata
```

Save behavior:

- Preserve unknown JSON fields.
- Update `method metadata.last modified`.
- Write with a temporary file and atomic replace.
- Rebuild `dfm_method_index.json`.
- Refuse writes when the client is `read_only=True`.

## Filename Rules

DFM methods are stored as:

```text
projects/<project>/methods/DFM@<ReservingClass>@<Name>.json
```

The reserving-class filename component uses `^` for Windows-invalid filename characters. The method-name component uses `_` for invalid filename characters.

## Testing

From repo root:

```powershell
python -m unittest discover -s python-api\tests
```

