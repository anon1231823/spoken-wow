import os

import mutagen

from tts_cli.store import AUDIO_EXTENSIONS

DATAMODULE_TABLE_GUARD_CLAUSE = 'if not VoiceOver or not VoiceOver.DataModules then return end'

def write_sound_length_table_lua(module_name: str, sound_folder_path: str, output_folder_path: str):

    sound_files = []

    for root, dirs, files in os.walk(sound_folder_path):
        for f in files:
            if f.endswith(AUDIO_EXTENSIONS):
                sound_files.append(os.path.join(root, f))

    # Create a Lua table mapping the name of the sound to its length in seconds.
    # mutagen.File sniffs the container, so mp3 and ogg are both read without a branch here;
    # a VBR mp3's Xing header and an Ogg page's granule position are both exact.
    soundDict = {}
    for sound_file in sound_files:
        audio = mutagen.File(sound_file)
        length = audio.info.length
        soundDict[os.path.splitext(os.path.basename(sound_file))[0]] = length

    # Write the dictionary to the output file in Lua table format
    with open(output_folder_path + '/sound_length_table.lua', "w") as f:
        f.write(DATAMODULE_TABLE_GUARD_CLAUSE + "\n")
        f.write(f"{module_name}.SoundLengthLookupByFileName = {{\n")
        for key, value in soundDict.items():
            f.write(f"    [\"{key}\"] = {value},\n")
        f.write("}\n")
