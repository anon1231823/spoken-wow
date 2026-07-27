# VoiceOver for World of Warcraft

## v2: https://allvoice.ai
Contribute voices on [allvoice.ai](https://allvoice.ai) so I can give each NPC a unique AI voicemodel to power their dialog. The top rated voice for each NPC will be used. 


### [voiceover discord](https://discord.gg/VdhUmA8ZCt)
### [allvoice code](https://github.com/allvoice/allvoice-website)

## Overview

A pipeline for producing AI voiceovers for WoW Classic dialog. The sound pack and the addon
data module are build outputs of this project.

Three stages, and only the first needs a database:

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB | `corpus/corpus.json.gz` | a maintainer, when vmangos ships a new dump |
| synthesize | corpus + voice config | mp3s in `audio/` | anyone producing lines |
| build | corpus + `audio/` | addon data module | anyone cutting a release |

The corpus is **committed** — 17,507 lines, 2 MB gzipped — so producing audio needs no
database, no dump, and no Docker.

## Below is for developers only. Go to [releases](https://github.com/mrthinger/wow-voiceover/releases) if youre looking to install the addon.

## Requirements

- Python 3.10+
- Docker — **only** to refresh the corpus (see "Refreshing the corpus")

## Installation

1. Create and activate a virtual environment:
```bash
python -m venv .venv && source .venv/bin/activate
```
2. Install the everyday dependencies — five pure-Python packages, no compiled extensions
   and no database client:
```bash
pip install -r requirements.txt
```
3. Copy `.env.example` to `.env` and fill in your ElevenLabs API key:
```bash
cp .env.example .env
```

That's it. The committed corpus already contains every line's text, voice and metadata.

## Refreshing the corpus

Only needed when vmangos publishes a new database dump, or when the extraction needs a
column it didn't previously capture.

```bash
pip install -r requirements-extract.txt   # adds pandas, numpy, PyMySQL
docker compose up -d
python cli-main.py init-db                # download and import the vmangos dump
python cli-main.py extract                # writes corpus/corpus.json.gz
```

Commit the resulting corpus; the diff is reviewable.

## Voice Setup
The generation scripts assume you have voices created in Elevenlabs named in the format `race-gender`. For the exact races the script checks your elevenlabs account for, refer to `tts_cli\consts.py`. Gender will always either be `male` or `female`. ex: `orc-male`. You will need to create your own voice clones. A good place to get samples is @ https://www.wowhead.com/sounds/npc-greetings/name:orc 
## Usage

```bash
python cli-main.py --help
```

Selecting what to voice used to mean dragging a rectangle over a map image, which filtered
NPCs by world coordinates. That picker is gone — selection is now a filter over the corpus,
by NPC, quest, or spawn area. Spawn positions are carried in the corpus, so area selection
still works with no GUI and no database:

```python
from tts_cli.corpus import load_corpus, lines_in_area

corpus = load_corpus()
elwynn = lines_in_area(corpus, map_id=0, x_range=(-9900, -9000), y_range=(-600, 900))
```

### Language Client Selection
Currently there are no voice translations available for languages other than english. However, if you want to use the addon with a non English client, you can still do so by creating the lookup tables in the client's respective language.

To create the lookup tables, you can use the following command, with `LANGUAGE_CODE` representing the required language for the client:
```bash
python cli-main.py gen_lookup_tables --lang=LANGUAGE_CODE
```
The default selection, when no language code is provided, is English. Please be aware that the quality of text completion for translations in languages other than English can vary significantly.

The following language codes are supported:
| Language Code | Language |
| ------------- | ------- |
| enUS          | English |
| enGB          | English |
| koKR          | Korean |
| frFR          | French |
| deDE          | German |
| zhCN          | Simplified Chinese |
| zhTW          | Traditional Chinese |
| esES          | European Spanish |
| esMX          | Mexican Spanish |
| ruRU          | Russian |

## Output
The generated TTS audio files will be saved in the sounds folder, with separate subfolders for quests and gossip. Lookup tables and sound length tables will also be generated for use in the addon. 

## Addon Install
Copy over the `generated` folder to the VoiceOverData_Vanilla folder, then the VoiceOver and VoiceOverData_Vanilla folder to `World of Warcraft/_classic_era_/Interface/AddOns`. Alternatively, you can syslink instead of copying for faster development.
Example syslink:
```bash
export WOW_DIR=PATH_OF_YOUR_WOW_DIR
ln -s ./VoiceOver "$WOW_DIR/_classic_era_/Interface/AddOns"
ln -s ./VoiceOver_Vanilla "$WOW_DIR/_classic_era_/Interface/AddOns"
```
## Contributing
If you want to contribute to this project, please feel free to open an issue or submit a pull request.

# CLI Docs

## Dataframe Schema

The dataframe schema before calling the `preprocess_dataframe` function consists of the following columns:

| Column        | Description                                                  |
|---------------|--------------------------------------------------------------|
| `source`      | Indicates the type of interaction, can be 'accept', 'progress', 'complete', or 'gossip' |
| `quest`       | The quest ID or empty string if it's a gossip interaction    |
| `text`        | The text template content of the interaction                           |
| `DisplayRaceID` | The race ID of the NPC involved in the interaction          |
| `DisplaySexID`  | The gender ID of the NPC involved in the interaction        |
| `name`        | The name of the NPC involved in the interaction               |
| `type`        | The type of the NPC involved in the interaction ('creature', 'gameobject', or 'item') |
| `id`          | The creature/gameobject/item ID of the NPC involved in the interaction |

`DisplayRaceID = -1` is used for interactions with inanimate NPCs: gameobjects, items etc. It's mapped to a voice called "narrator" in `RACE_DICT`.

## New Fields Added by `preprocess_dataframe`

The `preprocess_dataframe` function adds the following new fields to the dataframe:

| Column                   | Description                                                  |
|--------------------------|--------------------------------------------------------------|
| `race`                   | The race of the NPC, mapped from `DisplayRaceID` using `RACE_DICT` |
| `gender`                 | The gender of the NPC, mapped from `DisplaySexID` using `GENDER_DICT` |
| `voice_name`             | The voice name, which is a combination of the race and gender fields |
| `templateText_race_gender` | A combination of the text, race, and gender fields          |
| `templateText_race_gender_hash` | A hash of the `templateText_race_gender` field          |
| `cleanedText` | `text` after rendering template |
