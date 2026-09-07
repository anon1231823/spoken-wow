from dotenv import load_dotenv
# override=True so this project's .env wins over ambient shell variables. Generic
# names like MYSQL_PASSWORD are commonly exported by other projects, and without
# this the connection silently uses the wrong credentials.
load_dotenv(override=True)
import os

MYSQL_HOST = os.getenv("MYSQL_HOST")
# Defaulted, not required. These five are read only by corpus extraction, but every
# module that wants ELEVENLABS_API_KEY imports this one -- so an unset MYSQL_PORT used
# to raise TypeError at import time and take the whole test suite with it on any machine
# without a .env. The committed corpus is the whole point: producing audio must not need
# a database, and it must not need the credentials for one either. The value matches
# .env.example and docker-compose.yml.
MYSQL_PORT = int(os.getenv("MYSQL_PORT") or 3306)
MYSQL_USER = os.getenv("MYSQL_USER")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE")
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
