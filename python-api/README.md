# ArcRho Python API

`arcrho-api` is a first-party Python package for scripting ArcRho project and DFM workflows against an ArcRho Server root folder.

```python
from arcrho_api import ArcRhoClient

client = ArcRhoClient(r"E:\ArcRho Server")
project = client.project("Current Reserve Review")
rc = project.reserving_class(r"Auto\Private Passenger")

dfm = rc.dfm("Paid Loss Ultimate")
dfm.clear()
dfm.exclude_covid_years()
dfm.set_selected_average("Simple - 3")
dfm.save()
```

The package is read/write by default, but writes are explicit: mutations stay in memory until `save()` is called. Use `read_only=True` for audit/exploration workflows.

```python
client = ArcRhoClient(r"E:\ArcRho Server", read_only=True)
```

For legacy notebook migration, `ArcRhoSession` provides a context-bound style with familiar names:

```python
from arcrho_api.migration import ArcRhoSession

session = ArcRhoSession(r"E:\ArcRho Server")
session.set_project("Current Reserve Review")
session.set_reserving_class(r"Auto\Private Passenger")

dfm = session.DFM("Paid Loss Ultimate")
dfm.ex_COVID_AY()
dfm.set_selected_estimate("Simple - 3")
dfm.save()
```

