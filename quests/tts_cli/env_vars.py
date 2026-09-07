from dotenv import load_dotenv
# override=True so this project's .env wins over ambient shell variables. Generic
# names like MYSQL_PASSWORD are commonly exported by other projects, and without
# this the connection silently uses the wrong credentials.
load_dotenv(override=True)
import os

MYSQL_HOST = os.getenv("MYSQL_HOST")
MYSQL_PORT = int(os.getenv("MYSQL_PORT"))
MYSQL_USER = os.getenv("MYSQL_USER")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE")
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
