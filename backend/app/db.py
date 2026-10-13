import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import get_settings

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "arecanut.db")

# Production deploys set DATABASE_URL to a real PostgreSQL DSN, e.g.
#   postgresql+psycopg2://user:password@host:5432/arecanut
# Local development falls back to a SQLite file so the app still runs
# with zero external services. Same models/migrations work on both.
settings = get_settings()
DATABASE_URL = settings.DATABASE_URL or f"sqlite:///{DB_PATH}"

# Neon/Heroku-style URLs use the "postgres://" scheme, which SQLAlchemy 2.x
# no longer accepts — normalize to the psycopg2 dialect SQLAlchemy expects.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgresql://"):]

if settings.is_production and DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("Refusing to start in production against SQLite — set DATABASE_URL to a real database.")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sync_missing_columns():
    """
    Lightweight, idempotent auto-migration: adds any mapped column that
    exists in the SQLAlchemy models but not yet in the actual database table
    (via ALTER TABLE ... ADD COLUMN). This app has no real migration tooling
    wired up (Alembic is listed but unconfigured), and Base.metadata.create_all()
    only ever creates missing *tables* — it silently does nothing for a column
    added to an existing model, which would otherwise break every query
    against that table in production the moment new code deploys.

    Safe to call on every startup: each column is only added if genuinely
    missing, so a warm/repeat call is just an inspection query.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue  # a brand-new table — create_all() already handled it
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_cols:
                continue
            col_type = column.type.compile(dialect=engine.dialect)
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'
            with engine.begin() as conn:
                conn.execute(text(ddl))


def sync_nullable_columns():
    """
    Companion to sync_missing_columns() above: relaxes a column from NOT
    NULL to nullable in the live database when the SQLAlchemy model has
    made it nullable=True but the existing table still enforces NOT NULL.
    `ALTER TABLE ... ADD COLUMN` never retroactively loosens an *existing*
    column's constraint, and this app has no real migration tool — this
    is what made Save-as-Draft possible without a hand-run one-off
    migration: FarmerSurvey's many previously-mandatory columns (farmer_name,
    village, sale_type, etc.) were flipped to nullable=True in models.py so a
    draft can leave them blank, and this closes the gap on the DB side.

    Postgres-only: SQLite's ALTER TABLE cannot drop a NOT NULL constraint at
    all, which only matters for local dev — a local sqlite db with a stale
    constraint should just be deleted and reseeded (disposable dev data),
    never a concern in production, which refuses to start on SQLite anyway.

    Safe to call on every startup: only alters a column that's genuinely
    still NOT NULL when the model says otherwise, so a warm/repeat call is
    just an inspection query.
    """
    from sqlalchemy import inspect, text

    if engine.dialect.name != "postgresql":
        return

    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing_cols = {c["name"]: c for c in inspector.get_columns(table.name)}
        for column in table.columns:
            info = existing_cols.get(column.name)
            if not info:
                continue  # sync_missing_columns() handles a genuinely new column
            if column.nullable and not info["nullable"]:
                ddl = f'ALTER TABLE "{table.name}" ALTER COLUMN "{column.name}" DROP NOT NULL'
                with engine.begin() as conn:
                    conn.execute(text(ddl))


def migrate_roles_and_permissions():
    """
    One-time-per-deploy data fixup, safe to call on every startup (idempotent):
    - Renames the old "enumerator" role to "field" (the role model changed from
      admin/enumerator to admin/field with per-user module permissions).
    - Backfills a default permission set for any "field" user left with a NULL
      `permissions` column — ALTER TABLE ADD COLUMN (see sync_missing_columns
      above) does not retroactively apply a Python-side ORM default to existing
      rows, only to new inserts, so this closes that gap explicitly.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if not inspector.has_table("auth_user"):
        return
    cols = {c["name"] for c in inspector.get_columns("auth_user")}
    if "role" not in cols or "permissions" not in cols:
        return  # sync_missing_columns hasn't added them yet this boot
    with engine.begin() as conn:
        conn.execute(text("UPDATE auth_user SET role = 'field' WHERE role = 'enumerator'"))
        conn.execute(text(
            "UPDATE auth_user SET permissions = 'survey_entry,farmer_records,plots_map' "
            "WHERE role = 'field' AND permissions IS NULL"
        ))
