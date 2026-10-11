"""
Re-exports live master data (district/taluka/village, societies, crops,
schemes, machines, option lists) into data/master_data_seed.json, so
`seed.py` stays in sync after an admin edits master data through the
Master Data screen — rather than that data only ever existing in the
database and silently drifting away from what a fresh seed/dev environment
gets.

Usage:
    DATABASE_URL=<postgres DSN, or omit for the local sqlite file> \
        python -m app.export_master_data

Run this against whichever database currently holds the data you want
captured (point DATABASE_URL at production to pull its current state,
or leave it unset to export from the local dev DB), then commit the
updated data/master_data_seed.json.
"""
import json
import os

from .db import SessionLocal
from . import models as m


def export_master_data() -> dict:
    db = SessionLocal()
    try:
        districts = db.query(m.District).all()
        talukas = db.query(m.Taluka).all()
        villages = db.query(m.Village).all()
        societies = db.query(m.Society).all()
        crops = db.query(m.CropMaster).all()
        schemes = db.query(m.SchemeMaster).all()
        machines = db.query(m.MachineMaster).order_by(m.MachineMaster.sort_order).all()
        options = db.query(m.OptionMaster).order_by(m.OptionMaster.list_code, m.OptionMaster.sort_order).all()

        district_by_id = {d.id: d.name for d in districts}
        taluka_by_id = {t.id: {"name": t.name, "district": district_by_id[t.district_id]} for t in talukas}

        geo: dict = {d.name: {} for d in districts}
        for t in talukas:
            geo[district_by_id[t.district_id]][t.name] = []
        for v in villages:
            tinfo = taluka_by_id[v.taluka_id]
            geo[tinfo["district"]][tinfo["name"]].append(v.name)

        society_rows = [
            {
                "name": s.name,
                "district": district_by_id.get(s.district_id) if s.district_id else None,
                "taluka": taluka_by_id.get(s.taluka_id, {}).get("name") if s.taluka_id else None,
                "is_state_level": s.is_state_level,
            }
            for s in societies
        ]

        option_lists: dict = {}
        for o in options:
            option_lists.setdefault(o.list_code, []).append(o.label)

        return {
            "geo": geo,
            "societies": society_rows,
            "crops": [c.name for c in crops],
            "schemes": [s.name for s in schemes],
            "machines": [mc.name for mc in machines],
            "option_lists": option_lists,
        }
    finally:
        db.close()


if __name__ == "__main__":
    data = export_master_data()
    out_path = os.path.join(os.path.dirname(__file__), "data", "master_data_seed.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {out_path}")
    print(f"districts={len(data['geo'])} "
          f"talukas={sum(len(t) for t in data['geo'].values())} "
          f"villages={sum(len(v) for t in data['geo'].values() for v in t.values())} "
          f"societies={len(data['societies'])} crops={len(data['crops'])} "
          f"schemes={len(data['schemes'])} machines={len(data['machines'])} "
          f"option_codes={len(data['option_lists'])}")
