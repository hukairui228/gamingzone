# 孤胆车神：雄霸迈阿密 · 重制版

A browser remaster of *Gangstar: Miami Vindication* (Gameloft, 2010). It runs on the original game's data: the
Miami city, vehicles, characters and animations, HUD art, minimap, Chinese text, voice acting, sound effects and
radio stations. The engine adds PBR lighting, real-time shadows, reflective water, a day/night cycle and post-processing.

The original assets are not in this repository. You extract them from your own copy of the game's IPA.

## Setup

Requirements: Node 18+, Python 3.10+, ffmpeg.

```bash
npm install
pip install numpy pillow texture2ddecoder fonttools
npm run extract -- /path/to/gangstar.ipa
npm run dev
```

`npm run extract` writes everything to `public/assets/`, which git ignores.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrow keys | Move, drive |
| Mouse | Look · left button: fire / punch · right button: aim |
| Shift / Space | Sprint / jump (handbrake in vehicles) |
| F / Enter | Enter or exit a vehicle (you can carjack) |
| Q / E / mouse wheel | Switch weapon |
| R / H | Radio station / horn |
| T | Start the taxi, ambulance or delivery job while driving those vehicles |
| M / Tab | Map (click to set a GPS waypoint) |
| Esc / P | Pause |

Touch devices get a virtual stick and buttons.

## Tools

| Script | What it converts |
| --- | --- |
| `tools/pvr2png.py` | PVR textures (`.tga` / `.bmp`) to images |
| `tools/convert_city.py` | The streamed city mesh (`miami.bdae`) plus ground and wall collision |
| `tools/convert_model.py` | Single models: vehicles, skinned characters, weapons, props |
| `tools/convert_anim.py` | The animation library (`anim_ingame.bdae`) |
| `tools/convert_text.py` | Localisation tables |
| `tools/build_roads.py` | The road graph, traced from the original minimap |
