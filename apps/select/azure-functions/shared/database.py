import os

from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Azure Functions loads these from local.settings.json (local dev, via `func start`)
# or from the Function App's Application Settings (deployed).
DATABASE_URL = URL.create(
    drivername="postgresql+psycopg2",
    username=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    host=os.environ["DB_HOST"],
    port=int(os.environ.get("DB_PORT", 5432)),
    database=os.environ["DB_NAME"],
    query={"sslmode": os.environ.get("DB_SSLMODE", "require")},
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass
