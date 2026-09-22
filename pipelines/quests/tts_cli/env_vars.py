import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

# Two files, root first and this pipeline's own over it: the shared credentials -- the
# CurseForge token, the vmangos MySQL, DATABASE_URL -- live in the repo root's .env,
# because all three pipelines used to carry their own copy and the copies drifted.
# pipelines/lib/env.mjs is the Node half of the same arrangement, and this follows it:
#
# A variable already set in the shell wins, so `DATABASE_URL=… python cli-main.py
# import-corpus` goes where it is pointed rather than wherever .env says. The files win
# only for the five MYSQL_* names, which other projects commonly export, and which would
# otherwise make the extract connect with somebody else's credentials.
_ROOT = Path(__file__).resolve().parents[3]
_FILES = (_ROOT / ".env", _ROOT / "pipelines" / "quests" / ".env")
_FILES_WIN = ("MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE")

for _file in reversed(_FILES):
    load_dotenv(_file, override=False)
for _file in _FILES:
    for _name, _value in dotenv_values(_file).items():
        if _name in _FILES_WIN and _value:
            os.environ[_name] = _value

MYSQL_HOST = os.getenv("MYSQL_HOST")
# Defaulted, not required: read only by corpus extraction, and an unset MYSQL_PORT used to
# raise TypeError at import time on any machine without a .env.
MYSQL_PORT = int(os.getenv("MYSQL_PORT") or 3306)
MYSQL_USER = os.getenv("MYSQL_USER")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE")
