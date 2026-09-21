"""The vmangos rows -> corpus preprocessing that `extract` runs, inherited from upstream.

What is left of upstream's TTSProcessor: resolving $G gender options, flavors and voices
over the extracted DataFrame. Upstream's generator and its lookup-table writers lived here
too; audio is cut only by the site now, and the addon's tables by tts_cli.build.
"""
import hashlib
import re

import pandas as pd

from tts_cli.consts import GENDER_DICT, RACE_DICT
from tts_cli.flavors import (apply_fallbacks, consensus_flavor, fallback_flavors,
                             flavor_from_sound_name, voice_name)

REPLACE_DICT = {'$b': '\n', '$B': '\n', '$n': 'adventurer', '$N': 'Adventurer',
                '$C': 'Adventurer', '$c': 'adventurer', '$R': 'Traveler', '$r': 'traveler'}


def get_hash(text):
    hash_object = hashlib.md5(text.encode())
    return hash_object.hexdigest()


class TTSProcessor:
    def handle_gender_options(self, text):
        pattern = re.compile(r'\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;')

        male_text = pattern.sub(r'\1', text)
        female_text = pattern.sub(r'\2', text)

        return male_text, female_text

    def resolve_flavors(self, df):
        """Each row's NPC voice flavor: read from game data, then made usable.

        Three passes, because each answers a different failure of the raw data:

        1. Read the flavor out of the NPC's greeting sound name.
        2. Fill in NPCs the game does not answer for from their race-gender's default.
        3. Force every row sharing an audio file onto one flavor. A file is named after the
           quest or after md5(text + race + gender), so NPCs of the same race and gender
           sharing a line share an mp3 - and hundreds of gossip lines are shared across
           flavors. One file cannot have two voices.
        """
        race_gender = df['race'] + '-' + df['gender']
        flavors = [flavor_from_sound_name(name, rg)
                   for name, rg in zip(df['npc_sound_name'], race_gender)]
        flavors = apply_fallbacks(race_gender, flavors,
                                  fallback_flavors(zip(race_gender, flavors)))

        # The file each row will be written to, as tts_cli/naming.py derives it, paired with
        # the race-gender. The player-gender prefix is irrelevant here: both variants of a
        # line are the same NPC.
        #
        # Keyed on race-gender as well as the file because a quest given by a dwarf and a
        # troll is one file with two voices already, and always has been. Agreeing a flavor
        # across that pair does not make it one voice, it just hands the dwarf the troll's
        # flavor - a dwarf-male-dark that no clips exist for.
        file_key = [
            (f'{quest}-{source}' if quest else text_hash, rg)
            for quest, source, text_hash, rg
            in zip(df['quest'], df['source'], df['templateText_race_gender_hash'], race_gender)
        ]
        agreed = {}
        for key, flavor in zip(file_key, flavors):
            agreed.setdefault(key, []).append(flavor)
        agreed = {key: consensus_flavor(group) for key, group in agreed.items()}

        return [agreed[key] for key in file_key]

    def preprocess_dataframe(self, df):
        df = df.copy() # prevent mutation on original df for safety
        df['race'] = df['DisplayRaceID'].map(RACE_DICT)
        df['gender'] = df['DisplaySexID'].map(GENDER_DICT)

        df['templateText_race_gender'] = df['original_text'] + df['race'] + df['gender']
        df['templateText_race_gender_hash'] = df['templateText_race_gender'].apply(get_hash)

        df['flavor'] = self.resolve_flavors(df)
        df['voice_name'] = [
            voice_name(race, gender, flavor)
            for race, gender, flavor in zip(df['race'], df['gender'], df['flavor'])
        ]

        df['cleanedText'] = df['text'].copy()

        for k, v in REPLACE_DICT.items():
            df['cleanedText'] = df['cleanedText'].str.replace(k, v, regex=False)

        df['cleanedText'] = df['cleanedText'].str.replace(r'<.*?>\s', '', regex=True)

        df['player_gender'] = None
        rows = []
        for _, row in df.iterrows():
            if re.search(r'\$[Gg]', row['cleanedText']):
                male_text, female_text = self.handle_gender_options(row['cleanedText'])

                row_male = row.copy()
                row_male['cleanedText'] = male_text
                row_male['player_gender'] = 'm'

                row_female = row.copy()
                row_female['cleanedText'] = female_text
                row_female['player_gender'] = 'f'

                rows.extend([row_male, row_female])
            else:
                rows.append(row)

        new_df = pd.DataFrame(rows)
        new_df.reset_index(drop=True, inplace=True)

        return new_df

